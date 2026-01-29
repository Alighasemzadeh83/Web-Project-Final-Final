from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import ActivityLog

User = get_user_model()


class ActivityLogExportTests(APITestCase):
    def setUp(self):
        self.admin_group, _ = Group.objects.get_or_create(name="Administrator")
        self.admin_user = User.objects.create_user(
            username="admin_logs",
            email="admin_logs@example.com",
            password="Admin12345",
            national_id="5011111111",
            phone_number="09125001111",
        )
        self.admin_user.groups.add(self.admin_group)
        self.regular_user = User.objects.create_user(
            username="regular_logs",
            email="regular_logs@example.com",
            password="User12345",
            national_id="5022222222",
            phone_number="09125002222",
        )
        ActivityLog.objects.create(
            actor=self.admin_user,
            action="seed_workspace",
            target_type="system",
            target_id="1",
            message="Seed complete",
        )

    def test_admin_can_export_logs(self):
        self.client.force_authenticate(self.admin_user)
        resp = self.client.get(reverse("activitylog-export"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("text/csv", resp["Content-Type"])
        self.assertIn("attachment;", resp["Content-Disposition"])
        self.assertIn("seed_workspace", resp.content.decode("utf-8"))

    def test_non_admin_cannot_export_logs(self):
        self.client.force_authenticate(self.regular_user)
        resp = self.client.get(reverse("activitylog-export"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
