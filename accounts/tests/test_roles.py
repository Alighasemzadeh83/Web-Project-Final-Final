from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()


class RoleTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="AdminPass123",
            national_id="1111111111",
            phone_number="09000000000",
        )
        self.client.force_authenticate(self.admin)

    def test_create_role_and_assign(self):
        role_resp = self.client.post(reverse("role-list"), {"name": "Detective"}, format="json")
        self.assertIn(role_resp.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])
        role_id = role_resp.data["id"]

        user = User.objects.create_user(
            username="officer",
            email="officer@example.com",
            password="Officer123",
            national_id="2222222222",
            phone_number="09110000000",
        )

        assign_resp = self.client.patch(
            reverse("user-update-roles", args=[user.id]),
            {"role_ids": [role_id]},
            format="json",
        )
        self.assertEqual(assign_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(assign_resp.data["roles"][0]["name"], "Detective")
