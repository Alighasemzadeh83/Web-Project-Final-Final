from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, Tip
from cases.utils import generate_case_number

User = get_user_model()


class TipFlowTests(APITestCase):
    def setUp(self):
        self.officer_group, _ = Group.objects.get_or_create(name="Officer")
        self.detective_group, _ = Group.objects.get_or_create(name="Detective")
        self.officer = User.objects.create_user(
            username="officer3",
            email="officer3@example.com",
            password="Officer12345",
            national_id="7777777777",
            phone_number="09127777777",
        )
        self.officer.groups.add(self.officer_group)
        self.detective = User.objects.create_user(
            username="detective1",
            email="detective1@example.com",
            password="Detective12345",
            national_id="8888888888",
            phone_number="09128888888",
        )
        self.detective.groups.add(self.detective_group)
        self.case = Case.objects.create(
            number=generate_case_number(),
            title="Tip Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.ACTIVE,
        )

    def test_tip_review_flow(self):
        citizen = User.objects.create_user(
            username="citizen",
            email="citizen@example.com",
            password="Citizen12345",
            national_id="9999999999",
            phone_number="09129999999",
        )
        self.client.force_authenticate(citizen)
        tip_resp = self.client.post(
            reverse("tip-list"),
            {"description": "I saw someone."},
            format="json",
        )
        self.assertEqual(tip_resp.status_code, status.HTTP_201_CREATED)
        tip_id = tip_resp.data["id"]
        self.assertIsNone(tip_resp.data.get("case"))

        self.client.force_authenticate(self.officer)
        officer_resp = self.client.post(
            reverse("tip-officer-review", args=[tip_id]),
            {"decision": "forward"},
            format="json",
        )
        self.assertEqual(officer_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(officer_resp.data["status"], Tip.Status.SENT_TO_DETECTIVE)

        self.client.force_authenticate(self.detective)
        detective_resp = self.client.post(
            reverse("tip-detective-review", args=[tip_id]),
            {"decision": "approve", "reward_amount": 5000, "case": self.case.id},
            format="json",
        )
        self.assertEqual(detective_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(detective_resp.data["status"], Tip.Status.APPROVED)
        self.assertTrue(detective_resp.data["reward_code"])
        self.assertEqual(detective_resp.data["case"], self.case.id)

    def test_citizen_cannot_submit_tip_for_unrelated_case(self):
        citizen = User.objects.create_user(
            username="citizen_case_guard",
            email="citizen_case_guard@example.com",
            password="Citizen12345",
            national_id="1111222233",
            phone_number="09120003333",
        )
        self.client.force_authenticate(citizen)
        tip_resp = self.client.post(
            reverse("tip-list"),
            {"case": self.case.id, "description": "I should not access this case."},
            format="json",
        )
        self.assertEqual(tip_resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_closed_case_cannot_receive_tip(self):
        self.case.status = Case.Status.CLOSED
        self.case.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.detective)
        tip_resp = self.client.post(
            reverse("tip-list"),
            {"case": self.case.id, "description": "Tip for closed case"},
            format="json",
        )
        self.assertEqual(tip_resp.status_code, status.HTTP_400_BAD_REQUEST)
