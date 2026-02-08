from django.conf import settings
from django.db import models
from django.utils import timezone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Person(TimestampedModel):
    """
    Represents individuals involved in cases (complainant, witness, suspect, judge, etc.).
    Can be linked to a system user but is not required.
    """

    full_name = models.CharField(max_length=255)
    national_id = models.CharField(max_length=20, blank=True, null=True, unique=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    photo_url = models.URLField(blank=True, default="")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="person_records", null=True, blank=True
    )

    def __str__(self) -> str:
        return self.full_name


class Complaint(TimestampedModel):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        CADET_REVIEW = "cadet_review", "Cadet Review"
        RETURNED_TO_COMPLAINANT = "returned_to_complainant", "Returned to complainant"
        OFFICER_REVIEW = "officer_review", "Officer Review"
        RETURNED_TO_CADET = "returned_to_cadet", "Returned to cadet"
        ACCEPTED = "accepted", "Accepted"
        VOIDED = "voided", "Voided"

    title = models.CharField(max_length=255)
    description = models.TextField()
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.SUBMITTED)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="complaints", on_delete=models.CASCADE, null=True, blank=True
    )
    complainant = models.ForeignKey(Person, related_name="complaints", on_delete=models.SET_NULL, null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    rejection_reason = models.TextField(blank=True, default="")
    reviewed_by_cadet = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="cadet_reviews", on_delete=models.SET_NULL, null=True, blank=True
    )
    reviewed_by_officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="officer_reviews", on_delete=models.SET_NULL, null=True, blank=True
    )

    def mark_return_to_complainant(self, reason: str):
        self.attempts += 1
        self.rejection_reason = reason
        self.status = self.Status.RETURNED_TO_COMPLAINANT

    def mark_void(self, reason: str):
        self.rejection_reason = reason
        self.status = self.Status.VOIDED

    class Meta:
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["attempts"]),
        ]


class ComplaintComplainant(TimestampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REMOVED = "removed", "Removed"

    class OfficerStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    complaint = models.ForeignKey(Complaint, related_name="extra_complainants", on_delete=models.CASCADE)
    person = models.ForeignKey(Person, related_name="complaints_as_extra", on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    cadet_attempts = models.PositiveSmallIntegerField(default=0)
    officer_status = models.CharField(max_length=20, choices=OfficerStatus.choices, default=OfficerStatus.PENDING)
    reviewed_by_cadet = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="complainant_reviews", on_delete=models.SET_NULL, null=True, blank=True
    )
    reviewed_by_officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="complainant_officer_reviews", on_delete=models.SET_NULL, null=True, blank=True
    )
    rejection_reason = models.TextField(blank=True, default="")
    officer_rejection_reason = models.TextField(blank=True, default="")

    class Meta:
        unique_together = ("complaint", "person")
        indexes = [models.Index(fields=["status"]), models.Index(fields=["officer_status"])]


class Case(TimestampedModel):
    class ApprovalStage(models.TextChoices):
        DETECTIVE = "detective", "Detective"
        SERGEANT = "sergeant", "Sergeant"
        CAPTAIN = "captain", "Captain"
        CHIEF = "chief", "Chief"
        FINAL = "final", "Final"
    class Severity(models.TextChoices):
        LEVEL_3 = "level_3", "Level 3 (minor)"
        LEVEL_2 = "level_2", "Level 2 (medium)"
        LEVEL_1 = "level_1", "Level 1 (major)"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        PENDING_APPROVAL = "pending_approval", "Pending approval"
        DETECTIVE_PENDING = "detective_pending", "Detective pending"
        SERGEANT_PENDING = "sergeant_pending", "Sergeant pending"
        ACTIVE = "active", "Active"
        DETECTIVE_FOLLOWUP = "detective_followup", "Detective follow-up"
        CAPTAIN_REVIEW = "captain_review", "Captain review"
        CHIEF_REVIEW = "chief_review", "Chief review"
        IN_PROGRESS = "in_progress", "In progress"
        IN_TRIAL = "in_trial", "In trial"
        CLOSED = "closed", "Closed"
        REJECTED = "rejected", "Rejected"

    class Source(models.TextChoices):
        COMPLAINT = "complaint", "Complaint"
        FIELD_REPORT = "field_report", "Field report"

    number = models.CharField(max_length=32, unique=True)
    title = models.CharField(max_length=255)
    description = models.TextField()
    source = models.CharField(max_length=20, choices=Source.choices)
    complaint = models.OneToOneField(
        Complaint, related_name="case", on_delete=models.SET_NULL, null=True, blank=True
    )
    severity = models.CharField(max_length=12, choices=Severity.choices, default=Severity.LEVEL_3)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DETECTIVE_PENDING)
    approval_stage = models.CharField(
        max_length=20,
        choices=ApprovalStage.choices,
        default=ApprovalStage.DETECTIVE,
    )
    status_note = models.TextField(blank=True, default="")
    location = models.CharField(max_length=255, blank=True, default="")
    occurred_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    bail_amount = models.BigIntegerField(null=True, blank=True)
    fine_amount = models.BigIntegerField(null=True, blank=True)
    bail_set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="bail_set_cases", on_delete=models.SET_NULL, null=True, blank=True
    )
    fine_set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="fine_set_cases", on_delete=models.SET_NULL, null=True, blank=True
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="cases_created", on_delete=models.SET_NULL, null=True, blank=True
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="cases_supervising", on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        indexes = [
            models.Index(fields=["number"]),
            models.Index(fields=["severity"]),
            models.Index(fields=["status"]),
        ]


class CaseComplainantReview(TimestampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REMOVED = "removed", "Removed"

    class OfficerStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    case = models.ForeignKey(Case, related_name="complainant_reviews", on_delete=models.CASCADE)
    person = models.ForeignKey(Person, related_name="case_complainant_reviews", on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    cadet_attempts = models.PositiveSmallIntegerField(default=0)
    officer_status = models.CharField(max_length=20, choices=OfficerStatus.choices, default=OfficerStatus.PENDING)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="case_complainants_added",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    reviewed_by_cadet = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="case_complainants_cadet_reviewed",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    reviewed_by_officer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="case_complainants_officer_reviewed",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    rejection_reason = models.TextField(blank=True, default="")
    officer_rejection_reason = models.TextField(blank=True, default="")

    class Meta:
        unique_together = ("case", "person")
        indexes = [models.Index(fields=["status"]), models.Index(fields=["officer_status"])]


class CaseParticipant(TimestampedModel):
    class Role(models.TextChoices):
        COMPLAINANT = "complainant", "Complainant"
        WITNESS = "witness", "Witness"
        SUSPECT = "suspect", "Suspect"
        CRIMINAL = "criminal", "Criminal"
        JUDGE = "judge", "Judge"
        DETECTIVE = "detective", "Detective"
        SERGEANT = "sergeant", "Sergeant"
        CAPTAIN = "captain", "Captain"
        CHIEF = "chief", "Chief"
        CORONER = "coroner", "Coroner"
        OFFICER = "officer", "Officer"
        CADET = "cadet", "Cadet"

    case = models.ForeignKey(Case, related_name="participants", on_delete=models.CASCADE)
    person = models.ForeignKey(Person, related_name="case_participations", on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=Role.choices)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="assigned_participants", on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        unique_together = ("case", "person", "role")
        indexes = [models.Index(fields=["role"])]


class FieldReport(TimestampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    class ApprovalStage(models.TextChoices):
        DETECTIVE = "detective", "Detective"
        SERGEANT = "sergeant", "Sergeant"
        CAPTAIN = "captain", "Captain"

    number = models.CharField(max_length=32, unique=True)
    title = models.CharField(max_length=255)
    description = models.TextField()
    severity = models.CharField(max_length=12, choices=Case.Severity.choices, default=Case.Severity.LEVEL_3)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    approval_stage = models.CharField(
        max_length=20,
        choices=ApprovalStage.choices,
        default=ApprovalStage.DETECTIVE,
    )
    location = models.CharField(max_length=255, blank=True, default="")
    occurred_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="field_reports_created", on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        indexes = [
            models.Index(fields=["number"]),
            models.Index(fields=["severity"]),
            models.Index(fields=["status"]),
        ]


class FieldReportWitness(TimestampedModel):
    report = models.ForeignKey(FieldReport, related_name="witnesses", on_delete=models.CASCADE)
    person = models.ForeignKey(Person, related_name="field_report_witnesses", on_delete=models.CASCADE)

    class Meta:
        unique_together = ("report", "person")


class Evidence(TimestampedModel):
    class Type(models.TextChoices):
        TESTIMONY = "testimony", "Testimony"
        FORENSIC = "forensic", "Forensic"
        VEHICLE = "vehicle", "Vehicle"
        ID_DOCUMENT = "id_document", "ID Document"
        GENERIC = "generic", "Generic"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    case = models.ForeignKey(Case, related_name="evidences", on_delete=models.CASCADE, null=True, blank=True)
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.GENERIC)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="evidences_recorded", on_delete=models.SET_NULL, null=True, blank=True
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    status_note = models.TextField(blank=True, default="")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="evidences_reviewed", on_delete=models.SET_NULL, null=True, blank=True
    )
    extra_data = models.JSONField(default=dict, blank=True)
    recorded_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["type"]),
            models.Index(fields=["status"]),
        ]


class EvidenceAttachment(TimestampedModel):
    evidence = models.ForeignKey(Evidence, related_name="attachments", on_delete=models.CASCADE)
    file = models.FileField(upload_to="evidence/")
    description = models.CharField(max_length=255, blank=True, default="")


class DetectiveBoard(TimestampedModel):
    case = models.OneToOneField(Case, related_name="board", on_delete=models.CASCADE)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="boards", on_delete=models.SET_NULL, null=True, blank=True
    )
    background_color = models.CharField(max_length=20, default="#2a2018")


class BoardNote(TimestampedModel):
    board = models.ForeignKey(DetectiveBoard, related_name="notes", on_delete=models.CASCADE)
    label = models.CharField(max_length=255)
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    color = models.CharField(max_length=20, default="#f59e0b")
    evidence = models.ForeignKey(
        Evidence, related_name="board_notes", on_delete=models.SET_NULL, null=True, blank=True
    )


class BoardLink(TimestampedModel):
    board = models.ForeignKey(DetectiveBoard, related_name="links", on_delete=models.CASCADE)
    source = models.ForeignKey(BoardNote, related_name="source_links", on_delete=models.CASCADE)
    target = models.ForeignKey(BoardNote, related_name="target_links", on_delete=models.CASCADE)


class PursuitStatus(TimestampedModel):
    class Status(models.TextChoices):
        WANTED = "wanted", "Wanted"
        HIGH_ALERT = "high_alert", "High alert"
        CAPTURED = "captured", "Captured"
        TRIAL = "trial", "Trial"
        CLOSED = "closed", "Closed"

    case = models.ForeignKey(Case, related_name="pursuits", on_delete=models.CASCADE)
    suspect = models.ForeignKey(Person, related_name="pursuits", on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WANTED)
    pursuit_started_at = models.DateField(default=timezone.now)
    severity_at_report = models.CharField(max_length=12, choices=Case.Severity.choices, default=Case.Severity.LEVEL_3)
    high_alert_at = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = ("case", "suspect")
        indexes = [models.Index(fields=["status"])]

    @property
    def days_under_pursuit(self) -> int:
        return (timezone.now().date() - self.pursuit_started_at).days

    @property
    def severity_score(self) -> int:
        mapping = {
            Case.Severity.LEVEL_3: 1,
            Case.Severity.LEVEL_2: 2,
            Case.Severity.LEVEL_1: 3,
            Case.Severity.CRITICAL: 4,
        }
        return mapping.get(self.severity_at_report, 1)

    @property
    def rank_score(self) -> int:
        # max(L_j) * max(D_i)
        return self.days_under_pursuit * self.severity_score

    def ensure_high_alert(self):
        if self.status == self.Status.WANTED and self.days_under_pursuit >= 30:
            self.status = self.Status.HIGH_ALERT
            if not self.high_alert_at:
                self.high_alert_at = timezone.now().date()
            self.save(update_fields=["status", "high_alert_at", "updated_at"])


class Tip(TimestampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        OFFICER_REJECTED = "officer_rejected", "Officer rejected"
        SENT_TO_DETECTIVE = "sent_to_detective", "Sent to detective"
        DETECTIVE_REJECTED = "detective_rejected", "Detective rejected"
        APPROVED = "approved", "Approved"
        REWARDED = "rewarded", "Reward paid"

    case = models.ForeignKey(Case, related_name="tips", on_delete=models.SET_NULL, null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="tips", on_delete=models.SET_NULL, null=True, blank=True
    )
    contact_name = models.CharField(max_length=255, blank=True, default="")
    contact_phone = models.CharField(max_length=20, blank=True, default="")
    suspect_national_id = models.CharField(max_length=20, blank=True, default="")
    description = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    officer_reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="tips_officer_reviewed",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    detective_reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="tips_detective_reviewed",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    reward_code = models.CharField(max_length=64, null=True, blank=True, default=None, unique=True)
    reward_amount = models.BigIntegerField(default=0)


class BailPayment(TimestampedModel):
    class Type(models.TextChoices):
        BAIL = "bail", "Bail"
        FINE = "fine", "Fine"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"

    class Gateway(models.TextChoices):
        STRIPE = "stripe", "Stripe"
        IDPAY = "idpay", "IDPay"
        ZARINPAL = "zarinpal", "Zarinpal"

    case = models.ForeignKey(Case, related_name="bail_payments", on_delete=models.CASCADE)
    person = models.ForeignKey(Person, related_name="bail_payments", on_delete=models.CASCADE)
    amount = models.BigIntegerField()
    payment_type = models.CharField(max_length=10, choices=Type.choices, default=Type.BAIL)
    reason = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    gateway = models.CharField(max_length=20, choices=Gateway.choices, default=Gateway.STRIPE)
    authority = models.CharField(max_length=64, blank=True, default="")
    gateway_url = models.URLField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="bail_created", on_delete=models.SET_NULL, null=True, blank=True
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=100, blank=True, default="")


class SuspectEvaluation(TimestampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUBMITTED = "submitted", "Submitted"
        RETURNED = "returned", "Returned to detective"
        REVIEWED = "reviewed", "Reviewed"

    case = models.ForeignKey(Case, related_name="suspect_evaluations", on_delete=models.CASCADE)
    suspect = models.ForeignKey(Person, related_name="suspect_evaluations", on_delete=models.CASCADE)
    detective_score = models.PositiveSmallIntegerField(null=True, blank=True)
    sergeant_score = models.PositiveSmallIntegerField(null=True, blank=True)
    sergeant_decision = models.CharField(max_length=20, blank=True, default="")  # approve/reject
    captain_decision = models.CharField(max_length=20, blank=True, default="")  # approve/reject
    captain_bail_decision = models.CharField(max_length=20, blank=True, default="")  # approve/reject for level 3 criminals
    captain_bail_note = models.TextField(blank=True, default="")
    chief_decision = models.CharField(max_length=20, blank=True, default="")
    judge_verdict = models.CharField(max_length=20, blank=True, default="")  # guilty/not_guilty
    sentence_title = models.CharField(max_length=255, blank=True, default="")
    sentence_description = models.TextField(blank=True, default="")
    judged_at = models.DateTimeField(null=True, blank=True)
    detected_at = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True, default="")

    class Meta:
        unique_together = ("case", "suspect")
        indexes = [
            models.Index(fields=["status"]),
        ]


class Trial(TimestampedModel):
    class Verdict(models.TextChoices):
        GUILTY = "guilty", "Guilty"
        NOT_GUILTY = "not_guilty", "Not guilty"

    case = models.OneToOneField(Case, related_name="trial", on_delete=models.CASCADE)
    judge = models.ForeignKey(Person, related_name="trials", on_delete=models.SET_NULL, null=True, blank=True)
    verdict = models.CharField(max_length=20, choices=Verdict.choices)
    sentence_title = models.CharField(max_length=255, blank=True, default="")
    sentence_description = models.TextField(blank=True, default="")
    decided_at = models.DateTimeField(auto_now_add=True)


class ActivityLog(TimestampedModel):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="activity_logs", on_delete=models.SET_NULL, null=True, blank=True
    )
    action = models.CharField(max_length=100)
    target_type = models.CharField(max_length=100, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    message = models.TextField(blank=True, default="")
