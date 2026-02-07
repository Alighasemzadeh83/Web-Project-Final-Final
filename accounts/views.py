from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .seed import reset_demo_data, seed_demo_data, seed_exists
from .permissions import IsAdminOrRole
from .serializers import (
    AuthResponseSerializer,
    DetailResponseSerializer,
    LoginSerializer,
    RegisterSerializer,
    SeedActionResponseSerializer,
    SeedStatusResponseSerializer,
    RoleCreateUpdateSerializer,
    RoleSerializer,
    SuperuserListResponseSerializer,
    SuperuserStatusResponseSerializer,
    UserSerializer,
)

User = get_user_model()

DEFAULT_ROLES = [
    "Administrator",
    "Chief",
    "Captain",
    "Sergeant",
    "Detective",
    "Officer",
    "Patrol Officer",
    "Cadet",
    "Coroner",
    "Judge",
    "Citizen",
]


def ensure_default_roles():
    for name in DEFAULT_ROLES:
        Group.objects.get_or_create(name=name)


def _issue_tokens_for_user(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=RegisterSerializer,
        responses={201: AuthResponseSerializer},
        examples=[
            OpenApiExample(
                "Register Request",
                value={
                    "username": "citizen1",
                    "email": "citizen1@example.com",
                    "first_name": "Citizen",
                    "last_name": "One",
                    "national_id": "1234567890",
                    "phone_number": "09120000000",
                    "password": "StrongPass123",
                },
                request_only=True,
            ),
            OpenApiExample(
                "Register Response",
                value={
                    "user": {
                        "id": 1,
                        "username": "citizen1",
                        "email": "citizen1@example.com",
                        "first_name": "Citizen",
                        "last_name": "One",
                        "national_id": "1234567890",
                        "phone_number": "09120000000",
                        "is_active": True,
                        "is_superuser": False,
                        "is_staff": False,
                        "roles": [],
                    },
                    "tokens": {"access": "jwt-access", "refresh": "jwt-refresh"},
                },
                response_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        tokens = _issue_tokens_for_user(user)
        return Response({"user": UserSerializer(user).data, "tokens": tokens}, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=LoginSerializer,
        responses={200: AuthResponseSerializer},
        examples=[
            OpenApiExample(
                "Login Request",
                value={"identifier": "citizen1", "password": "StrongPass123"},
                request_only=True,
            ),
            OpenApiExample(
                "Login Response",
                value={
                    "user": {
                        "id": 1,
                        "username": "citizen1",
                        "email": "citizen1@example.com",
                        "first_name": "Citizen",
                        "last_name": "One",
                        "national_id": "1234567890",
                        "phone_number": "09120000000",
                        "is_active": True,
                        "is_superuser": False,
                        "is_staff": False,
                        "roles": [],
                    },
                    "tokens": {"access": "jwt-access", "refresh": "jwt-refresh"},
                },
                response_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        tokens = _issue_tokens_for_user(user)
        return Response({"user": UserSerializer(user).data, "tokens": tokens})


class MeView(APIView):
    @extend_schema(responses={200: UserSerializer})
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    @extend_schema(request=None, responses={200: DetailResponseSerializer})
    def post(self, request):
        # Stateless JWT logout: client should discard tokens.
        return Response({"detail": "Logged out"}, status=status.HTTP_200_OK)


class SeedDataView(APIView):
    """
    Seed demo data for easier testing (roles, users, complaints, cases, etc.).
    Admin-only.
    """

    permission_classes = [IsAdminOrRole]

    @extend_schema(request=None, responses={200: SeedActionResponseSerializer, 201: SeedActionResponseSerializer})
    def post(self, request):
        stats = seed_demo_data()
        if stats.get("already_seeded"):
            return Response({"detail": "Seed already exists", "stats": stats}, status=status.HTTP_200_OK)
        return Response({"detail": "Seed completed", "stats": stats}, status=status.HTTP_201_CREATED)


class SeedStatusView(APIView):
    permission_classes = [IsAdminOrRole]

    @extend_schema(responses={200: SeedStatusResponseSerializer})
    def get(self, request):
        return Response({"already_seeded": seed_exists()})


class ResetDataView(APIView):
    """
    Reset database and re-seed demo data. Admin-only and DEBUG-only.
    """

    permission_classes = [IsAdminOrRole]

    @extend_schema(request=None, responses={200: SeedActionResponseSerializer})
    def post(self, request):
        if not settings.DEBUG:
            return Response({"error": "Reset is only available in DEBUG mode."}, status=status.HTTP_403_FORBIDDEN)
        stats = reset_demo_data()
        return Response(
            {"detail": "Reset completed", "stats": stats},
            status=status.HTTP_200_OK,
        )


class SuperuserStatusView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: SuperuserStatusResponseSerializer})
    def get(self, request):
        return Response({"has_superuser": User.objects.filter(is_superuser=True).exists()})


class SuperuserListView(APIView):
    permission_classes = [IsAdminOrRole]

    @extend_schema(responses={200: SuperuserListResponseSerializer})
    def get(self, request):
        usernames = list(User.objects.filter(is_superuser=True).values_list("username", flat=True))
        return Response({"superusers": usernames})


class RoleViewSet(viewsets.ModelViewSet):
    """
    Dynamic role (Group) management. Only staff/admin can manage roles.
    """

    queryset = Group.objects.all().order_by("name")
    permission_classes = [IsAdminOrRole]

    def get_queryset(self):
        ensure_default_roles()
        return super().get_queryset()

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return RoleCreateUpdateSerializer
        return RoleSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data.get("name")
        role = Group.objects.filter(name__iexact=name).first()
        if role:
            update_serializer = self.get_serializer(role, data=request.data, partial=True)
            update_serializer.is_valid(raise_exception=True)
            role = update_serializer.save()
            data = RoleSerializer(role, context={"request": request}).data
            return Response(data, status=status.HTTP_200_OK)
        role = serializer.save()
        data = RoleSerializer(role, context={"request": request}).data
        return Response(data, status=status.HTTP_201_CREATED)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Admin-facing user listing with ability to assign roles.
    """

    queryset = User.objects.all().order_by("id")
    serializer_class = UserSerializer
    permission_classes = [IsAdminOrRole]
    search_fields = ["username", "email", "first_name", "last_name", "national_id", "phone_number"]

    @action(detail=True, methods=["patch"], url_path="roles")
    def update_roles(self, request, pk=None):
        user = self.get_object()
        role_ids = request.data.get("role_ids", [])
        roles = Group.objects.filter(id__in=role_ids)
        user.groups.set(roles)
        if "is_superuser" in request.data:
            return Response(
                {"detail": "Superuser status cannot be modified via this endpoint."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.save()
        return Response(UserSerializer(user).data)
