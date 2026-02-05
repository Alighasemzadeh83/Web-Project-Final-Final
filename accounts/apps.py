import sys

from django.apps import AppConfig
from django.db.utils import OperationalError, ProgrammingError

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


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        """
        Ensure default roles exist even if seed_roles command is forgotten.
        Skips during makemigrations/migrate commands before tables exist.
        """
        skip_commands = {"makemigrations", "migrate"}
        if any(cmd in sys.argv for cmd in skip_commands):
            return
        try:
            from django.contrib.auth.models import Group

            for name in DEFAULT_ROLES:
                Group.objects.get_or_create(name=name)
        except (OperationalError, ProgrammingError):
            # Database tables not ready yet (e.g., during initial migrate)
            return
