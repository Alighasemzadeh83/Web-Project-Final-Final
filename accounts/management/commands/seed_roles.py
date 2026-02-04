from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


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


class Command(BaseCommand):
    help = "Seed default roles (Groups). Safe to run multiple times."

    def handle(self, *args, **options):
        for role in DEFAULT_ROLES:
            Group.objects.get_or_create(name=role)
        self.stdout.write(self.style.SUCCESS("Default roles ensured."))
