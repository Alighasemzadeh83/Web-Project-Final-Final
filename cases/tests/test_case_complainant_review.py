from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, CaseComplainantReview, CaseParticipant
from cases.utils import generate_case_number

User = get_user_model()


class CaseComplainantReviewTests(APITestCase):
    def setUp(self):
        self.cadet_group, _ = Group.objects.get_or_create(name="Cadet")
        self.officer_group, _ = Group.objects.get_or_create(name="Officer")
        self.detective_group, _ = Group.objects.get_or_create(name="Detective")

        self.cadet = User.objects.create_user(
            username="cadet_case_review",
            email="cadet_case_review@example.com",
            password="Cadet12345",
            national_id="8100000001",
            phone_number="09128100001",
        )
        self.officer = User.objects.create_user(
            username="officer_case_review",
            email="officer_case_review@example.com",
            password="Officer12345",
            national_id="8100000002",
            phone_number="09128100002",
        )
        self.detective = User.objects.create_user(
            username="detective_case_review",
            email="detective_case_review@example.com",
            password="Detective12345",
            national_id="8100000003",
            phone_number="09128100003",
        )
        self.complainant = User.objects.create_user(
            username="new_case_complainant",
            email="new_case_complainant@example.com",
            password="Complainant12345",
            national_id="8100000004",
            phone_number="09128100004",
        )
        self.cadet.groups.add(self.cadet_group)
        self.officer.groups.add(self.officer_group)
        self.detective.groups.add(self.detective_group)

        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Case with complainant onboarding",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.DETECTIVE_PENDING,
            approval_stage=Case.ApprovalStage.DETECTIVE,
            created_by=self.detective,
            supervisor=self.detective,
        )

    def test_add_and_approve_case_complainant_flow(self):
        self.client.force_authenticate(self.detective)
        add_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.username},
            format="json",
        )
        self.assertEqual(add_resp.status_code, status.HTTP_201_CREATED)
        review_id = add_resp.data["id"]

        self.client.force_authenticate(self.cadet)
        cadet_resp = self.client.post(
            reverse("case-cadet-review-case-complainant", args=[self.case.id, review_id]),
            {"decision": "approve"},
            format="json",
        )
        self.assertEqual(cadet_resp.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(self.officer)
        officer_resp = self.client.post(
            reverse("case-officer-review-case-complainant", args=[self.case.id, review_id]),
            {"decision": "approve"},
            format="json",
        )
        self.assertEqual(officer_resp.status_code, status.HTTP_200_OK)
        self.assertTrue(
            CaseParticipant.objects.filter(
                case=self.case,
                role=CaseParticipant.Role.COMPLAINANT,
                person__user=self.complainant,
            ).exists()
        )

    def test_case_complainant_removed_after_three_cadet_rejections(self):
        self.client.force_authenticate(self.officer)
        add_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.national_id},
            format="json",
        )
        self.assertEqual(add_resp.status_code, status.HTTP_201_CREATED)
        review_id = add_resp.data["id"]

        self.client.force_authenticate(self.cadet)
        for _ in range(3):
            reject_resp = self.client.post(
                reverse("case-cadet-review-case-complainant", args=[self.case.id, review_id]),
                {"decision": "reject", "note": "incomplete"},
                format="json",
            )
            self.assertEqual(reject_resp.status_code, status.HTTP_200_OK)

        review = CaseComplainantReview.objects.get(id=review_id)
        self.assertEqual(review.status, CaseComplainantReview.Status.REMOVED)
        self.assertEqual(review.cadet_attempts, 3)

        # re-add is allowed only after removal
        self.client.force_authenticate(self.officer)
        readd_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.national_id},
            format="json",
        )
        self.assertEqual(readd_resp.status_code, status.HTTP_201_CREATED)
        review.refresh_from_db()
        self.assertEqual(review.status, CaseComplainantReview.Status.PENDING)
        self.assertEqual(review.cadet_attempts, 0)

    def test_duplicate_case_complainant_add_is_blocked(self):
        self.client.force_authenticate(self.officer)
        add_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.username},
            format="json",
        )
        self.assertEqual(add_resp.status_code, status.HTTP_201_CREATED)

        duplicate_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.username},
            format="json",
        )
        self.assertEqual(duplicate_resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejected_case_complainant_can_resubmit(self):
        self.client.force_authenticate(self.officer)
        add_resp = self.client.post(
            reverse("case-add-case-complainant", args=[self.case.id]),
            {"identifier": self.complainant.username},
            format="json",
        )
        self.assertEqual(add_resp.status_code, status.HTTP_201_CREATED)
        review_id = add_resp.data["id"]

        self.client.force_authenticate(self.cadet)
        reject_resp = self.client.post(
            reverse("case-cadet-review-case-complainant", args=[self.case.id, review_id]),
            {"decision": "reject", "note": "Need correction"},
            format="json",
        )
        self.assertEqual(reject_resp.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(self.complainant)
        resubmit_resp = self.client.post(
            reverse("case-resubmit-case-complainant", args=[self.case.id, review_id]),
            {
                "full_name": "Updated Case Complainant",
                "phone_number": "09128100999",
                "email": "updated_case_complainant@example.com",
            },
            format="json",
        )
        self.assertEqual(resubmit_resp.status_code, status.HTTP_200_OK)

        review = CaseComplainantReview.objects.get(id=review_id)
        review.person.refresh_from_db()
        self.assertEqual(review.status, CaseComplainantReview.Status.PENDING)
        self.assertEqual(review.officer_status, CaseComplainantReview.OfficerStatus.PENDING)
        self.assertEqual(review.rejection_reason, "")
        self.assertEqual(review.officer_rejection_reason, "")
        self.assertIsNone(review.reviewed_by_cadet)
        self.assertIsNone(review.reviewed_by_officer)
        self.assertEqual(review.person.full_name, "Updated Case Complainant")
        self.assertEqual(review.person.phone_number, "09128100999")
        self.assertEqual(review.person.email, "updated_case_complainant@example.com")
