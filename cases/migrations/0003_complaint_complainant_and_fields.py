from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ("cases", "0002_bailpayment_payment_type_bailpayment_reason_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="person",
            name="photo_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="evidence",
            name="recorded_at",
            field=models.DateTimeField(default=timezone.now),
        ),
        migrations.AddField(
            model_name="suspectevaluation",
            name="sergeant_decision",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AlterField(
            model_name="suspectevaluation",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("submitted", "Submitted"),
                    ("returned", "Returned to detective"),
                    ("reviewed", "Reviewed"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name="ComplaintComplainant",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("rejection_reason", models.TextField(blank=True, default="")),
                (
                    "complaint",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="extra_complainants", to="cases.complaint"),
                ),
                (
                    "person",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="complaints_as_extra", to="cases.person"),
                ),
                (
                    "reviewed_by_cadet",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="complainant_reviews",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "unique_together": {("complaint", "person")},
            },
        ),
        migrations.AddIndex(
            model_name="complaintcomplainant",
            index=models.Index(fields=["status"], name="cases_compl_status_1ccf8e_idx"),
        ),
    ]
