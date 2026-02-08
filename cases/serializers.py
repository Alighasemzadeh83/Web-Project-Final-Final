from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    ActivityLog,
    BailPayment,
    BoardLink,
    BoardNote,
    Case,
    CaseComplainantReview,
    CaseParticipant,
    Complaint,
    ComplaintComplainant,
    FieldReport,
    FieldReportWitness,
    DetectiveBoard,
    Evidence,
    EvidenceAttachment,
    Person,
    PursuitStatus,
    SuspectEvaluation,
    Tip,
    Trial,
)

User = get_user_model()


class PersonSerializer(serializers.ModelSerializer):
    user_username = serializers.SerializerMethodField()
    user_first_name = serializers.SerializerMethodField()
    user_last_name = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = (
            "id",
            "full_name",
            "national_id",
            "phone_number",
            "email",
            "photo_url",
            "user",
            "user_username",
            "user_first_name",
            "user_last_name",
        )
        read_only_fields = ("user",)

    def get_user_username(self, obj) -> str | None:
        return obj.user.username if obj.user else None

    def get_user_first_name(self, obj) -> str | None:
        return obj.user.first_name if obj.user else None

    def get_user_last_name(self, obj) -> str | None:
        return obj.user.last_name if obj.user else None


class ComplaintComplainantSerializer(serializers.ModelSerializer):
    person = PersonSerializer()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = ComplaintComplainant
        fields = (
            "id",
            "person",
            "status",
            "cadet_attempts",
            "rejection_reason",
            "officer_status",
            "officer_rejection_reason",
            "created_at",
            "updated_at",
            "is_owner",
        )
        read_only_fields = (
            "status",
            "cadet_attempts",
            "rejection_reason",
            "officer_status",
            "officer_rejection_reason",
            "created_at",
            "updated_at",
        )

    def get_is_owner(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not getattr(request, "user", None):
            return False
        return obj.person.user_id == request.user.id


class ComplaintSerializer(serializers.ModelSerializer):
    complainant = PersonSerializer(required=False, allow_null=True)
    complainants = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Complaint
        fields = (
            "id",
            "title",
            "description",
            "status",
            "created_at",
            "updated_at",
            "attempts",
            "rejection_reason",
            "complainant",
            "complainants",
            "is_owner",
        )
        read_only_fields = ("status", "created_at", "updated_at", "attempts", "rejection_reason")

    def create(self, validated_data):
        complainant_data = validated_data.pop("complainant", None)
        user = self.context["request"].user
        complainant = None
        if complainant_data:
            complainant, _ = Person.objects.get_or_create(
                national_id=complainant_data.get("national_id"), defaults=complainant_data
            )
        elif user and user.is_authenticated:
            defaults = {
                "full_name": f"{user.first_name} {user.last_name}".strip() or user.username,
                "phone_number": getattr(user, "phone_number", ""),
                "email": getattr(user, "email", ""),
                "user": user,
            }
            complainant, _ = Person.objects.get_or_create(
                national_id=getattr(user, "national_id", None),
                defaults=defaults,
            )
        complaint = Complaint.objects.create(created_by=user, complainant=complainant, **validated_data)
        if complainant:
            ComplaintComplainant.objects.get_or_create(complaint=complaint, person=complainant)
        return complaint

    def get_is_owner(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not getattr(request, "user", None):
            return False
        return obj.created_by_id == request.user.id

    def get_complainants(self, obj) -> list[dict]:
        if obj.complainant_id:
            ComplaintComplainant.objects.get_or_create(complaint=obj, person_id=obj.complainant_id)
        qs = obj.extra_complainants.all()
        return ComplaintComplainantSerializer(qs, many=True, context=self.context).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if user and not (user.is_superuser or user.groups.filter(name__iexact="Administrator").exists()) and not user.groups.exists():
            if data.get("status") == Complaint.Status.RETURNED_TO_CADET:
                data["status"] = Complaint.Status.SUBMITTED
                data["rejection_reason"] = ""
        return data


class CaseParticipantSerializer(serializers.ModelSerializer):
    person = PersonSerializer()

    class Meta:
        model = CaseParticipant
        fields = ("id", "role", "person")


class CaseComplainantReviewSerializer(serializers.ModelSerializer):
    person = PersonSerializer()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = CaseComplainantReview
        fields = (
            "id",
            "person",
            "status",
            "cadet_attempts",
            "rejection_reason",
            "officer_status",
            "officer_rejection_reason",
            "created_at",
            "updated_at",
            "is_owner",
        )
        read_only_fields = (
            "status",
            "cadet_attempts",
            "rejection_reason",
            "officer_status",
            "officer_rejection_reason",
            "created_at",
            "updated_at",
        )

    def get_is_owner(self, obj) -> bool:
        request = self.context.get("request")
        if not request or not getattr(request, "user", None):
            return False
        return obj.person.user_id == request.user.id


class CaseSerializer(serializers.ModelSerializer):
    participants = CaseParticipantSerializer(many=True, read_only=True)
    complainant_reviews = CaseComplainantReviewSerializer(many=True, read_only=True)
    criminals = serializers.SerializerMethodField()

    class CaseWitnessInputSerializer(serializers.Serializer):
        national_id = serializers.CharField()
        phone_number = serializers.CharField()

    witnesses = CaseWitnessInputSerializer(many=True, write_only=True, required=False)

    class Meta:
        model = Case
        fields = (
            "id",
            "number",
            "title",
            "description",
            "source",
            "severity",
            "status",
            "approval_stage",
            "status_note",
            "location",
            "occurred_at",
            "resolved_at",
            "bail_amount",
            "fine_amount",
            "complaint",
            "created_by",
            "supervisor",
            "participants",
            "complainant_reviews",
            "criminals",
            "witnesses",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "status",
            "created_at",
            "updated_at",
            "participants",
            "resolved_at",
            "created_by",
            "supervisor",
            "bail_amount",
            "fine_amount",
        )
        extra_kwargs = {"number": {"required": False}}

    def validate(self, attrs):
        source = attrs.get("source") or getattr(self.instance, "source", None)
        occurred_at = attrs.get("occurred_at") or getattr(self.instance, "occurred_at", None)
        if source == Case.Source.FIELD_REPORT:
            if not occurred_at:
                raise serializers.ValidationError("occurred_at is required for field report cases.")
            if self.instance is None:
                witnesses = self.initial_data.get("witnesses")
                if witnesses:
                    for witness in witnesses:
                        if not witness.get("national_id") or not witness.get("phone_number"):
                            raise serializers.ValidationError("Witness national_id and phone_number are required.")
                        national_id = witness.get("national_id")
                        phone_number = witness.get("phone_number")
                        user_by_nid = User.objects.filter(national_id=national_id).first() if national_id else None
                        user_by_phone = User.objects.filter(phone_number=phone_number).first() if phone_number else None
                        if user_by_nid and user_by_nid.phone_number != phone_number:
                            raise serializers.ValidationError(
                                "Witness phone_number does not match the registered user for this national_id."
                            )
                        if user_by_phone and user_by_phone.national_id != national_id:
                            raise serializers.ValidationError(
                                "Witness national_id does not match the registered user for this phone_number."
                            )
                        if user_by_nid and user_by_phone and user_by_nid.id != user_by_phone.id:
                            raise serializers.ValidationError(
                                "Witness national_id and phone_number must belong to the same registered user."
                            )
                        if not (user_by_nid or user_by_phone):
                            raise serializers.ValidationError(
                                "Witness must already be a registered user (match by national_id or phone_number)."
                            )
        return attrs

    def create(self, validated_data):
        validated_data.pop("witnesses", None)
        return super().create(validated_data)

    def get_criminals(self, obj) -> list[dict]:
        guilty_evaluations = (
            obj.suspect_evaluations.filter(judge_verdict="guilty")
            .select_related("suspect")
            .order_by("suspect__full_name")
        )
        return [
            {
                "id": ev.suspect_id,
                "full_name": ev.suspect.full_name,
                "national_id": ev.suspect.national_id,
            }
            for ev in guilty_evaluations
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        status = data.get("status")
        if status == Case.Status.PENDING_APPROVAL:
            stage = data.get("approval_stage") or "pending"
            data["status_label"] = f"{stage}_pending"
        elif status in [Case.Status.DETECTIVE_PENDING, Case.Status.SERGEANT_PENDING]:
            data["status_label"] = status
        else:
            data["status_label"] = status
        return data


class FieldReportWitnessSerializer(serializers.ModelSerializer):
    person = PersonSerializer()

    class Meta:
        model = FieldReportWitness
        fields = ("id", "person", "created_at")
        read_only_fields = ("created_at",)


class FieldReportSerializer(serializers.ModelSerializer):
    witnesses = FieldReportWitnessSerializer(many=True, read_only=True)

    class FieldReportWitnessInputSerializer(serializers.Serializer):
        national_id = serializers.CharField()
        phone_number = serializers.CharField()

    witness_inputs = FieldReportWitnessInputSerializer(many=True, write_only=True, required=False)

    class Meta:
        model = FieldReport
        fields = (
            "id",
            "number",
            "title",
            "description",
            "severity",
            "status",
            "approval_stage",
            "location",
            "occurred_at",
            "created_by",
            "created_at",
            "updated_at",
            "witnesses",
            "witness_inputs",
        )
        read_only_fields = ("status", "created_at", "updated_at", "created_by", "witnesses")
        extra_kwargs = {"number": {"required": False}}

    def validate(self, attrs):
        occurred_at = attrs.get("occurred_at") or getattr(self.instance, "occurred_at", None)
        if not occurred_at:
            raise serializers.ValidationError("occurred_at is required for field reports.")
            if self.instance is None:
                witnesses = self.initial_data.get("witness_inputs")
                if witnesses:
                    for witness in witnesses:
                        if not witness.get("national_id") or not witness.get("phone_number"):
                            raise serializers.ValidationError("Witness national_id and phone_number are required.")
                        national_id = witness.get("national_id")
                        phone_number = witness.get("phone_number")
                        user_by_nid = User.objects.filter(national_id=national_id).first() if national_id else None
                        user_by_phone = User.objects.filter(phone_number=phone_number).first() if phone_number else None
                        if user_by_nid and user_by_nid.phone_number != phone_number:
                            raise serializers.ValidationError(
                                "Witness phone_number does not match the registered user for this national_id."
                            )
                        if user_by_phone and user_by_phone.national_id != national_id:
                            raise serializers.ValidationError(
                                "Witness national_id does not match the registered user for this phone_number."
                            )
                        if user_by_nid and user_by_phone and user_by_nid.id != user_by_phone.id:
                            raise serializers.ValidationError(
                                "Witness national_id and phone_number must belong to the same registered user."
                            )
                        if not (user_by_nid or user_by_phone):
                            raise serializers.ValidationError(
                                "Witness must already be a registered user (match by national_id or phone_number)."
                            )
        return attrs

    def create(self, validated_data):
        validated_data.pop("witness_inputs", None)
        return super().create(validated_data)


class EvidenceAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EvidenceAttachment
        fields = ("id", "file", "description", "created_at")
        read_only_fields = ("created_at",)


class EvidenceSerializer(serializers.ModelSerializer):
    case = serializers.PrimaryKeyRelatedField(queryset=Case.objects.all(), required=False, allow_null=True)
    attachments = EvidenceAttachmentSerializer(many=True, required=False, read_only=True)
    recorded_by_national_id = serializers.CharField(source="recorded_by.national_id", read_only=True)
    recorded_by_roles = serializers.SerializerMethodField()

    class Meta:
        model = Evidence
        fields = (
            "id",
            "case",
            "type",
            "title",
            "description",
            "extra_data",
            "status",
            "status_note",
            "attachments",
            "recorded_at",
            "created_at",
            "updated_at",
            "recorded_by_national_id",
            "recorded_by_roles",
        )
        read_only_fields = ("status", "status_note", "created_at", "updated_at", "attachments")

    def validate(self, attrs):
        title = attrs.get("title") or getattr(self.instance, "title", "")
        description = attrs.get("description") or getattr(self.instance, "description", "")
        if not title or not str(title).strip():
            raise serializers.ValidationError("Evidence title is required.")
        if not description or not str(description).strip():
            raise serializers.ValidationError("Evidence description is required.")
        if self.instance is None and "recorded_at" not in self.initial_data:
            raise serializers.ValidationError("Evidence recorded_at is required.")
        evidence_type = attrs.get("type") or getattr(self.instance, "type", Evidence.Type.GENERIC)
        extra_data = attrs.get("extra_data") or getattr(self.instance, "extra_data", {}) or {}
        if evidence_type == Evidence.Type.TESTIMONY:
            transcript = extra_data.get("transcript")
            if not transcript or not str(transcript).strip():
                raise serializers.ValidationError("Testimony evidence requires a transcript in extra_data.")
        if evidence_type == Evidence.Type.FORENSIC:
            # Forensic evidence needs attachments; enforce at review time.
            pass
        if evidence_type == Evidence.Type.VEHICLE:
            plate_number = extra_data.get("plate_number")
            serial_number = extra_data.get("serial_number")
            model = extra_data.get("model")
            color = extra_data.get("color")
            if not model or not str(model).strip():
                raise serializers.ValidationError("Vehicle evidence requires model in extra_data.")
            if not color or not str(color).strip():
                raise serializers.ValidationError("Vehicle evidence requires color in extra_data.")
            if bool(plate_number) == bool(serial_number):
                raise serializers.ValidationError(
                    "Vehicle evidence requires exactly one of plate_number or serial_number."
                )
        if evidence_type == Evidence.Type.ID_DOCUMENT:
            owner_name = extra_data.get("owner_name")
            if not owner_name or not str(owner_name).strip():
                raise serializers.ValidationError("ID document evidence requires owner_name in extra_data.")
        return attrs

    def create(self, validated_data):
        return Evidence.objects.create(**validated_data)

    def get_recorded_by_roles(self, obj) -> list[str]:
        user = getattr(obj, "recorded_by", None)
        if not user:
            return []
        if getattr(user, "is_superuser", False):
            return ["Superuser"]
        return list(user.groups.values_list("name", flat=True))


class DetectiveBoardSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetectiveBoard
        fields = ("id", "case", "owner", "background_color", "created_at", "updated_at")
        read_only_fields = ("owner", "created_at", "updated_at")

    def create(self, validated_data):
        validated_data["owner"] = self.context["request"].user
        return super().create(validated_data)


class BoardNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardNote
        fields = ("id", "board", "label", "x", "y", "color", "evidence", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def validate(self, attrs):
        board = attrs.get("board") or getattr(self.instance, "board", None)
        evidence = attrs.get("evidence") or getattr(self.instance, "evidence", None)
        if board and evidence and evidence.case_id != board.case_id:
            raise serializers.ValidationError("Evidence must belong to the same case as the board.")
        return attrs


class BoardLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardLink
        fields = ("id", "board", "source", "target", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class PursuitStatusSerializer(serializers.ModelSerializer):
    suspect = PersonSerializer()
    days_under_pursuit = serializers.IntegerField(read_only=True)
    rank_score = serializers.IntegerField(read_only=True)

    class Meta:
        model = PursuitStatus
        fields = (
            "id",
            "case",
            "suspect",
            "status",
            "pursuit_started_at",
            "severity_at_report",
            "days_under_pursuit",
            "rank_score",
        )

    def create(self, validated_data):
        suspect_data = validated_data.pop("suspect")
        suspect, _ = Person.objects.get_or_create(
            national_id=suspect_data.get("national_id"), defaults=suspect_data
        )
        validated_data["suspect"] = suspect
        return super().create(validated_data)


class TipSerializer(serializers.ModelSerializer):
    submitted_by_details = serializers.SerializerMethodField()
    case_number = serializers.SerializerMethodField()
    case_title = serializers.SerializerMethodField()
    class Meta:
        model = Tip
        fields = (
            "id",
            "case",
            "case_number",
            "case_title",
            "submitted_by",
            "submitted_by_details",
            "contact_name",
            "contact_phone",
            "suspect_national_id",
            "description",
            "status",
            "reward_code",
            "reward_amount",
            "created_at",
        )
        read_only_fields = ("status", "reward_code", "reward_amount", "submitted_by", "created_at")

    def create(self, validated_data):
        validated_data["submitted_by"] = self.context["request"].user if self.context["request"].user.is_authenticated else None
        return super().create(validated_data)

    def get_submitted_by_details(self, obj) -> dict | None:
        user = obj.submitted_by
        if not user:
            return None
        return {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "national_id": user.national_id,
            "phone_number": user.phone_number,
            "email": user.email,
        }

    def get_case_number(self, obj) -> str:
        return obj.case.number if obj.case else ""

    def get_case_title(self, obj) -> str:
        return obj.case.title if obj.case else ""


class BailPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BailPayment
        fields = (
            "id",
            "case",
            "person",
            "amount",
            "payment_type",
            "reason",
            "status",
            "gateway",
            "authority",
            "gateway_url",
            "reference",
            "paid_at",
            "created_at",
        )
        read_only_fields = ("status", "paid_at", "created_at", "gateway", "authority", "gateway_url")

    def create(self, validated_data):
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)

    def validate(self, attrs):
        case = attrs.get("case") or getattr(self.instance, "case", None)
        person = attrs.get("person") or getattr(self.instance, "person", None)
        payment_type = attrs.get("payment_type", getattr(self.instance, "payment_type", BailPayment.Type.BAIL))
        suspect_evaluation = None
        if not case:
            raise serializers.ValidationError("case is required.")
        if payment_type == BailPayment.Type.BAIL and case.severity not in [
            Case.Severity.LEVEL_2,
            Case.Severity.LEVEL_3,
        ]:
            raise serializers.ValidationError("Bail allowed only for severity level 2 or 3 cases.")
        if payment_type == BailPayment.Type.BAIL:
            if not person:
                raise serializers.ValidationError("Suspect person is required for bail payments.")
            suspect_evaluation = SuspectEvaluation.objects.filter(case=case, suspect=person).first()
            if not suspect_evaluation or suspect_evaluation.sergeant_decision != "approve":
                raise serializers.ValidationError("Bail requires sergeant approval for this suspect.")
            if suspect_evaluation.judge_verdict == "guilty":
                raise serializers.ValidationError("Bail is only for suspects. Criminals cannot pay bail.")
            if suspect_evaluation.judge_verdict == "not_guilty":
                raise serializers.ValidationError("This person is not a suspect anymore.")
            if case.bail_amount is None:
                raise serializers.ValidationError("Bail amount is not set for this case.")
        if payment_type == BailPayment.Type.FINE:
            if case.severity != Case.Severity.LEVEL_3:
                raise serializers.ValidationError("Fine payments are limited to severity level 3 cases.")
            if not person:
                raise serializers.ValidationError("Criminal person is required for fine payments.")
            if case.status != Case.Status.CLOSED:
                raise serializers.ValidationError("Fine payments are allowed only after court verdict.")
            approved = SuspectEvaluation.objects.filter(
                case=case,
                suspect=person,
                sergeant_decision="approve",
            ).exists()
            if not approved:
                raise serializers.ValidationError("Fine payments require sergeant approval for this criminal.")
            guilty_eval = SuspectEvaluation.objects.filter(
                case=case,
                suspect=person,
                judge_verdict="guilty",
            ).first()
            if not guilty_eval:
                raise serializers.ValidationError("Fine payments require a guilty verdict for this criminal.")
            if guilty_eval.captain_bail_decision != "approve":
                raise serializers.ValidationError(
                    "Sergeant must approve bail-payment decision before fine payment for this level 3 criminal."
                )
            if case.fine_amount is None:
                raise serializers.ValidationError("Fine amount is not set for this case.")
        return attrs


class SuspectEvaluationSerializer(serializers.ModelSerializer):
    suspect = PersonSerializer()

    class Meta:
        model = SuspectEvaluation
        fields = (
            "id",
            "case",
            "suspect",
            "detected_at",
            "detective_score",
            "sergeant_score",
            "sergeant_decision",
            "captain_decision",
            "captain_bail_decision",
            "captain_bail_note",
            "chief_decision",
            "judge_verdict",
            "sentence_title",
            "sentence_description",
            "judged_at",
            "status",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "status",
            "created_at",
            "updated_at",
            "sergeant_decision",
            "captain_decision",
            "captain_bail_decision",
            "captain_bail_note",
            "chief_decision",
            "judge_verdict",
            "sentence_title",
            "sentence_description",
            "judged_at",
        )

    def create(self, validated_data):
        suspect_data = validated_data.pop("suspect")
        suspect, _ = Person.objects.get_or_create(
            national_id=suspect_data.get("national_id"), defaults=suspect_data
        )
        validated_data["suspect"] = suspect
        return super().create(validated_data)


class TrialSerializer(serializers.ModelSerializer):
    judge = PersonSerializer()

    class Meta:
        model = Trial
        fields = (
            "id",
            "case",
            "judge",
            "verdict",
            "sentence_title",
            "sentence_description",
            "decided_at",
        )
        read_only_fields = ("decided_at",)

    def create(self, validated_data):
        judge_data = validated_data.pop("judge")
        judge, _ = Person.objects.get_or_create(
            national_id=judge_data.get("national_id"), defaults=judge_data
        )
        validated_data["judge"] = judge
        return super().create(validated_data)


class ActivityLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()
    actor_roles = serializers.SerializerMethodField()

    class Meta:
        model = ActivityLog
        fields = (
            "id",
            "actor",
            "action",
            "target_type",
            "target_id",
            "message",
            "created_at",
            "actor_username",
            "actor_roles",
        )
        read_only_fields = ("created_at",)

    def get_actor_username(self, obj) -> str | None:
        return obj.actor.username if obj.actor else None

    def get_actor_roles(self, obj) -> list[str]:
        user = obj.actor
        if not user:
            return []
        if getattr(user, "is_superuser", False):
            return ["Superuser"]
        return list(user.groups.values_list("name", flat=True))


class MetricsSummarySerializer(serializers.Serializer):
    total_cases = serializers.IntegerField()
    solved_cases = serializers.IntegerField()
    active_cases = serializers.IntegerField()
    total_personnel = serializers.IntegerField()
    cases_by_severity = serializers.DictField(child=serializers.IntegerField())
    cases_by_status = serializers.DictField(child=serializers.IntegerField())
    complaints_by_status = serializers.DictField(child=serializers.IntegerField())
    tips_by_status = serializers.DictField(child=serializers.IntegerField())
    evidence_by_status = serializers.DictField(child=serializers.IntegerField())
    pursuits_by_status = serializers.DictField(child=serializers.IntegerField())
