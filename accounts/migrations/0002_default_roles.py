from django.db import migrations


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
]


def create_default_roles(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for name in DEFAULT_ROLES:
        Group.objects.get_or_create(name=name)


def remove_default_roles(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name__in=DEFAULT_ROLES).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_default_roles, reverse_code=remove_default_roles),
    ]
