from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case
from cases.utils import generate_case_number

User = get_user_model()


class EvidenceValidationTests(APITestCase):
    def setUp(self):
        self.officer_group, _ = Group.objects.get_or_create(name="Officer")
        self.officer = User.objects.create_user(
            username="officer2",
            email="officer2@example.com",
            password="Officer12345",
            national_id="6666666666",
            phone_number="09126666666",
        )
        self.officer.groups.add(self.officer_group)
        self.client.force_authenticate(self.officer)
        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Test Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.ACTIVE,
        )

    def test_vehicle_evidence_requires_plate_or_serial(self):
        url = reverse("evidence-list")
        resp = self.client.post(
            url,
            {
                "case": self.case.id,
                "type": "vehicle",
                "title": "Car",
                "description": "Found car",
                "recorded_at": "2025-01-01T10:00:00Z",
                "extra_data": {
                    "model": "Sedan",
                    "color": "Black",
                    "plate_number": "12A345",
                    "serial_number": "XYZ",
                },
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("exactly one of plate_number or serial_number", str(resp.data))
