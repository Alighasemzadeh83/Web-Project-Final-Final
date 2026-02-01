from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cases", "0004_rename_cases_compl_status_1ccf8e_idx_cases_compl_status_fe0851_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="suspectevaluation",
            name="detected_at",
            field=models.DateField(blank=True, null=True),
        ),
    ]

