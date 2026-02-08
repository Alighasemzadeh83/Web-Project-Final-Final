from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
    ResetDataView,
    RoleViewSet,
    SeedDataView,
    SeedStatusView,
    SuperuserListView,
    SuperuserStatusView,
    UserViewSet,
)

router = DefaultRouter()
router.register(r"roles", RoleViewSet, basename="role")
router.register(r"users", UserViewSet, basename="user")

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("seed/", SeedDataView.as_view(), name="seed-data"),
    path("seed-status/", SeedStatusView.as_view(), name="seed-status"),
    path("reset/", ResetDataView.as_view(), name="reset-data"),
    path("superuser-status/", SuperuserStatusView.as_view(), name="superuser-status"),
    path("superusers/", SuperuserListView.as_view(), name="superuser-list"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("", include(router.urls)),
]
