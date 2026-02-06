from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, Person, PursuitStatus, SuspectEvaluation
from cases.utils import generate_case_number

User = get_user_model()


class PursuitHighAlertTests(APITestCase):
    def setUp(self):
        self.sergeant_group, _ = Group.objects.get_or_create(name="Sergeant")
        self.sergeant = User.objects.create_user(
            username="sergeant1",
            email="sergeant1@example.com",
            password="Sergeant12345",
            national_id="1231231231",
            phone_number="09120001111",
        )
        self.sergeant.groups.add(self.sergeant_group)
        self.client.force_authenticate(self.sergeant)

        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Pursuit Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.CRITICAL,
            status=Case.Status.ACTIVE,
        )
        self.suspect = Person.objects.create(full_name="Suspect A", national_id="1212121212")
        self.pursuit = PursuitStatus.objects.create(
            case=self.case,
            suspect=self.suspect,
            pursuit_started_at=date.today() - timedelta(days=35),
            severity_at_report=Case.Severity.CRITICAL,
        )
        self.evaluation = SuspectEvaluation.objects.create(
            case=self.case,
            suspect=self.suspect,
            sergeant_decision="approve",
        )

    def test_high_alert_listing_updates_status_and_reward(self):
        resp = self.client.get(reverse("pursuit-high-alert"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.pursuit.refresh_from_db()
        self.assertEqual(self.pursuit.status, PursuitStatus.Status.HIGH_ALERT)
        self.assertGreaterEqual(resp.data[0]["reward"], 20_000_000)
        self.assertEqual(resp.data[0]["case"]["id"], self.case.id)
        self.assertEqual(resp.data[0]["suspect"]["id"], self.suspect.id)

    def test_high_alert_returns_separate_rows_per_case_suspect_pair(self):
        second_case = Case.objects.create(
            number=generate_case_number(),
            title="Pursuit Case 2",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.ACTIVE,
        )
        second_pursuit = PursuitStatus.objects.create(
            case=second_case,
            suspect=self.suspect,
            pursuit_started_at=date.today() - timedelta(days=40),
            severity_at_report=Case.Severity.LEVEL_2,
        )
        SuspectEvaluation.objects.create(
            case=second_case,
            suspect=self.suspect,
            sergeant_decision="approve",
        )

        resp = self.client.get(reverse("pursuit-high-alert"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)

        # Both rows must be present as separate suspect-case pairs.
        pair_ids = {(item["case"]["id"], item["suspect"]["id"]) for item in resp.data}
        self.assertIn((self.case.id, self.suspect.id), pair_ids)
        self.assertIn((second_case.id, self.suspect.id), pair_ids)

        # Ranking must use max(L_j) * max(D_i) per suspect.
        first = next(item for item in resp.data if item["case"]["id"] == self.case.id)
        second = next(item for item in resp.data if item["case"]["id"] == second_case.id)
        self.assertEqual(first["rank_score"], second["rank_score"])
        self.assertEqual(first["max_days_under_pursuit"], 40)
        self.assertEqual(second["max_days_under_pursuit"], 40)
        self.assertEqual(first["max_severity_score"], 4)
        self.assertEqual(second["max_severity_score"], 4)

        self.pursuit.refresh_from_db()
        second_pursuit.refresh_from_db()
        self.assertEqual(self.pursuit.status, PursuitStatus.Status.HIGH_ALERT)
        self.assertEqual(second_pursuit.status, PursuitStatus.Status.HIGH_ALERT)

    def test_high_alert_keeps_row_after_guilty_verdict(self):
        self.evaluation.judge_verdict = "guilty"
        self.evaluation.save(update_fields=["judge_verdict", "updated_at"])

        resp = self.client.get(reverse("pursuit-high-alert"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["status"], "criminal_high_alert")

    def test_high_alert_hides_rows_after_not_guilty_verdict(self):
        self.evaluation.judge_verdict = "not_guilty"
        self.evaluation.save(update_fields=["judge_verdict", "updated_at"])

        resp = self.client.get(reverse("pursuit-high-alert"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 0)
