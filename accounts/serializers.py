import re

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q
from rest_framework import serializers

User = get_user_model()


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("id", "codename", "name", "content_type")


class RoleSerializer(serializers.ModelSerializer):
    visibility_role = serializers.SerializerMethodField()
    permissions = PermissionSerializer(many=True, read_only=True)

    class Meta:
        model = Group
        fields = ("id", "name", "visibility_role", "permissions")

    def get_visibility_role(self, obj) -> str:
        try:
            profile = obj.role_profile
        except ObjectDoesNotExist:
            profile = None
        return profile.visibility_role if profile and profile.visibility_role else ""


class UserSerializer(serializers.ModelSerializer):
    roles = RoleSerializer(many=True, read_only=True, source="groups")

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "national_id",
            "phone_number",
            "is_active",
            "is_superuser",
            "is_staff",
            "roles",
        )
        read_only_fields = ("is_active",)


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


class AuthResponseSerializer(serializers.Serializer):
    user = UserSerializer()
    tokens = TokenPairSerializer()


class DetailResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()


class SeedStatusResponseSerializer(serializers.Serializer):
    already_seeded = serializers.BooleanField()


class SuperuserStatusResponseSerializer(serializers.Serializer):
    has_superuser = serializers.BooleanField()


class SuperuserListResponseSerializer(serializers.Serializer):
    superusers = serializers.ListField(child=serializers.CharField())


class SeedActionResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
    stats = serializers.DictField(required=False)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = (
            "username",
            "email",
            "first_name",
            "last_name",
            "national_id",
            "phone_number",
            "password",
        )
        extra_kwargs = {
            "username": {"error_messages": {"unique": "Username already exists."}},
            "email": {"error_messages": {"unique": "Email already exists."}},
            "national_id": {"error_messages": {"unique": "National ID already exists."}},
            "phone_number": {"error_messages": {"unique": "Phone number already exists."}},
        }

    def validate(self, attrs):
        errors = {}
        required = ["username", "email", "first_name", "last_name", "national_id", "phone_number", "password"]
        for field in required:
            value = attrs.get(field)
            if value is None or not str(value).strip():
                errors[field] = "This field is required."
        if errors:
            raise serializers.ValidationError(errors)
        attrs["username"] = attrs["username"].strip()
        attrs["email"] = attrs["email"].strip().lower()
        attrs["first_name"] = attrs["first_name"].strip()
        attrs["last_name"] = attrs["last_name"].strip()
        attrs["national_id"] = attrs["national_id"].strip()
        attrs["phone_number"] = attrs["phone_number"].strip()
        return attrs

    def validate_username(self, value):
        username = value.strip()
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("Username already exists.")
        if not re.match(r"^[A-Za-z0-9._-]{3,30}$", username):
            raise serializers.ValidationError(
                "Username must be 3-30 characters and contain only letters, numbers, ., _, or -."
            )
        return username

    def validate_email(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Email already exists.")
        return email

    def validate_national_id(self, value):
        national_id = value.strip()
        if User.objects.filter(national_id=national_id).exists():
            raise serializers.ValidationError("National ID already exists.")
        if not national_id.isdigit() or len(national_id) != 10:
            raise serializers.ValidationError("National ID must be exactly 10 digits.")
        return national_id

    def validate_phone_number(self, value):
        phone = value.strip()
        if User.objects.filter(phone_number=phone).exists():
            raise serializers.ValidationError("Phone number already exists.")
        if not phone.isdigit() or len(phone) not in [10, 11]:
            raise serializers.ValidationError("Phone number must be 10 or 11 digits.")
        return phone

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        return user


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        identifier = attrs.get("identifier")
        password = attrs.get("password")
        user = (
            User.objects.filter(
                Q(username__iexact=identifier)
                | Q(email__iexact=identifier)
                | Q(phone_number__iexact=identifier)
                | Q(national_id__iexact=identifier)
            )
            .select_related()
            .first()
        )
        if not user or not user.check_password(password):
            raise serializers.ValidationError({"detail": "Invalid credentials"})
        if not user.is_active:
            raise serializers.ValidationError({"detail": "User is inactive"})
        attrs["user"] = user
        return attrs


class RoleCreateUpdateSerializer(serializers.ModelSerializer):
    permission_ids = serializers.PrimaryKeyRelatedField(
        queryset=Permission.objects.all(), write_only=True, many=True, required=False
    )
    visibility_role = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Group
        fields = ("id", "name", "visibility_role", "permission_ids")
        extra_kwargs = {"name": {"validators": []}}

    def create(self, validated_data):
        permissions = validated_data.pop("permission_ids", [])
        visibility_role = validated_data.pop("visibility_role", "")
        group = Group.objects.create(**validated_data)
        if visibility_role is not None:
            from .models import RoleProfile

            profile, _ = RoleProfile.objects.get_or_create(group=group)
            profile.visibility_role = visibility_role or ""
            profile.save(update_fields=["visibility_role"])
        if permissions:
            group.permissions.set(permissions)
        return group

    def update(self, instance, validated_data):
        permissions = validated_data.pop("permission_ids", None)
        visibility_role = validated_data.pop("visibility_role", None)
        instance.name = validated_data.get("name", instance.name)
        instance.save()
        if permissions is not None:
            instance.permissions.set(permissions)
        if visibility_role is not None:
            from .models import RoleProfile

            profile, _ = RoleProfile.objects.get_or_create(group=instance)
            profile.visibility_role = visibility_role or ""
            profile.save(update_fields=["visibility_role"])
        return instance
