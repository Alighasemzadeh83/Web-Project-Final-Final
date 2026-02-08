from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Complaint, Case

User = get_user_model()


class ComplaintFlowTests(APITestCase):
    def setUp(self):
        self.cadet_group, _ = Group.objects.get_or_create(name="Cadet")
        self.officer_group, _ = Group.objects.get_or_create(name="Officer")

        self.complainant = User.objects.create_user(
            username="complainant",
            email="complainant@example.com",
            password="Pass12345",
            national_id="3333333333",
            phone_number="09123333333",
        )
        self.cadet = User.objects.create_user(
            username="cadet",
            email="cadet@example.com",
            password="Cadet12345",
            national_id="4444444444",
            phone_number="09124444444",
        )
        self.officer = User.objects.create_user(
            username="officer",
            email="officer@example.com",
            password="Officer12345",
            national_id="5555555555",
            phone_number="09125555555",
        )
        self.cadet.groups.add(self.cadet_group)
        self.officer.groups.add(self.officer_group)

    def test_complaint_to_case_flow(self):
        # complainant files complaint
        self.client.force_authenticate(self.complainant)
        resp = self.client.post(
            reverse("complaint-list"),
            {"title": "Robbery", "description": "Stolen car"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        complaint_id = resp.data["id"]

        # cadet approves
        self.client.force_authenticate(self.cadet)
        cadet_resp = self.client.post(
            reverse("complaint-cadet-review", args=[complaint_id]),
            {"approve": True},
            format="json",
        )
        self.assertEqual(cadet_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(cadet_resp.data["status"], Complaint.Status.SUBMITTED)

        # officer accepts and creates case
        self.client.force_authenticate(self.officer)
        officer_resp = self.client.post(
            reverse("complaint-officer-review", args=[complaint_id]),
            {"accept": True, "severity": "level_2"},
            format="json",
        )
        self.assertEqual(officer_resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("case", officer_resp.data)
        case_number = officer_resp.data["case"]["number"]
        self.assertTrue(Case.objects.filter(number=case_number).exists())

    def test_duplicate_complainant_add_is_blocked(self):
        self.client.force_authenticate(self.complainant)
        resp = self.client.post(
            reverse("complaint-list"),
            {"title": "Duplicate complainant", "description": "desc"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        complaint_id = resp.data["id"]

        self.client.force_authenticate(self.cadet)
        duplicate_resp = self.client.post(
            reverse("complaint-add-complainant", args=[complaint_id]),
            {"identifier": self.complainant.username},
            format="json",
        )
        self.assertEqual(duplicate_resp.status_code, status.HTTP_400_BAD_REQUEST)
