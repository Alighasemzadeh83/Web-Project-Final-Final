from rest_framework.permissions import BasePermission


class IsAdminOrRole(BasePermission):
    """
    Allow access to superusers or users with Administrator role.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        if user.groups.filter(name__iexact="Administrator").exists():
            return True
        for group in user.groups.all():
            try:
                profile = group.role_profile
            except Exception:
                profile = None
            if profile and profile.visibility_role and profile.visibility_role.lower().strip() == "administrator":
                return True
        return False
