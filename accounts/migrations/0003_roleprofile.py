from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("accounts", "0002_default_roles"),
    ]

    operations = [
        migrations.CreateModel(
            name="RoleProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("visibility_role", models.CharField(blank=True, default="", max_length=50)),
                (
                    "group",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="role_profile",
                        to="auth.group",
                    ),
                ),
            ],
        ),
    ]
