from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("cases", "0010_bailpayment_gateway_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="case",
            name="bail_amount",
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="case",
            name="fine_amount",
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="case",
            name="bail_set_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bail_set_cases",
                to="accounts.user",
            ),
        ),
        migrations.AddField(
            model_name="case",
            name="fine_set_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="fine_set_cases",
                to="accounts.user",
            ),
        ),
    ]
