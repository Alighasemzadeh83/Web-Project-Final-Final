from django.contrib.auth.models import AbstractUser, Group
from django.db import models


class User(AbstractUser):
    """
    Custom user model to support login by username/email/phone/national_id.
    Group/Permission objects provide dynamic role management.
    """

    email = models.EmailField(unique=True)
    national_id = models.CharField(max_length=20, unique=True)
    phone_number = models.CharField(max_length=20, unique=True)

    REQUIRED_FIELDS = ["email", "first_name", "last_name", "national_id", "phone_number"]

    def __str__(self) -> str:
        return f"{self.username} ({self.get_full_name()})"

    class Meta:
        indexes = [
            models.Index(fields=["username"]),
            models.Index(fields=["email"]),
            models.Index(fields=["phone_number"]),
            models.Index(fields=["national_id"]),
        ]


class RoleProfile(models.Model):
    """
    Optional role metadata for UI/permission aliasing.
    visibility_role lets a custom role inherit visibility from a base role.
    """

    group = models.OneToOneField(Group, on_delete=models.CASCADE, related_name="role_profile")
    visibility_role = models.CharField(max_length=50, blank=True, default="")

    def __str__(self) -> str:
        return f"{self.group.name} -> {self.visibility_role or 'custom'}"
