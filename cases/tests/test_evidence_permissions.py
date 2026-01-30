from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case
from cases.utils import generate_case_number

User = get_user_model()


class EvidencePermissionTests(APITestCase):
    def setUp(self):
        self.coroner_group, _ = Group.objects.get_or_create(name="Coroner")
        self.detective_group, _ = Group.objects.get_or_create(name="Detective")
        self.citizen_group, _ = Group.objects.get_or_create(name="Citizen")
        self.coroner = User.objects.create_user(
            username="coroner_perm",
            email="coroner_perm@example.com",
            password="Coroner12345",
            national_id="5656565656",
            phone_number="09125555555",
        )
        self.coroner.groups.add(self.coroner_group)
        self.detective = User.objects.create_user(
            username="detective_perm",
            email="detective_perm@example.com",
            password="Detective12345",
            national_id="5656565657",
            phone_number="09125555556",
        )
        self.detective.groups.add(self.detective_group)
        self.citizen = User.objects.create_user(
            username="citizen_perm",
            email="citizen_perm@example.com",
            password="Citizen12345",
            national_id="5656565658",
            phone_number="09125555557",
        )
        self.citizen.groups.add(self.citizen_group)
        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Evidence Permission Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_2,
            status=Case.Status.ACTIVE,
        )

    def test_coroner_can_register_evidence(self):
        self.client.force_authenticate(self.coroner)
        resp = self.client.post(
            reverse("evidence-list"),
            {
                "case": self.case.id,
                "type": "generic",
                "title": "Coroner submitted evidence",
                "description": "desc",
                "recorded_at": "2026-02-16T10:00:00Z",
                "extra_data": {},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["title"], "Coroner submitted evidence")

    def test_coroner_cannot_review_non_forensic_evidence(self):
        self.client.force_authenticate(self.coroner)
        create_resp = self.client.post(
            reverse("evidence-list"),
            {
                "case": self.case.id,
                "type": "vehicle",
                "title": "Vehicle evidence",
                "description": "desc",
                "recorded_at": "2026-02-16T10:00:00Z",
                "extra_data": {"model": "x", "color": "y", "plate_number": "11"},
            },
            format="json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_201_CREATED)
        review_resp = self.client.post(
            reverse("evidence-review", args=[create_resp.data["id"]]),
            {"decision": "approve"},
            format="json",
        )
        self.assertEqual(review_resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_citizen_can_submit_evidence_without_case_and_detective_assigns(self):
        self.client.force_authenticate(self.citizen)
        create_resp = self.client.post(
            reverse("evidence-list"),
            {
                "type": "generic",
                "title": "Citizen evidence",
                "description": "desc",
                "recorded_at": "2026-02-16T10:00:00Z",
                "extra_data": {},
            },
            format="json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(create_resp.data["case"])
        self.assertEqual(create_resp.data["status"], "pending")

        self.client.force_authenticate(self.detective)
        assign_resp = self.client.post(
            reverse("evidence-assign-case", args=[create_resp.data["id"]]),
            {"case": self.case.id},
            format="json",
        )
        self.assertEqual(assign_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(assign_resp.data["case"], self.case.id)
        self.assertEqual(assign_resp.data["status"], "approved")

    def test_closed_case_cannot_receive_new_evidence(self):
        self.case.status = Case.Status.CLOSED
        self.case.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.detective)
        create_resp = self.client.post(
            reverse("evidence-list"),
            {
                "case": self.case.id,
                "type": "generic",
                "title": "Closed case evidence",
                "description": "desc",
                "recorded_at": "2026-02-16T10:00:00Z",
                "extra_data": {},
            },
            format="json",
        )
        self.assertEqual(create_resp.status_code, status.HTTP_400_BAD_REQUEST)
