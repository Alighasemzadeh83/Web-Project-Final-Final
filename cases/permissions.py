from rest_framework.permissions import BasePermission


def _get_visibility_role(group) -> str:
    try:
        profile = group.role_profile
    except Exception:
        profile = None
    return profile.visibility_role if profile and profile.visibility_role else ""


def user_role_names(user) -> list[str]:
    if not user or not user.is_authenticated:
        return []
    names: list[str] = []
    for group in user.groups.all():
        names.append(group.name)
        visibility = _get_visibility_role(group)
        if visibility:
            names.append(visibility)
    if user.is_superuser:
        names.append("Superuser")
    return names


def user_has_any_role(user, roles: list[str]) -> bool:
    if not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    if user.groups.filter(name__iexact="Administrator").exists():
        return True
    desired = {role.lower().strip() for role in roles}
    user_roles = {name.lower().strip() for name in user_role_names(user)}
    return bool(user_roles.intersection(desired))


class RoleRequired(BasePermission):
    roles: list[str] = []

    def has_permission(self, request, view):
        return user_has_any_role(request.user, self.roles)


class IsCadet(RoleRequired):
    roles = ["Cadet"]


class IsOfficer(RoleRequired):
    roles = ["Officer", "Patrol Officer", "Police Officer"]


class IsPoliceRole(RoleRequired):
    roles = ["Officer", "Patrol Officer", "Police Officer", "Detective", "Sergeant", "Captain", "Chief", "Cadet"]


class IsPoliceOrCoroner(RoleRequired):
    roles = [
        "Officer",
        "Patrol Officer",
        "Police Officer",
        "Detective",
        "Sergeant",
        "Captain",
        "Chief",
        "Cadet",
        "Coroner",
    ]


class IsDetective(RoleRequired):
    roles = ["Detective"]


class IsSergeant(RoleRequired):
    roles = ["Sergeant"]


class IsCaptainOrChief(RoleRequired):
    roles = ["Captain", "Chief"]


class IsSergeantOrAbove(RoleRequired):
    roles = ["Sergeant", "Captain", "Chief"]


class IsJudge(RoleRequired):
    roles = ["Judge"]


class IsCoroner(RoleRequired):
    roles = ["Coroner"]


class IsReportViewer(RoleRequired):
    roles = ["Judge"]
