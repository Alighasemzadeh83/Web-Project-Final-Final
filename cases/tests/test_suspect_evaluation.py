from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, Person, SuspectEvaluation
from cases.utils import generate_case_number

User = get_user_model()


class SuspectEvaluationTests(APITestCase):
    def setUp(self):
        self.detective_group, _ = Group.objects.get_or_create(name="Detective")
        self.sergeant_group, _ = Group.objects.get_or_create(name="Sergeant")
        self.captain_group, _ = Group.objects.get_or_create(name="Captain")

        self.detective = User.objects.create_user(
            username="detective2",
            email="detective2@example.com",
            password="Detective12345",
            national_id="1515151515",
            phone_number="09120003333",
        )
        self.sergeant = User.objects.create_user(
            username="sergeant3",
            email="sergeant3@example.com",
            password="Sergeant12345",
            national_id="1616161616",
            phone_number="09120004444",
        )
        self.captain = User.objects.create_user(
            username="captain1",
            email="captain1@example.com",
            password="Captain12345",
            national_id="1717171717",
            phone_number="09120005555",
        )
        self.detective.groups.add(self.detective_group)
        self.sergeant.groups.add(self.sergeant_group)
        self.captain.groups.add(self.captain_group)

        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Eval Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_1,
            status=Case.Status.ACTIVE,
        )
        self.suspect = Person.objects.create(full_name="Suspect C", national_id="1818181818")
        self.evaluation = SuspectEvaluation.objects.create(case=self.case, suspect=self.suspect)

    def test_evaluation_flow(self):
        self.case.status = Case.Status.IN_PROGRESS
        self.case.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.detective)
        det_resp = self.client.post(
            reverse("suspectevaluation-detective-score", args=[self.evaluation.id]),
            {"score": 8, "notes": "Strong link"},
            format="json",
        )
        self.assertEqual(det_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(det_resp.data["detective_score"], 8)

        self.client.force_authenticate(self.sergeant)
        serg_resp = self.client.post(
            reverse("suspectevaluation-sergeant-score", args=[self.evaluation.id]),
            {"score": 7},
            format="json",
        )
        self.assertEqual(serg_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(serg_resp.data["sergeant_score"], 7)
        self.evaluation.refresh_from_db()
        self.evaluation.sergeant_decision = "approve"
        self.evaluation.save(update_fields=["sergeant_decision", "updated_at"])

        self.client.force_authenticate(self.captain)
        cap_resp = self.client.post(
            reverse("suspectevaluation-captain-decision", args=[self.evaluation.id]),
            {"decision": "guilty", "notes": "Captain decided guilty"},
            format="json",
        )
        self.assertEqual(cap_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(cap_resp.data["captain_decision"], "guilty")

    def test_readding_rejected_suspect_resets_sergeant_decision_for_new_cycle(self):
        suspect_user = User.objects.create_user(
            username="suspect_cycle_user",
            email="suspect_cycle_user@example.com",
            password="Suspect12345",
            national_id="1919191919",
            phone_number="09120006666",
        )
        case = Case.objects.create(
            number=generate_case_number(),
            title="Re-add suspect cycle case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.DETECTIVE_PENDING,
        )

        self.client.force_authenticate(self.detective)
        create_first = self.client.post(
            reverse("suspectevaluation-list"),
            {
                "case": case.id,
                "suspect_national_id": suspect_user.national_id,
                "detected_at": "2026-02-01",
            },
            format="json",
        )
        self.assertEqual(create_first.status_code, status.HTTP_201_CREATED)
        eval_id = create_first.data["id"]

        case.status = Case.Status.SERGEANT_PENDING
        case.save(update_fields=["status", "updated_at"])

        self.client.force_authenticate(self.sergeant)
        first_reject = self.client.post(
            reverse("suspectevaluation-sergeant-decision", args=[eval_id]),
            {"decision": "reject", "notes": "Need more evidence"},
            format="json",
        )
        self.assertEqual(first_reject.status_code, status.HTTP_200_OK)
        self.assertEqual(first_reject.data["sergeant_decision"], "reject")

        case.refresh_from_db()
        self.assertEqual(case.status, Case.Status.DETECTIVE_PENDING)

        self.client.force_authenticate(self.detective)
        create_second = self.client.post(
            reverse("suspectevaluation-list"),
            {
                "case": case.id,
                "suspect_national_id": suspect_user.national_id,
                "detected_at": "2026-02-02",
            },
            format="json",
        )
        self.assertEqual(create_second.status_code, status.HTTP_200_OK)
        self.assertEqual(create_second.data["id"], eval_id)
        self.assertEqual(create_second.data["sergeant_decision"], "")

        evaluation = SuspectEvaluation.objects.get(id=eval_id)
        self.assertEqual(evaluation.status, SuspectEvaluation.Status.PENDING)
        self.assertIsNone(evaluation.detective_score)
        self.assertIsNone(evaluation.sergeant_score)
        self.assertEqual(evaluation.sergeant_decision, "")
        self.assertEqual(str(evaluation.detected_at), "2026-02-02")

        case.status = Case.Status.SERGEANT_PENDING
        case.save(update_fields=["status", "updated_at"])

        self.client.force_authenticate(self.sergeant)
        second_decision = self.client.post(
            reverse("suspectevaluation-sergeant-decision", args=[eval_id]),
            {"decision": "approve", "notes": "Now acceptable"},
            format="json",
        )
        self.assertEqual(second_decision.status_code, status.HTTP_200_OK)
        self.assertEqual(second_decision.data["sergeant_decision"], "approve")

    def test_detective_resend_to_sergeant_resets_previous_rejected_decision(self):
        case = Case.objects.create(
            number=generate_case_number(),
            title="Resend cycle case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.SERGEANT_PENDING,
            approval_stage=Case.ApprovalStage.SERGEANT,
            created_by=self.detective,
        )
        suspect_user = User.objects.create_user(
            username="suspect_resend_user",
            email="suspect_resend_user@example.com",
            password="Suspect12345",
            national_id="2020202020",
            phone_number="09120007777",
        )
        suspect = Person.objects.create(
            full_name="Suspect Resend",
            national_id=suspect_user.national_id,
            user=suspect_user,
        )
        evaluation = SuspectEvaluation.objects.create(case=case, suspect=suspect)

        self.client.force_authenticate(self.sergeant)
        reject_resp = self.client.post(
            reverse("suspectevaluation-sergeant-decision", args=[evaluation.id]),
            {"decision": "reject", "notes": "Rejected in first cycle"},
            format="json",
        )
        self.assertEqual(reject_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(reject_resp.data["sergeant_decision"], "reject")

        case.refresh_from_db()
        self.assertEqual(case.status, Case.Status.DETECTIVE_PENDING)
        self.assertEqual(case.approval_stage, Case.ApprovalStage.DETECTIVE)

        self.client.force_authenticate(self.detective)
        resend_resp = self.client.post(
            reverse("case-approve", args=[case.id]),
            {"note": "Resend to sergeant"},
            format="json",
        )
        self.assertEqual(resend_resp.status_code, status.HTTP_200_OK)

        evaluation.refresh_from_db()
        self.assertEqual(evaluation.sergeant_decision, "")
        self.assertEqual(evaluation.status, SuspectEvaluation.Status.PENDING)

        case.refresh_from_db()
        self.assertEqual(case.status, Case.Status.SERGEANT_PENDING)
        self.assertEqual(case.approval_stage, Case.ApprovalStage.SERGEANT)

        self.client.force_authenticate(self.sergeant)
        approve_resp = self.client.post(
            reverse("suspectevaluation-sergeant-decision", args=[evaluation.id]),
            {"decision": "approve", "notes": "Approved in second cycle"},
            format="json",
        )
        self.assertEqual(approve_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_resp.data["sergeant_decision"], "approve")

    def test_me_status_separates_suspect_and_criminal_per_case(self):
        subject_user = User.objects.create_user(
            username="status_subject",
            email="status_subject@example.com",
            password="Subject12345",
            national_id="3030303030",
            phone_number="09120008888",
        )
        subject_person = Person.objects.create(
            full_name="Status Subject",
            national_id=subject_user.national_id,
            user=subject_user,
        )
        suspect_case = Case.objects.create(
            number=generate_case_number(),
            title="Suspect-only case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.SERGEANT_PENDING,
        )
        criminal_case = Case.objects.create(
            number=generate_case_number(),
            title="Criminal case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_1,
            status=Case.Status.CLOSED,
        )
        innocent_case = Case.objects.create(
            number=generate_case_number(),
            title="Innocent case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.CLOSED,
        )
        SuspectEvaluation.objects.create(case=suspect_case, suspect=subject_person, sergeant_decision="approve")
        SuspectEvaluation.objects.create(
            case=criminal_case,
            suspect=subject_person,
            sergeant_decision="approve",
            judge_verdict="guilty",
        )
        SuspectEvaluation.objects.create(
            case=innocent_case,
            suspect=subject_person,
            sergeant_decision="approve",
            judge_verdict="not_guilty",
        )

        self.client.force_authenticate(subject_user)
        resp = self.client.get(reverse("suspectevaluation-me-status"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.assertEqual(resp.data["suspect"]["case_ids"], [suspect_case.id])
        self.assertEqual(resp.data["criminal"]["case_ids"], [criminal_case.id])
        self.assertNotIn(innocent_case.id, resp.data["suspect"]["case_ids"])
        self.assertNotIn(innocent_case.id, resp.data["criminal"]["case_ids"])
        self.assertNotIn(criminal_case.id, resp.data["suspect"]["case_ids"])
        self.assertEqual(resp.data["suspect"]["cases"][0]["title"], suspect_case.title)
        self.assertEqual(resp.data["criminal"]["cases"][0]["title"], criminal_case.title)

    def test_case_list_includes_convicted_criminals_for_closed_case(self):
        closed_case = Case.objects.create(
            number=generate_case_number(),
            title="Closed criminal case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.CLOSED,
            created_by=self.detective,
        )
        convicted = Person.objects.create(full_name="Convicted User", national_id="4040404040")
        SuspectEvaluation.objects.create(
            case=closed_case,
            suspect=convicted,
            sergeant_decision="approve",
            judge_verdict="guilty",
        )

        self.client.force_authenticate(self.detective)
        resp = self.client.get(reverse("case-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        results = resp.data.get("results", [])
        target = next((item for item in results if item["id"] == closed_case.id), None)
        self.assertIsNotNone(target)
        self.assertEqual(target["status"], "closed")
        self.assertEqual(len(target.get("criminals", [])), 1)
        self.assertEqual(target["criminals"][0]["full_name"], "Convicted User")
