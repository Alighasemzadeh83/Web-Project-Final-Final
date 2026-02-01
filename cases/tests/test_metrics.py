from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case
from cases.utils import generate_case_number

User = get_user_model()


class MetricsTests(APITestCase):
    def setUp(self):
        self.officer_group, _ = Group.objects.get_or_create(name="Officer")
        self.officer = User.objects.create_user(
            username="metrics_officer",
            email="metrics@example.com",
            password="Officer12345",
            national_id="2121212121",
            phone_number="09120007777",
        )
        self.officer.groups.add(self.officer_group)
        self.client.force_authenticate(self.officer)

        Case.objects.create(
            number=generate_case_number(),
            title="Active Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.ACTIVE,
        )
        Case.objects.create(
            number=generate_case_number(),
            title="Closed Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.CLOSED,
        )

    def test_metrics_summary(self):
        resp = self.client.get(reverse("metrics-summary"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["total_cases"], 2)
        self.assertEqual(resp.data["solved_cases"], 1)
