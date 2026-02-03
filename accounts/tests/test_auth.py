from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()


class AuthTests(APITestCase):
    def setUp(self):
        self.base_payload = {
            "username": "user1",
            "email": "user1@example.com",
            "first_name": "User",
            "last_name": "One",
            "national_id": "1234567890",
            "phone_number": "09120000000",
            "password": "StrongPass123",
        }

    def test_register_login_me(self):
        resp = self.client.post(reverse("register"), self.base_payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("tokens", resp.data)

        login_resp = self.client.post(
            reverse("login"),
            {"identifier": "user1", "password": "StrongPass123"},
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)
        token = login_resp.data["tokens"]["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_resp = self.client.get(reverse("me"))
        self.assertEqual(me_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(me_resp.data["username"], "user1")

    def test_register_duplicate_username_returns_message(self):
        self.client.post(reverse("register"), self.base_payload, format="json")
        dup_payload = {
            **self.base_payload,
            "email": "user1-dup@example.com",
            "national_id": "1234567891",
            "phone_number": "09120000001",
        }
        resp = self.client.post(reverse("register"), dup_payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        message = str(resp.data.get("error", {}).get("details", {}).get("username", [""])[0]).lower()
        self.assertIn("already exists", message)

    def test_register_invalid_phone_returns_validation_error(self):
        bad_payload = {**self.base_payload, "username": "user2", "email": "user2@example.com", "phone_number": "abc"}
        resp = self.client.post(reverse("register"), bad_payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        message = str(resp.data.get("error", {}).get("details", {}).get("phone_number", [""])[0]).lower()
        self.assertIn("phone number must be", message)

    def test_login_with_email_identifier(self):
        self.client.post(reverse("register"), self.base_payload, format="json")
        login_resp = self.client.post(
            reverse("login"),
            {"identifier": "user1@example.com", "password": "StrongPass123"},
            format="json",
        )
        self.assertEqual(login_resp.status_code, status.HTTP_200_OK)
        self.assertIn("tokens", login_resp.data)

    def test_superuser_status_endpoint_returns_boolean(self):
        resp = self.client.get(reverse("superuser-status"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("has_superuser", resp.data)
