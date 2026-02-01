from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, Person
from cases.utils import generate_case_number

User = get_user_model()


class TrialTests(APITestCase):
    def setUp(self):
        self.judge_group, _ = Group.objects.get_or_create(name="Judge")
        self.judge_user = User.objects.create_user(
            username="judge1",
            email="judge1@example.com",
            password="Judge12345",
            national_id="1919191919",
            phone_number="09120006666",
        )
        self.judge_user.groups.add(self.judge_group)
        self.client.force_authenticate(self.judge_user)

        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Trial Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_1,
            status=Case.Status.IN_TRIAL,
        )

    def test_trial_verdict_closes_case(self):
        judge_person = {"full_name": "Judge Judy", "national_id": "2020202020"}
        resp = self.client.post(
            reverse("trial-list"),
            {
                "case": self.case.id,
                "judge": judge_person,
                "verdict": "guilty",
                "sentence_title": "Prison",
                "sentence_description": "10 years",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.case.refresh_from_db()
        self.assertEqual(self.case.status, Case.Status.CLOSED)
