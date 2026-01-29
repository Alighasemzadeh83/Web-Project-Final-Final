from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cases", "0006_fieldreport_alter_case_status_fieldreportwitness_and_more"),
        ("cases", "0005_suspectevaluation_detected_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="case",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_approval", "Pending approval"),
                    ("detective_pending", "Detective pending"),
                    ("sergeant_pending", "Sergeant pending"),
                    ("active", "Active"),
                    ("detective_followup", "Detective follow-up"),
                    ("captain_review", "Captain review"),
                    ("chief_review", "Chief review"),
                    ("in_progress", "In progress"),
                    ("in_trial", "In trial"),
                    ("closed", "Closed"),
                    ("rejected", "Rejected"),
                ],
                default="detective_pending",
                max_length=20,
            ),
        ),
    ]
