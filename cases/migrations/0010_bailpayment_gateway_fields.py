from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("cases", "0009_tip_suspect_national_id_alter_tip_reward_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="bailpayment",
            name="gateway",
            field=models.CharField(choices=[("zarinpal", "Zarinpal")], default="zarinpal", max_length=20),
        ),
        migrations.AddField(
            model_name="bailpayment",
            name="authority",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="bailpayment",
            name="gateway_url",
            field=models.URLField(blank=True, default=""),
        ),
    ]
