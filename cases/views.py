import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import reverse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from urllib.parse import urlencode, urlsplit
from rest_framework import permissions, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.decorators import action
import json
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import (
    BailPayment,
    ActivityLog,
    BoardLink,
    BoardNote,
    Case,
    CaseComplainantReview,
    CaseParticipant,
    Complaint,
    ComplaintComplainant,
    FieldReport,
    FieldReportWitness,
    SuspectEvaluation,
    DetectiveBoard,
    Evidence,
    EvidenceAttachment,
    Person,
    PursuitStatus,
    Tip,
    Trial,
)
from .permissions import (
    IsCadet,
    IsCaptainOrChief,
    IsCoroner,
    IsDetective,
    IsOfficer,
    IsPoliceOrCoroner,
    IsPoliceRole,
    IsJudge,
    IsSergeant,
    IsSergeantOrAbove,
    IsReportViewer,
    user_has_any_role,
    user_role_names,
)
from .serializers import (
    ActivityLogSerializer,
    BailPaymentSerializer,
    BoardLinkSerializer,
    BoardNoteSerializer,
    CaseComplainantReviewSerializer,
    CaseSerializer,
    CaseParticipantSerializer,
    ComplaintSerializer,
    ComplaintComplainantSerializer,
    FieldReportSerializer,
    DetectiveBoardSerializer,
    EvidenceAttachmentSerializer,
    EvidenceSerializer,
    MetricsSummarySerializer,
    PersonSerializer,
    PursuitStatusSerializer,
    SuspectEvaluationSerializer,
    TipSerializer,
    TrialSerializer,
)
from .utils import generate_case_number
from .payment_gateway import PaymentGatewayError, request_payment, verify_payment


def log_activity(user, action: str, target_type: str = "", target_id: str = "", message: str = ""):
    ActivityLog.objects.create(
        actor=user,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        message=message,
    )


def _payment_order_id(payment: BailPayment) -> str:
    return f"BP-{payment.id}"


def _current_gateway() -> str:
    if settings.PAYMENT_GATEWAY == "stripe":
        return BailPayment.Gateway.STRIPE
    if settings.PAYMENT_GATEWAY == "idpay":
        return BailPayment.Gateway.IDPAY
    return BailPayment.Gateway.ZARINPAL


def _append_query(url: str, params: dict[str, str]) -> str:
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode(params)}"


def _safe_return_to(url: str | None) -> str:
    if not url:
        return ""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return ""
    if parsed.scheme in ("http", "https"):
        return url
    if parsed.scheme == "" and url.startswith("/"):
        return url
    return ""


def payment_return_view(request):
    status_value = request.GET.get("Status") or request.GET.get("status", "unknown")
    authority = (
        request.GET.get("id")
        or request.GET.get("session_id")
        or request.GET.get("Authority")
        or request.GET.get("authority", "")
    )
    order_id = request.GET.get("order_id", "")
    track_id = request.GET.get("track_id", "")
    payment_id = request.GET.get("payment_id")
    reference = request.GET.get("reference", "")
    amount = request.GET.get("amount", "")
    return_to = _safe_return_to(request.GET.get("return_to"))
    if not return_to:
        base = settings.FRONTEND_BASE_URL.rstrip("/")
        return_to = f"{base}/payments"
    display_status = status_value

    payment = None
    if payment_id:
        payment = BailPayment.objects.filter(id=payment_id).first()
    if not payment and authority:
        payment = BailPayment.objects.filter(authority=authority).first()

    if payment:
        amount = str(payment.amount)
        auth_value = authority or payment.authority
        expected_order_id = _payment_order_id(payment)
        ok_status = str(status_value).lower() in {"ok", "success", "mock", "10", "100", "101", "200"}
        is_stripe = payment.gateway == BailPayment.Gateway.STRIPE
        if not is_stripe and order_id and order_id != expected_order_id:
            ok_status = False
            display_status = "failed"
        if ok_status and auth_value:
            try:
                result = verify_payment(authority=auth_value, amount=payment.amount, order_id=expected_order_id)
                if result.ok:
                    payment.status = BailPayment.Status.PAID
                    payment.reference = result.ref_id or track_id or payment.reference or auth_value
                    payment.paid_at = timezone.now()
                    display_status = "success"
                else:
                    payment.status = BailPayment.Status.FAILED
                    display_status = "failed"
            except PaymentGatewayError:
                payment.status = BailPayment.Status.FAILED
                display_status = "failed"
        else:
            payment.status = BailPayment.Status.FAILED
            display_status = "failed"
        payment.save(update_fields=["status", "reference", "paid_at", "updated_at"])
        reference = payment.reference or reference or track_id or auth_value

    return TemplateResponse(
        request,
        "payments/return.html",
        {"status": display_status, "reference": reference, "amount": amount, "return_to": return_to},
    )


def mock_payment_view(request):
    action = request.GET.get("action", "")
    callback_url = request.GET.get("callback") or request.build_absolute_uri(reverse("payment-return"))
    payment_id = request.GET.get("payment_id")
    authority = request.GET.get("authority", "")
    order_id = request.GET.get("order_id", "")
    amount = request.GET.get("amount", "")

    payment = None
    if payment_id:
        payment = BailPayment.objects.filter(id=payment_id).first()
    if not payment and authority:
        payment = BailPayment.objects.filter(authority=authority).first()

    if payment:
        authority = authority or payment.authority
        order_id = order_id or _payment_order_id(payment)
        amount = amount or str(payment.amount)
        if "payment_id=" not in callback_url:
            callback_url = _append_query(callback_url, {"payment_id": str(payment.id)})

    if action in {"pay", "cancel"}:
        status_value = "mock" if action == "pay" else "2"
        params = {
            "status": status_value,
            "id": authority,
            "order_id": order_id,
            "track_id": uuid.uuid4().hex,
            "mock": "1",
        }
        if payment_id:
            params["payment_id"] = payment_id
        return redirect(_append_query(callback_url, {k: v for k, v in params.items() if v}))

    return TemplateResponse(
        request,
        "payments/mock.html",
        {
            "authority": authority,
            "order_id": order_id,
            "amount": amount,
            "callback": callback_url,
            "payment_id": payment_id or "",
        },
    )


def generate_field_report_number():
    return f"FR-{uuid.uuid4().hex[:8].upper()}"


class ComplaintViewSet(viewsets.ModelViewSet):
    queryset = Complaint.objects.select_related("complainant", "created_by").order_by("-created_at")
    serializer_class = ComplaintSerializer
    filterset_fields = ["status"]
    search_fields = ["title", "description"]

    def get_permissions(self):
        if self.action in ["cadet_review", "review_complainant"]:
            return [IsCadet()]
        if self.action in ["officer_review"]:
            return [IsOfficer()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        if user_has_any_role(user, ["Administrator"]):
            return self.queryset
        owner_q = self.queryset.filter(Q(created_by=user) | Q(extra_complainants__person__user=user)).distinct()
        if user_has_any_role(user, ["Cadet"]):
            cadet_q = self.queryset.filter(
                extra_complainants__status__in=[
                    ComplaintComplainant.Status.PENDING,
                    ComplaintComplainant.Status.REJECTED,
                ]
            ).distinct()
            return cadet_q | owner_q
        if user_has_any_role(user, ["Officer", "Patrol Officer", "Police Officer"]):
            officer_q = self.queryset.filter(
                extra_complainants__status=ComplaintComplainant.Status.APPROVED
            ).distinct()
            return officer_q | owner_q
        if user_has_any_role(user, ["Detective", "Sergeant", "Captain", "Chief"]):
            return owner_q
        if user.groups.exists():
            return owner_q
        return owner_q

    def perform_create(self, serializer):
        serializer.save()

    def _ensure_primary_complainant(self, complaint):
        if complaint.complainant_id:
            extra, _ = ComplaintComplainant.objects.get_or_create(
                complaint=complaint, person=complaint.complainant
            )
            return extra
        return None

    def _complainant_records(self, complaint):
        self._ensure_primary_complainant(complaint)
        return complaint.extra_complainants.select_related("person")

    def _refresh_complaint_status_after_cadet(self, complaint):
        records = list(self._complainant_records(complaint))
        if not records:
            complaint.status = Complaint.Status.VOIDED
            complaint.rejection_reason = ""
            complaint.save(update_fields=["status", "rejection_reason", "updated_at"])
            return
        if all(r.status == ComplaintComplainant.Status.REMOVED for r in records):
            complaint.status = Complaint.Status.VOIDED
            complaint.rejection_reason = ""
        else:
            if complaint.status != Complaint.Status.ACCEPTED:
                complaint.status = Complaint.Status.SUBMITTED
            complaint.rejection_reason = ""
        complaint.save(update_fields=["status", "rejection_reason", "updated_at"])

    def _refresh_complaint_status_after_officer(self, complaint):
        records = list(self._complainant_records(complaint))
        if not records:
            complaint.status = Complaint.Status.VOIDED
            complaint.rejection_reason = ""
            complaint.save(update_fields=["status", "rejection_reason", "updated_at"])
            return
        if all(r.status == ComplaintComplainant.Status.REMOVED for r in records):
            complaint.status = Complaint.Status.VOIDED
            complaint.rejection_reason = ""
            complaint.save(update_fields=["status", "rejection_reason", "updated_at"])
            return
        if complaint.status != Complaint.Status.ACCEPTED:
            complaint.status = Complaint.Status.SUBMITTED
            complaint.rejection_reason = ""
            complaint.save(update_fields=["status", "rejection_reason", "updated_at"])

    def _maybe_create_case_from_complaint(self, complaint, severity, officer_user):
        records = list(self._complainant_records(complaint))
        resolved = all(
            r.status == ComplaintComplainant.Status.REMOVED
            or (
                r.status == ComplaintComplainant.Status.APPROVED
                and r.officer_status == ComplaintComplainant.OfficerStatus.APPROVED
            )
            for r in records
        )
        if not resolved:
            return None
        approved = [
            r for r in records
            if r.status == ComplaintComplainant.Status.APPROVED
            and r.officer_status == ComplaintComplainant.OfficerStatus.APPROVED
        ]
        if not approved:
            return None
        if hasattr(complaint, "case"):
            case = complaint.case
        else:
            case = Case.objects.create(
                number=generate_case_number(),
                title=complaint.title,
                description=complaint.description,
                source=Case.Source.COMPLAINT,
                complaint=complaint,
                severity=severity,
                status=Case.Status.DETECTIVE_PENDING,
                approval_stage=Case.ApprovalStage.DETECTIVE,
                created_by=officer_user,
            )
            log_activity(officer_user, "create_case_from_complaint", "case", case.id)
        for extra in approved:
            CaseParticipant.objects.get_or_create(
                case=case, person=extra.person, role=CaseParticipant.Role.COMPLAINANT
            )
        complaint.status = Complaint.Status.ACCEPTED
        complaint.rejection_reason = ""
        complaint.reviewed_by_officer = officer_user
        complaint.save(update_fields=["status", "rejection_reason", "reviewed_by_officer", "updated_at"])
        return case

    @action(detail=True, methods=["post"], url_path="cadet-review")
    def cadet_review(self, request, pk=None):
        complaint = self.get_object()
        approve = request.data.get("approve", False)
        note = request.data.get("note", "")
        complainant_id = request.data.get("complainant_id")
        if complainant_id:
            extra = get_object_or_404(ComplaintComplainant, complaint=complaint, id=complainant_id)
        else:
            extra = self._ensure_primary_complainant(complaint)
            if not extra:
                return Response({"error": "Primary complainant not found."}, status=status.HTTP_400_BAD_REQUEST)
        if extra.status not in [ComplaintComplainant.Status.PENDING, ComplaintComplainant.Status.REJECTED]:
            return Response({"error": "Complainant not in cadet-reviewable state."}, status=status.HTTP_400_BAD_REQUEST)
        if (
            extra.status == ComplaintComplainant.Status.REJECTED
            and extra.officer_status != ComplaintComplainant.OfficerStatus.REJECTED
        ):
            return Response(
                {"error": "Complainant must update details before another cadet review."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        extra.reviewed_by_cadet = request.user
        if approve:
            extra.status = ComplaintComplainant.Status.APPROVED
            extra.rejection_reason = ""
            if extra.officer_status == ComplaintComplainant.OfficerStatus.REJECTED:
                extra.officer_status = ComplaintComplainant.OfficerStatus.PENDING
                extra.officer_rejection_reason = ""
        else:
            if not note:
                return Response({"error": "Rejection reason is required."}, status=status.HTTP_400_BAD_REQUEST)
            extra.cadet_attempts += 1
            if extra.cadet_attempts >= 3:
                extra.status = ComplaintComplainant.Status.REMOVED
                extra.rejection_reason = "Removed after 3 cadet rejections."
            else:
                extra.status = ComplaintComplainant.Status.REJECTED
                extra.rejection_reason = note
            if extra.officer_status == ComplaintComplainant.OfficerStatus.REJECTED:
                extra.officer_status = ComplaintComplainant.OfficerStatus.PENDING
                extra.officer_rejection_reason = ""
        extra.save()
        self._refresh_complaint_status_after_cadet(complaint)
        log_activity(request.user, "cadet_review", "complaint", complaint.id, message=note)
        return Response(ComplaintSerializer(complaint, context={"request": request}).data)

    def perform_update(self, serializer):
        complaint = serializer.instance
        serializer.save()
        complainant_id = self.request.data.get("complainant_id")
        qs = ComplaintComplainant.objects.filter(
            complaint=complaint,
            status=ComplaintComplainant.Status.REJECTED,
        )
        if complainant_id:
            qs = qs.filter(id=complainant_id)
        else:
            qs = qs.filter(person__user=self.request.user)
        qs.update(
            status=ComplaintComplainant.Status.PENDING,
            rejection_reason="",
            reviewed_by_cadet=None,
            officer_status=ComplaintComplainant.OfficerStatus.PENDING,
            officer_rejection_reason="",
            reviewed_by_officer=None,
        )
        self._refresh_complaint_status_after_cadet(complaint)

    def update(self, request, *args, **kwargs):
        complaint = self.get_object()
        can_edit = ComplaintComplainant.objects.filter(
            complaint=complaint,
            person__user=request.user,
            status=ComplaintComplainant.Status.REJECTED,
        ).exists()
        if not can_edit:
            return Response({"error": "Only returned complainants can edit this complaint."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        complaint = self.get_object()
        can_edit = ComplaintComplainant.objects.filter(
            complaint=complaint,
            person__user=request.user,
            status=ComplaintComplainant.Status.REJECTED,
        ).exists()
        if not can_edit:
            return Response({"error": "Only returned complainants can edit this complaint."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="complainants")
    def add_complainant(self, request, pk=None):
        complaint = self.get_object()
        if not user_has_any_role(request.user, ["Cadet"]):
            return Response({"error": "Only cadets can add complainants."}, status=status.HTTP_403_FORBIDDEN)
        person_data = request.data.get("person") or {}
        identifier = (
            request.data.get("identifier")
            or person_data.get("identifier")
            or person_data.get("username")
            or person_data.get("email")
            or person_data.get("national_id")
            or person_data.get("phone_number")
        )
        if not identifier:
            return Response(
                {"error": "Provide an identifier (username, email, national ID, or phone number)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user_match = (
            get_user_model()
            .objects.filter(
                Q(username__iexact=identifier)
                | Q(email__iexact=identifier)
                | Q(phone_number__iexact=identifier)
                | Q(national_id__iexact=identifier)
            )
            .first()
        )
        if not user_match:
            return Response(
                {
                    "error": (
                        "No matching user found. The extra complainant must already be registered "
                        "with a username, email, national ID, or phone number that matches this request."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        full_name = f"{user_match.first_name} {user_match.last_name}".strip() or user_match.username
        defaults = {
            "full_name": full_name,
            "national_id": user_match.national_id,
            "phone_number": user_match.phone_number,
            "email": user_match.email,
            "user": user_match,
        }
        person, _ = Person.objects.get_or_create(national_id=user_match.national_id, defaults=defaults)
        if not person.user_id:
            person.user = user_match
            person.save(update_fields=["user"])
        extra = ComplaintComplainant.objects.filter(complaint=complaint, person=person).first()
        if extra:
            if extra.status == ComplaintComplainant.Status.REMOVED:
                extra.status = ComplaintComplainant.Status.PENDING
                extra.cadet_attempts = 0
                extra.officer_status = ComplaintComplainant.OfficerStatus.PENDING
                extra.rejection_reason = ""
                extra.officer_rejection_reason = ""
                extra.reviewed_by_cadet = None
                extra.reviewed_by_officer = None
                extra.save()
            else:
                return Response(
                    {"error": "This complainant is already in the complaint workflow."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            extra = ComplaintComplainant.objects.create(complaint=complaint, person=person)
        return Response(ComplaintComplainantSerializer(extra, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complainants/(?P<complainant_id>[^/.]+)/review")
    def review_complainant(self, request, pk=None, complainant_id=None):
        complaint = self.get_object()
        extra = get_object_or_404(ComplaintComplainant, complaint=complaint, id=complainant_id)
        decision = request.data.get("decision")
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if (
            extra.status == ComplaintComplainant.Status.REJECTED
            and extra.officer_status != ComplaintComplainant.OfficerStatus.REJECTED
        ):
            return Response(
                {"error": "Complainant must update details before another cadet review."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        extra.reviewed_by_cadet = request.user
        if decision == "approve":
            extra.status = ComplaintComplainant.Status.APPROVED
            extra.rejection_reason = ""
            if extra.officer_status == ComplaintComplainant.OfficerStatus.REJECTED:
                extra.officer_status = ComplaintComplainant.OfficerStatus.PENDING
                extra.officer_rejection_reason = ""
        else:
            if not note:
                return Response({"error": "Rejection reason is required."}, status=status.HTTP_400_BAD_REQUEST)
            extra.cadet_attempts += 1
            if extra.cadet_attempts >= 3:
                extra.status = ComplaintComplainant.Status.REMOVED
                extra.rejection_reason = "Removed after 3 cadet rejections."
            else:
                extra.status = ComplaintComplainant.Status.REJECTED
                extra.rejection_reason = note
            if extra.officer_status == ComplaintComplainant.OfficerStatus.REJECTED:
                extra.officer_status = ComplaintComplainant.OfficerStatus.PENDING
                extra.officer_rejection_reason = ""
        extra.save()
        self._refresh_complaint_status_after_cadet(complaint)
        log_activity(request.user, "review_extra_complainant", "complaint", complaint.id, message=decision)
        return Response(ComplaintSerializer(complaint, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="officer-review")
    def officer_review(self, request, pk=None):
        complaint = self.get_object()
        accept = request.data.get("accept", False)
        note = request.data.get("note", "")
        severity = request.data.get("severity", Case.Severity.LEVEL_3)
        complainant_id = request.data.get("complainant_id")
        if complainant_id:
            extra = get_object_or_404(ComplaintComplainant, complaint=complaint, id=complainant_id)
        else:
            extra = self._ensure_primary_complainant(complaint)
            if not extra:
                return Response({"error": "Primary complainant not found."}, status=status.HTTP_400_BAD_REQUEST)
        if extra.status != ComplaintComplainant.Status.APPROVED:
            return Response({"error": "Complainant must be cadet-approved before officer review."}, status=status.HTTP_400_BAD_REQUEST)
        if accept:
            extra.officer_status = ComplaintComplainant.OfficerStatus.APPROVED
            extra.officer_rejection_reason = ""
            extra.reviewed_by_officer = request.user
        else:
            if not note:
                return Response({"error": "Rejection reason is required."}, status=status.HTTP_400_BAD_REQUEST)
            extra.officer_status = ComplaintComplainant.OfficerStatus.REJECTED
            extra.officer_rejection_reason = note
            extra.status = ComplaintComplainant.Status.REJECTED
            extra.rejection_reason = note or "Requires further review"
        extra.save()

        case = None
        if accept:
            records = list(self._complainant_records(complaint))
            resolved = all(
                r.status == ComplaintComplainant.Status.REMOVED
                or (r.status == ComplaintComplainant.Status.APPROVED and r.officer_status == ComplaintComplainant.OfficerStatus.APPROVED)
                for r in records
            )
            if resolved:
                case = self._maybe_create_case_from_complaint(complaint, severity, request.user)
        if case:
            return Response(
                {
                    "complaint": ComplaintSerializer(complaint, context={"request": request}).data,
                    "case": CaseSerializer(case, context={"request": request}).data,
                },
                status=status.HTTP_201_CREATED,
            )
        self._refresh_complaint_status_after_officer(complaint)
        log_activity(request.user, "officer_review", "complaint", complaint.id, message="approve" if accept else "reject")
        return Response(ComplaintSerializer(complaint, context={"request": request}).data)


class CaseViewSet(viewsets.ModelViewSet):
    queryset = (
        Case.objects.select_related("complaint")
        .prefetch_related("participants__person", "complainant_reviews__person", "suspect_evaluations__suspect")
        .order_by("-created_at")
    )
    serializer_class = CaseSerializer
    filterset_fields = ["status", "severity", "source"]
    search_fields = ["title", "description", "number"]

    def get_permissions(self):
        if self.action == "create":
            return [IsPoliceRole()]
        if self.action == "approve":
            return [IsPoliceRole()]
        if self.action == "reject":
            return [IsPoliceRole()]
        if self.action == "detective_capture":
            return [IsDetective()]
        if self.action in ["close"]:
            return [IsSergeantOrAbove()]
        if self.action == "add_participant":
            return [IsPoliceRole()]
        if self.action == "add_case_complainant":
            return [IsPoliceRole()]
        if self.action == "cadet_review_case_complainant":
            return [IsCadet()]
        if self.action == "officer_review_case_complainant":
            return [IsOfficer()]
        if self.action in ["send_to_trial"]:
            return [IsCaptainOrChief()]
        if self.action in ["set_bail", "clear_bail", "set_fine", "clear_fine"]:
            return [IsSergeant()]
        if self.action in ["report"]:
            return [IsReportViewer()]
        return [permissions.IsAuthenticated()]

    def _rank_for(self, user):
        rank_map = {
            "cadet": 0,
            "officer": 1,
            "patrol officer": 1,
            "police officer": 1,
            "detective": 2,
            "sergeant": 3,
            "captain": 4,
            "chief": 5,
        }
        roles = [name.lower().strip() for name in user_role_names(user)]
        ranks = [rank_map.get(role) for role in roles]
        ranks = [r for r in ranks if r is not None]
        return max(ranks) if ranks else -1

    def _stage_for_rank(self, rank: int):
        if rank == 2:
            return Case.ApprovalStage.DETECTIVE
        if rank == 3:
            return Case.ApprovalStage.SERGEANT
        if rank == 4:
            return Case.ApprovalStage.CAPTAIN
        if rank == 5:
            return Case.ApprovalStage.CHIEF
        return None

    def _person_from_identifier(self, identifier: str):
        user_match = (
            get_user_model()
            .objects.filter(
                Q(username__iexact=identifier)
                | Q(email__iexact=identifier)
                | Q(phone_number__iexact=identifier)
                | Q(national_id__iexact=identifier)
            )
            .first()
        )
        if not user_match:
            return None
        full_name = f"{user_match.first_name} {user_match.last_name}".strip() or user_match.username
        defaults = {
            "full_name": full_name,
            "national_id": user_match.national_id,
            "phone_number": user_match.phone_number,
            "email": user_match.email,
            "user": user_match,
        }
        if user_match.national_id:
            person, _ = Person.objects.get_or_create(national_id=user_match.national_id, defaults=defaults)
        else:
            person = Person.objects.filter(user=user_match).first()
            if not person:
                person = Person.objects.create(**defaults)
        if not person.user_id:
            person.user = user_match
            person.save(update_fields=["user"])
        return person

    def get_queryset(self):
        user = self.request.user
        base_qs = self.queryset.exclude(status=Case.Status.REJECTED)
        own_filter = (
            Q(complainant_reviews__person__user=user)
            | Q(participants__person__user=user, participants__role=CaseParticipant.Role.COMPLAINANT)
            | Q(created_by=user)
        )
        own_qs = base_qs.filter(own_filter).distinct()
        if user_has_any_role(user, ["Administrator"]):
            return self.queryset
        if not user.groups.exists():
            return own_qs
        if user_has_any_role(user, ["Judge"]):
            return self.queryset.filter(status=Case.Status.IN_TRIAL)
        allowed_roles = [
            "Cadet",
            "Officer",
            "Patrol Officer",
            "Police Officer",
            "Detective",
            "Sergeant",
            "Captain",
            "Chief",
            "Judge",
            "Coroner",
            "Administrator",
        ]
        if not user_has_any_role(user, allowed_roles):
            return own_qs
        qs = base_qs
        if self.request.query_params.get("source") != Case.Source.FIELD_REPORT:
            qs = qs.exclude(source=Case.Source.FIELD_REPORT, supervisor__isnull=True)
        return base_qs.filter(Q(id__in=qs.values_list("id", flat=True)) | own_filter).distinct()

    def perform_create(self, serializer):
        data = serializer.validated_data
        number = data.get("number") or generate_case_number()
        status_value = Case.Status.DETECTIVE_PENDING
        approval_stage = Case.ApprovalStage.DETECTIVE
        supervisor = None
        if data.get("source") == Case.Source.FIELD_REPORT:
            creator_rank = self._rank_for(self.request.user)
            next_rank = creator_rank + 1
            next_stage = self._stage_for_rank(next_rank)
            if next_stage is None:
                approval_stage = Case.ApprovalStage.DETECTIVE
                supervisor = self.request.user
            else:
                approval_stage = next_stage
        case = serializer.save(
            number=number,
            created_by=self.request.user,
            status=status_value,
            approval_stage=approval_stage,
            supervisor=supervisor,
        )
        witnesses = self.request.data.get("witnesses") or []
        for witness in witnesses:
            national_id = witness.get("national_id")
            phone_number = witness.get("phone_number")
            user_match = None
            if national_id:
                user_match = get_user_model().objects.filter(national_id=national_id).first()
            if not user_match and phone_number:
                user_match = get_user_model().objects.filter(phone_number=phone_number).first()
            if not user_match:
                raise ValidationError("Witness must already be a registered user (match by national_id or phone_number).")
            full_name = f"{user_match.first_name} {user_match.last_name}".strip() or user_match.username
            defaults = {
                "full_name": full_name,
                "national_id": user_match.national_id,
                "phone_number": user_match.phone_number,
                "email": user_match.email,
                "user": user_match,
            }
            person, _ = Person.objects.get_or_create(national_id=user_match.national_id, defaults=defaults)
            if not person.user_id:
                person.user = user_match
                person.save(update_fields=["user"])
            CaseParticipant.objects.get_or_create(case=case, person=person, role=CaseParticipant.Role.WITNESS)

    def create(self, request, *args, **kwargs):
        if request.data.get("source") == Case.Source.FIELD_REPORT:
            return Response({"error": "Use the field-reports endpoint for field reports."}, status=status.HTTP_400_BAD_REQUEST)
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        case = self.get_object()
        if case.status not in [Case.Status.DETECTIVE_PENDING, Case.Status.SERGEANT_PENDING]:
            return Response({"error": "Case is not in an approvable state."}, status=status.HTTP_400_BAD_REQUEST)
        role_map = {
            Case.ApprovalStage.DETECTIVE: "Detective",
            Case.ApprovalStage.SERGEANT: "Sergeant",
            Case.ApprovalStage.CAPTAIN: "Captain",
            Case.ApprovalStage.CHIEF: "Chief",
        }
        required_role = role_map.get(case.approval_stage)
        if required_role and not user_has_any_role(request.user, [required_role]):
            return Response({"error": "Only the assigned approval rank can approve this case."}, status=status.HTTP_403_FORBIDDEN)
        if case.approval_stage == Case.ApprovalStage.DETECTIVE and case.status == Case.Status.DETECTIVE_PENDING:
            if not case.suspect_evaluations.exists():
                return Response(
                    {"error": "At least one suspect must be added before sending to sergeant."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Start a fresh sergeant review cycle each time detective sends the case again.
            case.suspect_evaluations.exclude(sergeant_decision="").update(
                sergeant_decision="",
                status=SuspectEvaluation.Status.PENDING,
            )
            case.status = Case.Status.SERGEANT_PENDING
            case.approval_stage = Case.ApprovalStage.SERGEANT
        else:
            return Response({"error": "Approval is not allowed at this stage."}, status=status.HTTP_400_BAD_REQUEST)
        case.status_note = request.data.get("note", "")
        case.supervisor = request.user
        case.save()
        log_activity(request.user, "approve_case", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="report")
    def report(self, request, pk=None):
        case = self.get_object()
        evidences = (
            Evidence.objects.filter(case=case)
            .select_related("recorded_by")
            .prefetch_related("attachments")
            .order_by("-created_at")
        )
        pursuits = PursuitStatus.objects.filter(case=case).select_related("suspect").order_by("-created_at")
        evaluations = SuspectEvaluation.objects.filter(case=case).select_related("suspect").order_by("-created_at")
        tips = Tip.objects.filter(case=case).order_by("-created_at")
        trial = getattr(case, "trial", None)
        evidence_ids = list(evidences.values_list("id", flat=True))
        evaluation_ids = list(evaluations.values_list("id", flat=True))
        log_q = Q(target_type="case", target_id=str(case.id))
        if case.complaint_id:
            log_q |= Q(target_type="complaint", target_id=str(case.complaint_id))
        if evidence_ids:
            log_q |= Q(target_type="evidence", target_id__in=[str(eid) for eid in evidence_ids])
        if evaluation_ids:
            log_q |= Q(target_type="suspect_evaluation", target_id__in=[str(eid) for eid in evaluation_ids])
        logs = ActivityLog.objects.filter(log_q).select_related("actor").order_by("created_at")
        decision_log = []
        if case.status_note:
            decision_log.append(
                {
                    "timestamp": case.updated_at,
                    "title": "Case status update",
                    "actor": case.supervisor.username if case.supervisor_id else None,
                    "details": case.status_note,
                }
            )
        if case.complaint_id:
            complaint = case.complaint
            if complaint.rejection_reason:
                decision_log.append(
                    {
                        "timestamp": complaint.updated_at,
                        "title": f"Complaint {complaint.status}",
                        "actor": None,
                        "details": complaint.rejection_reason,
                    }
                )
            for cc in complaint.extra_complainants.select_related("person", "reviewed_by_cadet", "reviewed_by_officer"):
                cc_details = (
                    f"{cc.person.full_name}: cadet={cc.status}, officer={cc.officer_status}"
                    f" (attempts={cc.cadet_attempts})"
                )
                if cc.rejection_reason:
                    cc_details += f" — cadet note: {cc.rejection_reason}"
                if cc.officer_rejection_reason:
                    cc_details += f" — officer note: {cc.officer_rejection_reason}"
                decision_log.append(
                    {
                        "timestamp": cc.updated_at,
                        "title": "Complaint complainant review",
                        "actor": (
                            cc.reviewed_by_officer.username
                            if cc.reviewed_by_officer_id
                            else (cc.reviewed_by_cadet.username if cc.reviewed_by_cadet_id else None)
                        ),
                        "details": cc_details,
                    }
                )
        for cr in case.complainant_reviews.select_related("person", "reviewed_by_cadet", "reviewed_by_officer"):
            cr_details = (
                f"{cr.person.full_name}: cadet={cr.status}, officer={cr.officer_status}"
                f" (attempts={cr.cadet_attempts})"
            )
            if cr.rejection_reason:
                cr_details += f" — cadet note: {cr.rejection_reason}"
            if cr.officer_rejection_reason:
                cr_details += f" — officer note: {cr.officer_rejection_reason}"
            decision_log.append(
                {
                    "timestamp": cr.updated_at,
                    "title": "Case complainant review",
                    "actor": (
                        cr.reviewed_by_officer.username
                        if cr.reviewed_by_officer_id
                        else (cr.reviewed_by_cadet.username if cr.reviewed_by_cadet_id else None)
                    ),
                    "details": cr_details,
                }
            )
        for ev in evidences:
            if ev.status != Evidence.Status.PENDING or ev.status_note:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": f"Evidence {ev.status}",
                        "actor": ev.reviewed_by.username if ev.reviewed_by_id else None,
                        "details": ev.status_note or ev.title,
                    }
                )
        for ev in evaluations:
            if ev.detective_score is not None:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": "Detective score",
                        "actor": None,
                        "details": f"{ev.suspect.full_name} score: {ev.detective_score}"
                        + (f" — {ev.notes}" if ev.notes else ""),
                    }
                )
            if ev.sergeant_score is not None:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": "Sergeant score",
                        "actor": None,
                        "details": f"{ev.suspect.full_name} score: {ev.sergeant_score}"
                        + (f" — {ev.notes}" if ev.notes else ""),
                    }
                )
            if ev.sergeant_decision:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": "Sergeant decision",
                        "actor": None,
                        "details": f"{ev.suspect.full_name}: {ev.sergeant_decision}"
                        + (f" — {ev.notes}" if ev.notes else ""),
                    }
                )
            if ev.captain_decision:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": "Captain decision",
                        "actor": None,
                        "details": f"{ev.suspect.full_name}: {ev.captain_decision}"
                        + (f" — {ev.notes}" if ev.notes else ""),
                    }
                )
            if ev.chief_decision:
                decision_log.append(
                    {
                        "timestamp": ev.updated_at,
                        "title": "Chief decision",
                        "actor": None,
                        "details": f"{ev.suspect.full_name}: {ev.chief_decision}"
                        + (f" — {ev.notes}" if ev.notes else ""),
                    }
                )
        decision_log.sort(key=lambda item: item["timestamp"] or timezone.now())
        return Response(
            {
                "case": CaseSerializer(case, context={"request": request}).data,
                "complaint": ComplaintSerializer(case.complaint, context={"request": request}).data
                if case.complaint_id
                else None,
                "evidences": EvidenceSerializer(evidences, many=True, context={"request": request}).data,
                "pursuits": PursuitStatusSerializer(pursuits, many=True, context={"request": request}).data,
                "suspect_evaluations": SuspectEvaluationSerializer(
                    evaluations, many=True, context={"request": request}
                ).data,
                "tips": TipSerializer(tips, many=True, context={"request": request}).data,
                "trial": TrialSerializer(trial, context={"request": request}).data if trial else None,
                "activity_logs": ActivityLogSerializer(logs, many=True, context={"request": request}).data,
                "decision_log": [
                    {
                        "timestamp": item["timestamp"],
                        "title": item["title"],
                        "actor": item["actor"],
                        "details": item["details"],
                    }
                    for item in decision_log
                ],
            }
        )

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        case = self.get_object()
        case.status = Case.Status.CLOSED
        case.status_note = request.data.get("note", "")
        case.resolved_at = case.resolved_at or timezone.now()
        case.save()
        log_activity(request.user, "close_case", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="start")
    def start(self, request, pk=None):
        case = self.get_object()
        if case.status not in [Case.Status.ACTIVE]:
            return Response({"error": "Case must be active to start investigation."}, status=status.HTTP_400_BAD_REQUEST)
        case.status = Case.Status.IN_PROGRESS
        case.status_note = request.data.get("note", "")
        case.save()
        log_activity(request.user, "start_case", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="detective-capture")
    def detective_capture(self, request, pk=None):
        case = self.get_object()
        if case.status != Case.Status.DETECTIVE_FOLLOWUP:
            return Response({"error": "Case is not ready for detective capture update."}, status=status.HTTP_400_BAD_REQUEST)
        if not case.suspect_evaluations.exists():
            return Response({"error": "At least one suspect must be added before capture."}, status=status.HTTP_400_BAD_REQUEST)
        if case.suspect_evaluations.filter(sergeant_decision="").exists():
            return Response({"error": "All suspects must be reviewed by the sergeant before capture."}, status=status.HTTP_400_BAD_REQUEST)
        if not case.suspect_evaluations.filter(sergeant_decision="approve").exists():
            return Response({"error": "At least one suspect must be approved before capture."}, status=status.HTTP_400_BAD_REQUEST)
        case.status = Case.Status.IN_PROGRESS
        case.status_note = request.data.get("note", "")
        case.save()
        log_activity(request.user, "detective_capture", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="participants")
    def add_participant(self, request, pk=None):
        case = self.get_object()
        role = request.data.get("role")
        person_data = request.data.get("person")
        if not role or not person_data:
            return Response({"error": "role and person are required."}, status=status.HTTP_400_BAD_REQUEST)
        if role == CaseParticipant.Role.COMPLAINANT:
            return Response(
                {"error": "Use the case complainant workflow endpoint for complainants."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        person, _ = Person.objects.get_or_create(
            national_id=person_data.get("national_id"), defaults=person_data
        )
        cp, _ = CaseParticipant.objects.get_or_create(case=case, person=person, role=role)
        return Response(CaseParticipantSerializer(cp, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complainants")
    def add_case_complainant(self, request, pk=None):
        case = self.get_object()
        if user_has_any_role(request.user, ["Cadet"]):
            return Response({"error": "Cadets cannot add complainants to cases."}, status=status.HTTP_403_FORBIDDEN)
        if not user_has_any_role(
            request.user,
            ["Officer", "Patrol Officer", "Police Officer", "Detective", "Sergeant", "Captain", "Chief"],
        ):
            return Response({"error": "Only police staff can add complainants to cases."}, status=status.HTTP_403_FORBIDDEN)
        identifier = (request.data.get("identifier") or "").strip()
        if not identifier:
            return Response(
                {"error": "Provide an identifier (username, email, national ID, or phone number)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        person = self._person_from_identifier(identifier)
        if not person:
            return Response(
                {
                    "error": (
                        "No matching user found. The complainant must already be registered "
                        "with username, email, national ID, or phone number."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if CaseParticipant.objects.filter(case=case, person=person, role=CaseParticipant.Role.COMPLAINANT).exists():
            return Response(
                {"error": "This complainant is already part of this case."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        review, created = CaseComplainantReview.objects.get_or_create(
            case=case,
            person=person,
            defaults={"added_by": request.user},
        )
        if not created:
            if review.status == CaseComplainantReview.Status.REMOVED:
                review.status = CaseComplainantReview.Status.PENDING
                review.cadet_attempts = 0
                review.officer_status = CaseComplainantReview.OfficerStatus.PENDING
                review.rejection_reason = ""
                review.officer_rejection_reason = ""
                review.reviewed_by_cadet = None
                review.reviewed_by_officer = None
                review.added_by = request.user
                review.save()
            else:
                return Response(
                    {"error": "This complainant is already in the case workflow."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        log_activity(request.user, "add_case_complainant", "case", case.id, message=identifier)
        return Response(CaseComplainantReviewSerializer(review, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complainants/(?P<complainant_pk>[^/.]+)/cadet-review")
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="complainant_pk",
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                required=True,
            )
        ]
    )
    def cadet_review_case_complainant(self, request, pk=None, complainant_pk=None):
        case = self.get_object()
        review = get_object_or_404(CaseComplainantReview, case=case, id=complainant_pk)
        decision = (request.data.get("decision") or "").strip().lower()
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if review.status == CaseComplainantReview.Status.REMOVED:
            return Response({"error": "This complainant has already been removed."}, status=status.HTTP_400_BAD_REQUEST)
        if (
            review.status == CaseComplainantReview.Status.APPROVED
            and review.officer_status == CaseComplainantReview.OfficerStatus.APPROVED
        ):
            return Response({"error": "This complainant is already finalized."}, status=status.HTTP_400_BAD_REQUEST)
        review.reviewed_by_cadet = request.user
        if decision == "approve":
            review.status = CaseComplainantReview.Status.APPROVED
            review.rejection_reason = ""
            if review.officer_status == CaseComplainantReview.OfficerStatus.REJECTED:
                review.officer_status = CaseComplainantReview.OfficerStatus.PENDING
                review.officer_rejection_reason = ""
                review.reviewed_by_officer = None
        else:
            if not note:
                return Response({"error": "Rejection reason is required."}, status=status.HTTP_400_BAD_REQUEST)
            review.cadet_attempts += 1
            if review.cadet_attempts >= 3:
                review.status = CaseComplainantReview.Status.REMOVED
                review.rejection_reason = "Removed after 3 cadet rejections."
                review.officer_status = CaseComplainantReview.OfficerStatus.PENDING
                review.officer_rejection_reason = ""
                review.reviewed_by_officer = None
            else:
                review.status = CaseComplainantReview.Status.REJECTED
                review.rejection_reason = note
                if review.officer_status == CaseComplainantReview.OfficerStatus.REJECTED:
                    review.officer_status = CaseComplainantReview.OfficerStatus.PENDING
                    review.officer_rejection_reason = ""
                    review.reviewed_by_officer = None
        review.save()
        log_activity(request.user, "cadet_review_case_complainant", "case", case.id, message=decision)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="complainants/(?P<complainant_pk>[^/.]+)/officer-review")
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="complainant_pk",
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                required=True,
            )
        ]
    )
    def officer_review_case_complainant(self, request, pk=None, complainant_pk=None):
        case = self.get_object()
        review = get_object_or_404(CaseComplainantReview, case=case, id=complainant_pk)
        decision = (request.data.get("decision") or "").strip().lower()
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if review.status != CaseComplainantReview.Status.APPROVED:
            return Response(
                {"error": "Complainant must be cadet-approved before officer review."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if review.officer_status == CaseComplainantReview.OfficerStatus.APPROVED:
            return Response({"error": "This complainant is already approved by officer."}, status=status.HTTP_400_BAD_REQUEST)
        if decision == "approve":
            review.officer_status = CaseComplainantReview.OfficerStatus.APPROVED
            review.officer_rejection_reason = ""
            review.reviewed_by_officer = request.user
            CaseParticipant.objects.get_or_create(
                case=case,
                person=review.person,
                role=CaseParticipant.Role.COMPLAINANT,
                defaults={"assigned_by": request.user},
            )
        else:
            if not note:
                return Response({"error": "Rejection reason is required."}, status=status.HTTP_400_BAD_REQUEST)
            review.officer_status = CaseComplainantReview.OfficerStatus.REJECTED
            review.officer_rejection_reason = note
            review.status = CaseComplainantReview.Status.REJECTED
            review.rejection_reason = note
            review.reviewed_by_officer = request.user
        review.save()
        log_activity(request.user, "officer_review_case_complainant", "case", case.id, message=decision)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="complainants/(?P<complainant_pk>[^/.]+)/resubmit")
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="complainant_pk",
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                required=True,
            )
        ]
    )
    def resubmit_case_complainant(self, request, pk=None, complainant_pk=None):
        case = self.get_object()
        review = get_object_or_404(CaseComplainantReview, case=case, id=complainant_pk)
        if review.person.user_id != request.user.id:
            return Response({"error": "Only this complainant can resubmit."}, status=status.HTTP_403_FORBIDDEN)
        if review.status == CaseComplainantReview.Status.REMOVED:
            return Response(
                {"error": "This complainant was removed after 3 cadet rejections and cannot resubmit."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if review.status != CaseComplainantReview.Status.REJECTED:
            return Response({"error": "Only rejected complainants can resubmit."}, status=status.HTTP_400_BAD_REQUEST)
        person_payload = {}
        if "full_name" in request.data:
            person_payload["full_name"] = request.data.get("full_name")
        if "phone_number" in request.data:
            person_payload["phone_number"] = request.data.get("phone_number")
        if "email" in request.data:
            person_payload["email"] = request.data.get("email")
        if person_payload:
            person_serializer = PersonSerializer(
                review.person,
                data=person_payload,
                partial=True,
                context={"request": request},
            )
            if not person_serializer.is_valid():
                return Response(
                    {"error": person_serializer.errors},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            person_serializer.save()
        review.status = CaseComplainantReview.Status.PENDING
        review.rejection_reason = ""
        review.reviewed_by_cadet = None
        review.officer_status = CaseComplainantReview.OfficerStatus.PENDING
        review.officer_rejection_reason = ""
        review.reviewed_by_officer = None
        review.save()
        log_activity(request.user, "resubmit_case_complainant", "case", case.id, message=str(review.id))
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="send-to-trial")
    def send_to_trial(self, request, pk=None):
        case = self.get_object()
        if case.status not in [Case.Status.IN_PROGRESS, Case.Status.ACTIVE]:
            return Response({"error": "Case must be active or in progress to send to trial."}, status=status.HTTP_400_BAD_REQUEST)
        case.status = Case.Status.IN_TRIAL
        case.status_note = request.data.get("note", "")
        case.save(update_fields=["status", "status_note", "updated_at"])
        log_activity(request.user, "send_case_to_trial", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="set-bail")
    def set_bail(self, request, pk=None):
        case = self.get_object()
        if case.severity not in [Case.Severity.LEVEL_2, Case.Severity.LEVEL_3]:
            return Response({"error": "Bail is allowed only for level 2 or 3 cases."}, status=status.HTTP_400_BAD_REQUEST)
        if case.status == Case.Status.CLOSED:
            return Response(
                {"error": "Closed cases cannot receive bail amount."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        has_active_suspect = SuspectEvaluation.objects.filter(
            case=case,
            sergeant_decision="approve",
            judge_verdict="",
        ).exists()
        if not has_active_suspect:
            return Response(
                {"error": "Bail can be set only while at least one approved suspect is still active."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        amount = request.data.get("amount")
        try:
            amount_value = int(amount)
        except (TypeError, ValueError):
            return Response({"error": "amount must be a number."}, status=status.HTTP_400_BAD_REQUEST)
        if amount_value <= 0:
            return Response({"error": "amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        case.bail_amount = amount_value
        case.bail_set_by = request.user
        case.save(update_fields=["bail_amount", "bail_set_by", "updated_at"])
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="clear-bail")
    def clear_bail(self, request, pk=None):
        case = self.get_object()
        case.bail_amount = None
        case.bail_set_by = None
        case.save(update_fields=["bail_amount", "bail_set_by", "updated_at"])
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="set-fine")
    def set_fine(self, request, pk=None):
        case = self.get_object()
        if case.severity != Case.Severity.LEVEL_3:
            return Response({"error": "Fine is allowed only for level 3 cases."}, status=status.HTTP_400_BAD_REQUEST)
        if case.status != Case.Status.CLOSED:
            return Response({"error": "Fine can be set only after case is closed."}, status=status.HTTP_400_BAD_REQUEST)
        guilty_evaluations = SuspectEvaluation.objects.filter(case=case, judge_verdict="guilty")
        if not guilty_evaluations.exists():
            return Response({"error": "No guilty verdict recorded for this case."}, status=status.HTTP_400_BAD_REQUEST)
        if guilty_evaluations.filter(captain_bail_decision="").exists():
            return Response(
                {"error": "Sergeant must approve/reject bail-payment request for all level 3 criminals first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not guilty_evaluations.filter(captain_bail_decision="approve").exists():
            return Response(
                {"error": "Fine can be set only when sergeant approves bail-payment request for at least one criminal."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        amount = request.data.get("amount")
        try:
            amount_value = int(amount)
        except (TypeError, ValueError):
            return Response({"error": "amount must be a number."}, status=status.HTTP_400_BAD_REQUEST)
        if amount_value <= 0:
            return Response({"error": "amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        case.fine_amount = amount_value
        case.fine_set_by = request.user
        case.save(update_fields=["fine_amount", "fine_set_by", "updated_at"])
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="clear-fine")
    def clear_fine(self, request, pk=None):
        case = self.get_object()
        case.fine_amount = None
        case.fine_set_by = None
        case.save(update_fields=["fine_amount", "fine_set_by", "updated_at"])
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="captain-decision")
    def captain_decision(self, request, pk=None):
        case = self.get_object()
        if case.status != Case.Status.CAPTAIN_REVIEW:
            return Response({"error": "Case is not ready for captain review."}, status=status.HTTP_400_BAD_REQUEST)
        if not user_has_any_role(request.user, ["Captain"]):
            return Response({"error": "Only captains can submit this decision."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision", "").strip().lower()
        note = request.data.get("note", "")
        if decision not in ["guilty", "not_guilty"]:
            return Response({"error": "decision must be guilty or not_guilty"}, status=status.HTTP_400_BAD_REQUEST)
        case.status_note = note or f"Captain decision: {decision}"
        if case.severity == Case.Severity.CRITICAL:
            case.status = Case.Status.CHIEF_REVIEW
        else:
            case.status = Case.Status.IN_TRIAL
        case.save(update_fields=["status", "status_note", "updated_at"])
        log_activity(request.user, "captain_decision", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="chief-decision")
    def chief_decision(self, request, pk=None):
        case = self.get_object()
        if case.status != Case.Status.CHIEF_REVIEW:
            return Response({"error": "Case is not ready for chief review."}, status=status.HTTP_400_BAD_REQUEST)
        if not user_has_any_role(request.user, ["Chief"]):
            return Response({"error": "Only chiefs can submit this decision."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision", "").strip().lower()
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve or reject"}, status=status.HTTP_400_BAD_REQUEST)
        case.status_note = note or f"Chief decision: {decision}"
        if decision == "approve":
            case.status = Case.Status.IN_TRIAL
        else:
            case.status = Case.Status.CAPTAIN_REVIEW
        case.save(update_fields=["status", "status_note", "updated_at"])
        log_activity(request.user, "chief_decision", "case", case.id, message=case.status_note)
        return Response(CaseSerializer(case, context={"request": request}).data)


class FieldReportViewSet(viewsets.ModelViewSet):
    queryset = (
        FieldReport.objects.select_related("created_by")
        .prefetch_related("witnesses__person")
        .order_by("-created_at")
    )
    serializer_class = FieldReportSerializer
    filterset_fields = ["status", "severity", "approval_stage"]
    search_fields = ["title", "description", "number"]

    def get_permissions(self):
        if self.action in ["create", "approve", "reject"]:
            return [IsPoliceRole()]
        return [permissions.IsAuthenticated()]

    def _rank_for(self, user):
        rank_map = {
            "officer": 1,
            "patrol officer": 1,
            "police officer": 1,
            "detective": 2,
            "sergeant": 3,
            "captain": 4,
            "chief": 5,
        }
        roles = [name.lower().strip() for name in user_role_names(user)]
        ranks = [rank_map.get(role) for role in roles]
        ranks = [r for r in ranks if r is not None]
        return max(ranks) if ranks else -1

    def _approval_stage_for_rank(self, rank: int):
        if rank <= 1:
            return FieldReport.ApprovalStage.DETECTIVE
        if rank == 2:
            return FieldReport.ApprovalStage.SERGEANT
        if rank in [3, 4]:
            return FieldReport.ApprovalStage.CAPTAIN
        return None

    def _can_user_review_report(self, user, report) -> bool:
        reviewer_rank = self._rank_for(user)
        creator_rank = self._rank_for(report.created_by) if report.created_by else -1
        return reviewer_rank > creator_rank

    def _get_or_create_person_for_user(self, user):
        if not user:
            return None
        full_name = f"{user.first_name} {user.last_name}".strip() or user.username
        defaults = {
            "full_name": full_name,
            "national_id": user.national_id,
            "phone_number": user.phone_number,
            "email": user.email,
            "user": user,
        }
        if user.national_id:
            person, _ = Person.objects.get_or_create(national_id=user.national_id, defaults=defaults)
        else:
            person = Person.objects.filter(user=user).first()
            if not person:
                person = Person.objects.create(**defaults)
        if not person.user_id:
            person.user = user
            person.save(update_fields=["user"])
        return person

    def get_queryset(self):
        user = self.request.user
        if user_has_any_role(user, ["Administrator"]):
            return self.queryset
        if not user.groups.exists():
            return self.queryset.none()
        created = self.queryset.filter(created_by=user)
        pending_reports = self.queryset.filter(status=FieldReport.Status.PENDING)
        review_ids = [report.id for report in pending_reports if self._can_user_review_report(user, report)]
        review_qs = self.queryset.filter(id__in=review_ids)
        return (created | review_qs).distinct()

    def _attach_witnesses_to_case(self, case, witness_inputs, reporter=None):
        for witness in witness_inputs:
            national_id = witness.get("national_id")
            phone_number = witness.get("phone_number")
            user_match = None
            if national_id:
                user_match = get_user_model().objects.filter(national_id=national_id).first()
            if not user_match and phone_number:
                user_match = get_user_model().objects.filter(phone_number=phone_number).first()
            if not user_match:
                continue
            person = self._get_or_create_person_for_user(user_match)
            CaseParticipant.objects.get_or_create(case=case, person=person, role=CaseParticipant.Role.WITNESS)
        if reporter:
            reporter_person = self._get_or_create_person_for_user(reporter)
            if reporter_person:
                CaseParticipant.objects.get_or_create(
                    case=case, person=reporter_person, role=CaseParticipant.Role.WITNESS
                )

    def _attach_witnesses_to_report(self, report, witness_inputs, reporter=None):
        for witness in witness_inputs:
            national_id = witness.get("national_id")
            phone_number = witness.get("phone_number")
            user_match = None
            if national_id:
                user_match = get_user_model().objects.filter(national_id=national_id).first()
            if not user_match and phone_number:
                user_match = get_user_model().objects.filter(phone_number=phone_number).first()
            if not user_match:
                continue
            person = self._get_or_create_person_for_user(user_match)
            FieldReportWitness.objects.get_or_create(report=report, person=person)
        if reporter:
            reporter_person = self._get_or_create_person_for_user(reporter)
            if reporter_person:
                FieldReportWitness.objects.get_or_create(report=report, person=reporter_person)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        number = data.get("number") or generate_field_report_number()
        creator_rank = self._rank_for(request.user)
        approval_stage = self._approval_stage_for_rank(creator_rank)
        witness_inputs = request.data.get("witness_inputs") or []
        if approval_stage is None:
            case = Case.objects.create(
                number=generate_case_number(),
                title=data.get("title"),
                description=data.get("description"),
                source=Case.Source.FIELD_REPORT,
                severity=data.get("severity", Case.Severity.LEVEL_3),
                status=Case.Status.DETECTIVE_PENDING,
                approval_stage=Case.ApprovalStage.DETECTIVE,
                created_by=request.user,
                supervisor=request.user,
                location=data.get("location", ""),
                occurred_at=data.get("occurred_at"),
            )
            self._attach_witnesses_to_case(case, witness_inputs, reporter=request.user)
            log_activity(request.user, "field_report_auto_case", "case", case.id)
            return Response({"case": CaseSerializer(case, context={"request": request}).data}, status=status.HTTP_201_CREATED)
        report = serializer.save(
            number=number,
            created_by=request.user,
            approval_stage=approval_stage,
            status=FieldReport.Status.PENDING,
        )
        self._attach_witnesses_to_report(report, witness_inputs, reporter=request.user)
        log_activity(request.user, "create_field_report", "field_report", report.id)
        return Response(self.get_serializer(report).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        report = self.get_object()
        if report.status != FieldReport.Status.PENDING:
            return Response({"error": "Field report is not pending."}, status=status.HTTP_400_BAD_REQUEST)
        if not self._can_user_review_report(request.user, report):
            return Response({"error": "Only a higher police rank can approve this report."}, status=status.HTTP_403_FORBIDDEN)
        case = Case.objects.create(
            number=generate_case_number(),
            title=report.title,
            description=report.description,
            source=Case.Source.FIELD_REPORT,
            severity=report.severity,
            status=Case.Status.DETECTIVE_PENDING,
            approval_stage=Case.ApprovalStage.DETECTIVE,
            created_by=report.created_by,
            supervisor=request.user,
            location=report.location,
            occurred_at=report.occurred_at,
        )
        for witness in report.witnesses.select_related("person"):
            CaseParticipant.objects.get_or_create(case=case, person=witness.person, role=CaseParticipant.Role.WITNESS)
        reporter_person = self._get_or_create_person_for_user(report.created_by)
        if reporter_person:
            CaseParticipant.objects.get_or_create(case=case, person=reporter_person, role=CaseParticipant.Role.WITNESS)
        report.delete()
        log_activity(request.user, "approve_field_report", "case", case.id)
        return Response({"case": CaseSerializer(case, context={"request": request}).data}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        report = self.get_object()
        if report.status != FieldReport.Status.PENDING:
            return Response({"error": "Field report is not pending."}, status=status.HTTP_400_BAD_REQUEST)
        if not self._can_user_review_report(request.user, report):
            return Response({"error": "Only a higher police rank can reject this report."}, status=status.HTTP_403_FORBIDDEN)
        note = request.data.get("note", "")
        report.status = FieldReport.Status.REJECTED
        report.save(update_fields=["status", "updated_at"])
        log_activity(request.user, "reject_field_report", "field_report", report.id, message=note)
        return Response(self.get_serializer(report).data)


class EvidenceViewSet(viewsets.ModelViewSet):
    queryset = Evidence.objects.select_related("case", "recorded_by").order_by("-created_at")
    serializer_class = EvidenceSerializer
    filterset_fields = ["case", "type", "status"]
    search_fields = ["title", "description"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = Evidence.objects.select_related("case", "recorded_by").prefetch_related("attachments").order_by("-created_at")
        user = self.request.user
        if user.is_superuser:
            return qs
        if user_has_any_role(user, ["Coroner"]):
            return qs.filter(
                Q(type=Evidence.Type.FORENSIC, status=Evidence.Status.PENDING) | Q(recorded_by=user)
            ).distinct()
        if user_has_any_role(user, ["Detective"]):
            return qs
        return qs.filter(recorded_by=user)

    def get_permissions(self):
        if self.action in ["create", "add_attachment"]:
            return [permissions.IsAuthenticated()]
        if self.action in ["review"]:
            return [IsCoroner()]
        if self.action in ["assign_case"]:
            return [IsDetective()]
        return [permissions.IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        data = request.data.dict() if hasattr(request.data, "dict") else dict(request.data)
        extra_data = data.get("extra_data")
        if isinstance(extra_data, str):
            try:
                extra_data = json.loads(extra_data)
            except json.JSONDecodeError:
                extra_data = {}
        data["extra_data"] = extra_data
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        evidence_type = serializer.validated_data.get("type")
        case_obj = serializer.validated_data.get("case")
        if case_obj and case_obj.status in [Case.Status.CLOSED, Case.Status.REJECTED]:
            return Response(
                {"error": "Closed or rejected cases cannot receive new evidence."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        police_or_coroner = user_has_any_role(
            request.user,
            [
                "Administrator",
                "Officer",
                "Patrol Officer",
                "Police Officer",
                "Detective",
                "Sergeant",
                "Captain",
                "Chief",
                "Cadet",
                "Coroner",
            ],
        )
        if not police_or_coroner and case_obj is not None:
            return Response(
                {"error": "Citizens cannot assign evidence to a case directly. Submit it and wait for detective assignment."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not police_or_coroner and evidence_type == Evidence.Type.FORENSIC:
            return Response(
                {"error": "Citizens cannot submit forensic evidence directly."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        files = request.FILES.getlist("files")
        if evidence_type == Evidence.Type.FORENSIC and not files:
            return Response(
                {"error": "Forensic evidence requires at least one attachment."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self.perform_create(serializer)
        evidence = serializer.instance
        for file_obj in files:
            attachment = EvidenceAttachment.objects.create(evidence=evidence, file=file_obj, description="")
            log_activity(
                request.user,
                "add_evidence_attachment",
                "evidence",
                evidence.id,
                message=attachment.description,
            )
        headers = self.get_success_headers(serializer.data)
        return Response(EvidenceSerializer(evidence, context={"request": request}).data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        evidence_type = serializer.validated_data.get("type", Evidence.Type.GENERIC)
        police_or_coroner = user_has_any_role(
            self.request.user,
            [
                "Administrator",
                "Officer",
                "Patrol Officer",
                "Police Officer",
                "Detective",
                "Sergeant",
                "Captain",
                "Chief",
                "Cadet",
                "Coroner",
            ],
        )
        is_coroner = user_has_any_role(self.request.user, ["Coroner"])
        if is_coroner:
            status_value = Evidence.Status.APPROVED
        elif police_or_coroner:
            status_value = Evidence.Status.PENDING if evidence_type == Evidence.Type.FORENSIC else Evidence.Status.APPROVED
        else:
            status_value = Evidence.Status.PENDING
        status_note = ""
        if not police_or_coroner:
            status_note = "Submitted by citizen. Waiting for detective case assignment."
        evidence = serializer.save(recorded_by=self.request.user, status=status_value, status_note=status_note)
        log_activity(self.request.user, "create_evidence", "evidence", evidence.id, message=evidence.title)

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        evidence = self.get_object()
        decision = request.data.get("decision")
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if evidence.type != Evidence.Type.FORENSIC:
            return Response(
                {"error": "Coroner review is only allowed for forensic evidence."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if evidence.status != Evidence.Status.PENDING:
            return Response(
                {"error": "Only pending forensic evidence can be reviewed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if decision == "approve" and evidence.type == Evidence.Type.FORENSIC:
            if not evidence.attachments.exists():
                return Response(
                    {"error": "Forensic evidence needs at least one attachment before approval."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        evidence.status = Evidence.Status.APPROVED if decision == "approve" else Evidence.Status.REJECTED
        evidence.status_note = note
        evidence.reviewed_by = request.user
        evidence.save()
        log_activity(request.user, "review_evidence", "evidence", evidence.id, message=note)
        return Response(EvidenceSerializer(evidence, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="attachments", parser_classes=[MultiPartParser])
    def add_attachment(self, request, pk=None):
        evidence = self.get_object()
        can_modify = (
            request.user.is_superuser
            or user_has_any_role(
                request.user,
                [
                    "Administrator",
                    "Officer",
                    "Patrol Officer",
                    "Police Officer",
                    "Detective",
                    "Sergeant",
                    "Captain",
                    "Chief",
                    "Cadet",
                    "Coroner",
                ],
            )
            or evidence.recorded_by_id == request.user.id
        )
        if not can_modify:
            return Response({"error": "You do not have permission to add attachments."}, status=status.HTTP_403_FORBIDDEN)
        file_obj = request.FILES.get("file")
        description = request.data.get("description", "")
        if not file_obj:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        attachment = EvidenceAttachment.objects.create(evidence=evidence, file=file_obj, description=description)
        log_activity(request.user, "add_evidence_attachment", "evidence", evidence.id, message=description)
        return Response(EvidenceAttachmentSerializer(attachment, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="assign-case")
    def assign_case(self, request, pk=None):
        evidence = self.get_object()
        case_id = request.data.get("case")
        if not case_id:
            return Response({"error": "case is required."}, status=status.HTTP_400_BAD_REQUEST)
        case = get_object_or_404(Case, pk=case_id)
        if case.status in [Case.Status.CLOSED, Case.Status.REJECTED]:
            return Response(
                {"error": "Closed or rejected cases cannot receive new evidence."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        submitter_is_police_or_coroner = False
        if evidence.recorded_by_id:
            submitter_is_police_or_coroner = user_has_any_role(
                evidence.recorded_by,
                [
                    "Administrator",
                    "Officer",
                    "Patrol Officer",
                    "Police Officer",
                    "Detective",
                    "Sergeant",
                    "Captain",
                    "Chief",
                    "Cadet",
                    "Coroner",
                ],
            )
        if submitter_is_police_or_coroner:
            return Response(
                {"error": "Assign-case is only for evidence submitted by citizens."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        evidence.case = case
        if evidence.type == Evidence.Type.FORENSIC:
            evidence.status = Evidence.Status.PENDING
            evidence.status_note = "Assigned by detective. Waiting for coroner review."
        else:
            evidence.status = Evidence.Status.APPROVED
            evidence.status_note = "Assigned by detective and added to case."
        evidence.reviewed_by = request.user
        evidence.save(update_fields=["case", "status", "status_note", "reviewed_by", "updated_at"])
        log_activity(request.user, "assign_citizen_evidence_case", "evidence", evidence.id, message=f"case:{case.id}")
        return Response(EvidenceSerializer(evidence, context={"request": request}).data)


class DetectiveBoardViewSet(viewsets.ModelViewSet):
    queryset = DetectiveBoard.objects.select_related("case", "owner").order_by("-created_at")
    serializer_class = DetectiveBoardSerializer

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsDetective()]
        return [permissions.IsAuthenticated()]


class BoardNoteViewSet(viewsets.ModelViewSet):
    queryset = BoardNote.objects.select_related("board").order_by("-created_at")
    serializer_class = BoardNoteSerializer

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsDetective()]
        return [permissions.IsAuthenticated()]


class BoardLinkViewSet(viewsets.ModelViewSet):
    queryset = BoardLink.objects.select_related("board", "source", "target").order_by("-created_at")
    serializer_class = BoardLinkSerializer

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsDetective()]
        return [permissions.IsAuthenticated()]


class PursuitStatusViewSet(viewsets.ModelViewSet):
    queryset = PursuitStatus.objects.select_related("case", "suspect").order_by("-created_at")
    serializer_class = PursuitStatusSerializer
    filterset_fields = ["status", "case"]

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update"]:
            return [IsSergeantOrAbove()]
        if self.action in ["public_high_alert"]:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def _build_high_alert_rows(self, request):
        pursuits = list(self.get_queryset())
        if not pursuits:
            return []
        pair_keys = {(p.case_id, p.suspect_id) for p in pursuits}
        case_ids = {pair[0] for pair in pair_keys}
        suspect_ids = {pair[1] for pair in pair_keys}
        evaluation_map = {
            (ev.case_id, ev.suspect_id): ev
            for ev in SuspectEvaluation.objects.filter(case_id__in=case_ids, suspect_id__in=suspect_ids)
        }
        all_suspect_pursuits = list(
            PursuitStatus.objects.filter(suspect_id__in=suspect_ids).select_related("case")
        )
        all_pair_keys = {(p.case_id, p.suspect_id) for p in all_suspect_pursuits}
        all_case_ids = {pair[0] for pair in all_pair_keys}
        all_evaluation_map = {
            (ev.case_id, ev.suspect_id): ev
            for ev in SuspectEvaluation.objects.filter(case_id__in=all_case_ids, suspect_id__in=suspect_ids)
        }
        today = timezone.now().date()
        max_days_open_by_suspect = {}
        max_days_all_by_suspect = {}
        max_severity_by_suspect = {}

        for p in all_suspect_pursuits:
            evaluation = all_evaluation_map.get((p.case_id, p.suspect_id))
            if not evaluation:
                continue
            if evaluation.judge_verdict == "not_guilty":
                continue
            is_approved_or_guilty = evaluation.sergeant_decision == "approve" or evaluation.judge_verdict == "guilty"
            if not is_approved_or_guilty:
                continue
            days = max(0, (today - p.pursuit_started_at).days)
            suspect_id = p.suspect_id
            max_days_all_by_suspect[suspect_id] = max(max_days_all_by_suspect.get(suspect_id, 0), days)
            max_severity_by_suspect[suspect_id] = max(max_severity_by_suspect.get(suspect_id, 0), p.severity_score)
            if p.case.status not in [Case.Status.CLOSED, Case.Status.REJECTED]:
                max_days_open_by_suspect[suspect_id] = max(max_days_open_by_suspect.get(suspect_id, 0), days)

        rows = []
        for p in pursuits:
            evaluation = evaluation_map.get((p.case_id, p.suspect_id))
            if not evaluation:
                continue
            if evaluation.judge_verdict == "not_guilty":
                continue
            is_guilty = evaluation.judge_verdict == "guilty"
            # Include active approved suspects and convicted criminals.
            if evaluation.sergeant_decision != "approve" and not is_guilty:
                continue
            if p.status in [PursuitStatus.Status.CAPTURED, PursuitStatus.Status.TRIAL, PursuitStatus.Status.CLOSED]:
                continue

            days = max(0, (today - p.pursuit_started_at).days)
            if days >= 30 and p.status == PursuitStatus.Status.WANTED:
                p.status = PursuitStatus.Status.HIGH_ALERT
                if not p.high_alert_at:
                    p.high_alert_at = today
                p.save(update_fields=["status", "high_alert_at", "updated_at"])

            if days < 30:
                continue

            severity_score = max_severity_by_suspect.get(p.suspect_id, p.severity_score)
            max_days_open = max_days_open_by_suspect.get(p.suspect_id, 0)
            max_days_basis = max_days_open or max_days_all_by_suspect.get(p.suspect_id, days)
            rank_score = max_days_basis * severity_score
            reward = rank_score * 20_000_000
            rows.append(
                {
                    "pursuit_id": p.id,
                    "case": {
                        "id": p.case_id,
                        "number": p.case.number,
                        "title": p.case.title,
                    },
                    "suspect": PersonSerializer(p.suspect, context={"request": request}).data,
                    "status": "criminal_high_alert" if is_guilty else p.status,
                    "severity_at_report": p.severity_at_report,
                    "days_under_pursuit": days,
                    "max_days_under_pursuit": max_days_basis,
                    "max_severity_score": severity_score,
                    "rank_score": rank_score,
                    "reward": reward,
                }
            )
        rows.sort(
            key=lambda x: (
                x["rank_score"],
                x["days_under_pursuit"],
                x["pursuit_id"],
            ),
            reverse=True,
        )
        return rows

    @action(detail=False, methods=["get"], url_path="high-alert")
    def high_alert(self, request):
        return Response(self._build_high_alert_rows(request))

    @action(detail=False, methods=["get"], url_path="public-high-alert")
    def public_high_alert(self, request):
        return Response(self._build_high_alert_rows(request))


class TipViewSet(viewsets.ModelViewSet):
    queryset = Tip.objects.select_related("case", "submitted_by").order_by("-created_at")
    serializer_class = TipSerializer
    filterset_fields = ["status", "case"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user or not user.is_authenticated:
            return qs.none()
        if user_has_any_role(user, ["Administrator"]):
            return qs
        if user_has_any_role(
            user,
            ["Officer", "Patrol Officer", "Police Officer", "Detective", "Sergeant", "Captain", "Chief", "Cadet", "Judge", "Coroner"],
        ):
            return qs
        return qs.filter(submitted_by=user)

    def get_permissions(self):
        if self.action in ["officer_review"]:
            return [IsOfficer()]
        if self.action in ["detective_review"]:
            return [IsDetective()]
        if self.action in ["mark_rewarded"]:
            return [IsSergeantOrAbove()]
        if self.action in ["reward_lookup"]:
            return [IsPoliceRole()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save()

    def _is_police_submitter(self, user) -> bool:
        return user_has_any_role(
            user,
            [
                "Officer",
                "Patrol Officer",
                "Police Officer",
                "Detective",
                "Sergeant",
                "Captain",
                "Chief",
                "Cadet",
                "Judge",
                "Coroner",
                "Administrator",
            ],
        )

    def _user_can_reference_case(self, user, case: Case) -> bool:
        if not user or not user.is_authenticated:
            return False
        if self._is_police_submitter(user):
            return True
        return (
            Case.objects.filter(id=case.id)
            .filter(
                Q(complainant_reviews__person__user=user)
                | Q(participants__person__user=user, participants__role=CaseParticipant.Role.COMPLAINANT)
                | Q(created_by=user)
            )
            .exists()
        )

    def create(self, request, *args, **kwargs):
        case_id = request.data.get("case")
        if case_id not in [None, "", "null"]:
            case = get_object_or_404(Case, pk=case_id)
            if case.status in [Case.Status.CLOSED, Case.Status.REJECTED]:
                return Response(
                    {"error": "Closed or rejected cases cannot receive new reward tips."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not self._user_can_reference_case(request.user, case):
                return Response(
                    {"error": "Citizens can only submit tips for cases they are part of."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="officer-review")
    def officer_review(self, request, pk=None):
        tip = self.get_object()
        if tip.status != Tip.Status.PENDING:
            return Response({"error": "Tip is not pending officer review."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision")
        if decision not in ["reject", "forward"]:
            return Response({"error": "decision must be reject|forward"}, status=status.HTTP_400_BAD_REQUEST)
        if decision == "reject":
            tip.status = Tip.Status.OFFICER_REJECTED
        else:
            tip.status = Tip.Status.SENT_TO_DETECTIVE
        tip.officer_reviewer = request.user
        tip.save()
        log_activity(request.user, "officer_review_tip", "tip", tip.id, message=decision)
        return Response(TipSerializer(tip, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="detective-review")
    def detective_review(self, request, pk=None):
        tip = self.get_object()
        if tip.status != Tip.Status.SENT_TO_DETECTIVE:
            return Response({"error": "Tip is not pending detective review."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision")
        reward_amount = int(request.data.get("reward_amount", 0))
        match_case_id = request.data.get("case")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if match_case_id not in [None, "", "null"]:
            matched_case = get_object_or_404(Case, pk=match_case_id)
            if matched_case.status in [Case.Status.CLOSED, Case.Status.REJECTED]:
                return Response(
                    {"error": "Closed or rejected cases cannot receive reward tips."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            tip.case = matched_case
        if decision == "approve":
            if not tip.case_id:
                return Response(
                    {"error": "Detective must match this tip to a case before approval."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if tip.case.status in [Case.Status.CLOSED, Case.Status.REJECTED]:
                return Response(
                    {"error": "Closed or rejected cases cannot receive reward tips."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            tip.status = Tip.Status.APPROVED
            tip.reward_code = uuid.uuid4().hex
            tip.reward_amount = reward_amount
        else:
            tip.status = Tip.Status.DETECTIVE_REJECTED
        tip.detective_reviewer = request.user
        tip.save()
        log_activity(request.user, "detective_review_tip", "tip", tip.id, message=decision)
        return Response(TipSerializer(tip, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="mark-rewarded")
    def mark_rewarded(self, request, pk=None):
        tip = self.get_object()
        if tip.status != Tip.Status.APPROVED:
            return Response({"error": "Only approved tips can be marked as rewarded."}, status=status.HTTP_400_BAD_REQUEST)
        tip.status = Tip.Status.REWARDED
        tip.save()
        log_activity(request.user, "mark_rewarded", "tip", tip.id)
        return Response(TipSerializer(tip, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="reward-lookup")
    def reward_lookup(self, request):
        reward_code = request.data.get("reward_code", "").strip()
        national_id = request.data.get("national_id", "").strip()
        if not reward_code or not national_id:
            return Response({"error": "reward_code and national_id are required"}, status=status.HTTP_400_BAD_REQUEST)
        tip = get_object_or_404(Tip, reward_code=reward_code)
        submitter = tip.submitted_by
        if not submitter or submitter.national_id != national_id:
            return Response({"error": "No reward found for provided credentials."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "reward_amount": tip.reward_amount,
                "status": tip.status,
                "reward_code": tip.reward_code,
                "submitter": {
                    "id": submitter.id,
                    "username": submitter.username,
                    "first_name": submitter.first_name,
                    "last_name": submitter.last_name,
                    "national_id": submitter.national_id,
                    "phone_number": submitter.phone_number,
                    "email": submitter.email,
                },
                "case": {
                    "id": tip.case_id,
                    "number": tip.case.number if tip.case else "",
                    "title": tip.case.title if tip.case else "",
                },
            }
        )


class BailPaymentViewSet(viewsets.ModelViewSet):
    queryset = BailPayment.objects.select_related("case", "person").order_by("-created_at")
    serializer_class = BailPaymentSerializer
    filterset_fields = ["status", "case"]

    def get_permissions(self):
        if self.action in ["create"]:
            return [permissions.IsAuthenticated()]
        if self.action in ["mark_paid"]:
            return [IsSergeantOrAbove()]
        if self.action in ["start"]:
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user_has_any_role(user, ["Administrator", "Sergeant", "Captain", "Chief"]):
            return qs
        if not user or not user.is_authenticated:
            return qs.none()
        return qs.filter(Q(person__user=user) | Q(person__national_id=user.national_id))

    def _callback_url(self, request, payment_id: int, return_to: str | None = None) -> str:
        base = settings.PAYMENT_CALLBACK_BASE or request.build_absolute_uri(reverse("payment-return"))
        separator = "&" if "?" in base else "?"
        url = f"{base}{separator}payment_id={payment_id}"
        safe_return = _safe_return_to(return_to)
        if safe_return:
            url = _append_query(url, {"return_to": safe_return})
        return url

    def _assert_payment_allowed(self, case: Case, person: Person, payment_type: str, amount: int | None = None):
        payload = {
            "case": case,
            "person": person,
            "payment_type": payment_type,
        }
        if amount is not None:
            payload["amount"] = amount
        serializer = self.get_serializer(context={"request": self.request})
        serializer.validate(payload)

    @action(detail=True, methods=["post"], url_path="start")
    def start(self, request, pk=None):
        payment = self.get_object()
        user = request.user
        if not user_has_any_role(user, ["Administrator", "Sergeant", "Captain", "Chief"]):
            if not (
                payment.person.user_id == user.id
                or (user.national_id and payment.person.national_id == user.national_id)
            ):
                return Response({"error": "You are not allowed to start this payment."}, status=status.HTTP_403_FORBIDDEN)
        if payment.status != BailPayment.Status.PENDING:
            return Response({"error": "Payment is not pending."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            self._assert_payment_allowed(
                case=payment.case,
                person=payment.person,
                payment_type=payment.payment_type,
                amount=payment.amount,
            )
        except ValidationError as exc:
            return Response({"error": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        if not payment.gateway_url:
            return_to = request.data.get("return_to") or request.query_params.get("return_to")
            callback_url = self._callback_url(request, payment.id, return_to)
            order_id = _payment_order_id(payment)
            description = f"{payment.payment_type} for case {payment.case.number}"
            metadata = {
                "payment_id": payment.id,
                "case_id": payment.case_id,
                "name": payment.person.full_name,
                "phone": payment.person.phone_number,
                "mail": payment.person.email,
            }
            try:
                result = request_payment(
                    amount=int(payment.amount),
                    description=description,
                    callback_url=callback_url,
                    order_id=order_id,
                    metadata=metadata,
                )
            except PaymentGatewayError as exc:
                return Response({"error": "Payment gateway error", "details": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            payment.gateway = _current_gateway()
            payment.authority = result.authority
            payment.gateway_url = result.payment_url
            payment.save(update_fields=["gateway", "authority", "gateway_url", "updated_at"])
        return Response(
            {
                "payment_id": payment.id,
                "authority": payment.authority,
                "payment_url": payment.gateway_url,
                "callback_url": self._callback_url(request, payment.id),
            }
        )

    def create(self, request, *args, **kwargs):
        user = request.user
        case_id = request.data.get("case")
        payment_type = request.data.get("payment_type", BailPayment.Type.BAIL)
        if not case_id:
            return Response({"error": "case is required."}, status=status.HTTP_400_BAD_REQUEST)
        case = get_object_or_404(Case, pk=case_id)
        person = Person.objects.filter(user=user).first()
        if not person and getattr(user, "national_id", None):
            person = Person.objects.filter(national_id=user.national_id).first()
        if not person:
            full_name = f"{user.first_name} {user.last_name}".strip() or user.username
            person = Person.objects.create(
                full_name=full_name,
                national_id=user.national_id,
                phone_number=user.phone_number,
                email=user.email,
                user=user,
            )
        existing = BailPayment.objects.filter(case=case, person=person, payment_type=payment_type).order_by("-created_at").first()
        if existing:
            if existing.status == BailPayment.Status.PAID:
                return Response({"error": "Payment already completed."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                self._assert_payment_allowed(
                    case=case,
                    person=person,
                    payment_type=payment_type,
                    amount=existing.amount,
                )
            except ValidationError as exc:
                return Response({"error": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
            payment = existing
        else:
            amount = case.bail_amount if payment_type == BailPayment.Type.BAIL else case.fine_amount
            serializer = self.get_serializer(
                data={
                    "case": case.id,
                    "person": person.id,
                    "payment_type": payment_type,
                    "amount": amount,
                    "reason": request.data.get("reason", ""),
                }
            )
            serializer.is_valid(raise_exception=True)
            payment = serializer.save(created_by=request.user)
        return_to = request.data.get("return_to")
        callback_url = self._callback_url(request, payment.id, return_to)
        order_id = _payment_order_id(payment)
        description = f"{payment.payment_type} for case {payment.case.number}"
        metadata = {
            "payment_id": payment.id,
            "case_id": payment.case_id,
            "name": payment.person.full_name,
            "phone": payment.person.phone_number,
            "mail": payment.person.email,
        }
        try:
            result = request_payment(
                amount=int(payment.amount),
                description=description,
                callback_url=callback_url,
                order_id=order_id,
                metadata=metadata,
            )
        except PaymentGatewayError as exc:
            if payment.status == BailPayment.Status.PENDING:
                payment.status = BailPayment.Status.FAILED
                payment.reference = payment.reference or (str(exc.code) if exc.code else "")
                payment.save(update_fields=["status", "reference", "updated_at"])
            return Response({"error": "Payment gateway error", "details": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        payment.gateway = _current_gateway()
        payment.authority = result.authority
        payment.gateway_url = result.payment_url
        payment.save(update_fields=["gateway", "authority", "gateway_url", "updated_at"])
        log_activity(self.request.user, "create_payment", "payment", payment.id, message=payment.payment_type)
        data = self.get_serializer(payment).data
        data["payment_url"] = payment.gateway_url
        data["callback_url"] = callback_url
        return Response(data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        payment = serializer.save()
        log_activity(self.request.user, "create_payment", "payment", payment.id, message=payment.payment_type)

    @action(detail=False, methods=["get"], url_path="eligible")
    def eligible(self, request):
        user = request.user
        person = Person.objects.filter(user=user).first()
        if not person and getattr(user, "national_id", None):
            person = Person.objects.filter(national_id=user.national_id).first()
        if not person:
            return Response([])
        evaluations = SuspectEvaluation.objects.filter(suspect=person).select_related("case")
        results = []
        seen = set()
        for ev in evaluations:
            case = ev.case
            key = (case.id, "bail")
            if (
                ev.sergeant_decision == "approve"
                and ev.judge_verdict == ""
                and case.severity in [Case.Severity.LEVEL_2, Case.Severity.LEVEL_3]
                and case.bail_amount is not None
                and key not in seen
            ):
                payment = BailPayment.objects.filter(
                    case=case, person=person, payment_type=BailPayment.Type.BAIL
                ).order_by("-created_at").first()
                results.append(
                    {
                        "case_id": case.id,
                        "case_number": case.number,
                        "case_title": case.title,
                        "severity": case.severity,
                        "payment_type": "bail",
                        "amount": case.bail_amount,
                        "payment_id": payment.id if payment else None,
                        "payment_status": payment.status if payment else None,
                    }
                )
                seen.add(key)
            key = (case.id, "fine")
            if (
                ev.judge_verdict == "guilty"
                and ev.sergeant_decision == "approve"
                and ev.captain_bail_decision == "approve"
                and case.severity == Case.Severity.LEVEL_3
                and case.status == Case.Status.CLOSED
                and case.fine_amount is not None
                and key not in seen
            ):
                payment = BailPayment.objects.filter(
                    case=case, person=person, payment_type=BailPayment.Type.FINE
                ).order_by("-created_at").first()
                results.append(
                    {
                        "case_id": case.id,
                        "case_number": case.number,
                        "case_title": case.title,
                        "severity": case.severity,
                        "payment_type": "fine",
                        "amount": case.fine_amount,
                        "payment_id": payment.id if payment else None,
                        "payment_status": payment.status if payment else None,
                    }
                )
                seen.add(key)
        return Response(results)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        bail = self.get_object()
        bail.status = BailPayment.Status.PAID
        bail.reference = request.data.get("reference", bail.reference)
        bail.paid_at = timezone.now()
        bail.save()
        log_activity(request.user, "mark_payment_paid", "payment", bail.id, message=bail.reference)
        return Response(BailPaymentSerializer(bail, context={"request": request}).data)


class SuspectEvaluationViewSet(viewsets.ModelViewSet):
    queryset = SuspectEvaluation.objects.select_related("case", "suspect").order_by("-created_at")
    serializer_class = SuspectEvaluationSerializer
    filterset_fields = ["status", "case"]

    def get_permissions(self):
        if self.action in ["create", "detective_score"]:
            return [IsDetective()]
        if self.action in ["remove"]:
            return [IsDetective()]
        if self.action in ["sergeant_score", "sergeant_decision"]:
            return [IsSergeantOrAbove()]
        if self.action in ["captain_bail_decision", "sergeant_bail_decision"]:
            return [IsSergeant()]
        if self.action in ["captain_decision", "chief_decision"]:
            return [IsCaptainOrChief()]
        if self.action in ["judge_decision"]:
            return [IsJudge()]
        return [permissions.IsAuthenticated()]

    @action(detail=False, methods=["get"], url_path="me")
    def me_status(self, request):
        user = request.user
        person = Person.objects.filter(user=user).first()
        if not person and getattr(user, "national_id", None):
            person = Person.objects.filter(national_id=user.national_id).first()
        if not person:
            return Response(
                {
                    "person_id": None,
                    "suspect": {
                        "active": False,
                        "count": 0,
                        "case_ids": [],
                        "cases": [],
                        "max_severity": None,
                        "level": None,
                    },
                    "criminal": {
                        "active": False,
                        "count": 0,
                        "case_ids": [],
                        "cases": [],
                        "max_severity": None,
                        "level": None,
                    },
                }
            )

        evaluations = SuspectEvaluation.objects.filter(suspect=person).select_related("case")
        severity_rank = {
            Case.Severity.LEVEL_3: 1,
            Case.Severity.LEVEL_2: 2,
            Case.Severity.LEVEL_1: 3,
            Case.Severity.CRITICAL: 4,
        }
        level_label = {
            Case.Severity.LEVEL_3: "3",
            Case.Severity.LEVEL_2: "2",
            Case.Severity.LEVEL_1: "1",
            Case.Severity.CRITICAL: "critical",
        }

        def build_status(items):
            if not items:
                return {
                    "active": False,
                    "count": 0,
                    "case_ids": [],
                    "cases": [],
                    "max_severity": None,
                    "level": None,
                }
            max_eval = max(items, key=lambda ev: severity_rank.get(ev.case.severity, 0))
            return {
                "active": True,
                "count": len(items),
                "case_ids": sorted({ev.case_id for ev in items}),
                "cases": [
                    {
                        "id": ev.case_id,
                        "title": ev.case.title,
                        "number": ev.case.number,
                        "severity": ev.case.severity,
                        "severity_label": ev.case.get_severity_display(),
                    }
                    for ev in sorted(items, key=lambda e: e.case_id)
                ],
                "max_severity": max_eval.case.severity,
                "max_severity_label": max_eval.case.get_severity_display(),
                "level": level_label.get(max_eval.case.severity),
            }

        # A person is suspect for a case until court verdict exists for that same case.
        suspect_items = [ev for ev in evaluations if ev.sergeant_decision == "approve" and not ev.judge_verdict]
        # Criminal is only after guilty verdict for that exact case.
        criminal_items = [ev for ev in evaluations if ev.judge_verdict == "guilty"]

        return Response(
            {
                "person_id": person.id,
                "suspect": build_status(suspect_items),
                "criminal": build_status(criminal_items),
            }
        )

    def create(self, request, *args, **kwargs):
        case_id = request.data.get("case")
        suspect_payload = request.data.get("suspect") or {}
        national_id = request.data.get("suspect_national_id") or suspect_payload.get("national_id")
        detected_at = request.data.get("detected_at")
        if not case_id or not national_id:
            return Response({"error": "case and suspect national_id are required."}, status=status.HTTP_400_BAD_REQUEST)
        if not detected_at:
            return Response({"error": "detected_at is required."}, status=status.HTTP_400_BAD_REQUEST)
        case = get_object_or_404(Case, pk=case_id)
        if case.status != Case.Status.DETECTIVE_PENDING:
            return Response({"error": "Suspects can only be added during detective pending review."}, status=status.HTTP_400_BAD_REQUEST)
        user_match = get_user_model().objects.filter(national_id=national_id).first()
        if not user_match:
            return Response({"error": "Suspect must be an existing user (match by national_id)."}, status=status.HTTP_400_BAD_REQUEST)
        defaults = {
            "full_name": f"{user_match.first_name} {user_match.last_name}".strip() or user_match.username,
            "phone_number": user_match.phone_number,
            "email": user_match.email,
            "user": user_match,
        }
        person, _ = Person.objects.get_or_create(national_id=national_id, defaults=defaults)
        if not person.user_id:
            person.user = user_match
            person.save(update_fields=["user"])
        evaluation, created = SuspectEvaluation.objects.get_or_create(
            case=case, suspect=person, defaults={"detected_at": detected_at}
        )
        if not created:
            update_fields = []
            if detected_at and str(evaluation.detected_at or "") != str(detected_at):
                evaluation.detected_at = detected_at
                update_fields.append("detected_at")
            # Re-submitting an existing suspect in detective_pending should start a fresh sergeant cycle.
            if (
                evaluation.status != SuspectEvaluation.Status.PENDING
                or evaluation.detective_score is not None
                or evaluation.sergeant_score is not None
                or evaluation.sergeant_decision
                or evaluation.captain_decision
                or evaluation.chief_decision
                or evaluation.judge_verdict
                or evaluation.sentence_title
                or evaluation.sentence_description
                or evaluation.judged_at is not None
                or evaluation.notes
            ):
                evaluation.status = SuspectEvaluation.Status.PENDING
                evaluation.detective_score = None
                evaluation.sergeant_score = None
                evaluation.sergeant_decision = ""
                evaluation.captain_decision = ""
                evaluation.captain_bail_decision = ""
                evaluation.captain_bail_note = ""
                evaluation.chief_decision = ""
                evaluation.judge_verdict = ""
                evaluation.sentence_title = ""
                evaluation.sentence_description = ""
                evaluation.judged_at = None
                evaluation.notes = ""
                update_fields.extend(
                    [
                        "status",
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
                        "notes",
                    ]
                )
            if update_fields:
                evaluation.save(update_fields=list(set(update_fields + ["updated_at"])))
        serializer = self.get_serializer(evaluation)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=["delete"], url_path="remove")
    def remove(self, request, pk=None):
        evaluation = self.get_object()
        if evaluation.case.status != Case.Status.DETECTIVE_PENDING:
            return Response({"error": "Suspects can only be removed during detective pending review."}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.delete()
        log_activity(request.user, "remove_suspect", "suspect_evaluation", pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="detective-score")
    def detective_score(self, request, pk=None):
        evaluation = self.get_object()
        score = int(request.data.get("score", 0))
        notes = request.data.get("notes", "")
        if evaluation.case.status != Case.Status.IN_PROGRESS:
            return Response({"error": "Scores can be submitted only after suspects are captured."}, status=status.HTTP_400_BAD_REQUEST)
        if score < 1 or score > 10:
            return Response({"error": "score must be 1-10"}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.detective_score = score
        evaluation.notes = notes
        evaluation.status = SuspectEvaluation.Status.SUBMITTED
        evaluation.save()
        case = evaluation.case
        all_done = not case.suspect_evaluations.filter(detective_score__isnull=True).exists() and not case.suspect_evaluations.filter(sergeant_score__isnull=True).exists()
        if all_done:
            case.status = Case.Status.CAPTAIN_REVIEW
            case.save(update_fields=["status", "updated_at"])
        log_activity(request.user, "detective_score", "suspect_evaluation", evaluation.id, message=notes)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="sergeant-score")
    def sergeant_score(self, request, pk=None):
        evaluation = self.get_object()
        score = int(request.data.get("score", 0))
        notes = request.data.get("notes", "")
        if evaluation.case.status != Case.Status.IN_PROGRESS:
            return Response({"error": "Scores can be submitted only after suspects are captured."}, status=status.HTTP_400_BAD_REQUEST)
        if score < 1 or score > 10:
            return Response({"error": "score must be 1-10"}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.sergeant_score = score
        evaluation.notes = notes
        evaluation.save()
        case = evaluation.case
        all_done = not case.suspect_evaluations.filter(detective_score__isnull=True).exists() and not case.suspect_evaluations.filter(sergeant_score__isnull=True).exists()
        if all_done:
            case.status = Case.Status.CAPTAIN_REVIEW
            case.save(update_fields=["status", "updated_at"])
        log_activity(request.user, "sergeant_score", "suspect_evaluation", evaluation.id, message=notes)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="sergeant-decision")
    def sergeant_decision(self, request, pk=None):
        evaluation = self.get_object()
        if evaluation.case.status != Case.Status.SERGEANT_PENDING:
            return Response({"error": "Case is not in sergeant review stage."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision", "")
        notes = request.data.get("notes", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.sergeant_decision = decision
        evaluation.notes = notes
        if decision == "reject":
            evaluation.status = SuspectEvaluation.Status.RETURNED
        else:
            evaluation.status = SuspectEvaluation.Status.REVIEWED
            pursuit_started_at = evaluation.detected_at or timezone.now().date()
            pursuit, created = PursuitStatus.objects.get_or_create(
                case=evaluation.case,
                suspect=evaluation.suspect,
                defaults={
                    "status": PursuitStatus.Status.WANTED,
                    "severity_at_report": evaluation.case.severity,
                    "pursuit_started_at": pursuit_started_at,
                },
            )
            if not created and pursuit.pursuit_started_at > pursuit_started_at:
                pursuit.pursuit_started_at = pursuit_started_at
                pursuit.save(update_fields=["pursuit_started_at", "updated_at"])
        evaluation.save()
        case = evaluation.case
        if not case.suspect_evaluations.filter(sergeant_decision="").exists():
            if case.suspect_evaluations.filter(sergeant_decision="approve").exists():
                case.status = Case.Status.DETECTIVE_FOLLOWUP
            else:
                case.status = Case.Status.DETECTIVE_PENDING
            case.approval_stage = Case.ApprovalStage.DETECTIVE
            case.save(update_fields=["status", "approval_stage", "updated_at"])
        log_activity(request.user, "sergeant_decision", "suspect_evaluation", evaluation.id, message=decision)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="captain-decision")
    def captain_decision(self, request, pk=None):
        evaluation = self.get_object()
        if evaluation.case.status != Case.Status.CAPTAIN_REVIEW:
            return Response({"error": "Case is not in captain review stage."}, status=status.HTTP_400_BAD_REQUEST)
        if evaluation.sergeant_decision != "approve":
            return Response({"error": "Sergeant approval is required before captain decision."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision", "")
        notes = request.data.get("notes", "")
        if decision not in ["guilty", "not_guilty"]:
            return Response({"error": "decision must be guilty|not_guilty"}, status=status.HTTP_400_BAD_REQUEST)
        if not str(notes).strip():
            return Response({"error": "notes are required for captain decision."}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.captain_decision = decision
        evaluation.notes = notes
        evaluation.status = SuspectEvaluation.Status.REVIEWED
        evaluation.save()
        case = evaluation.case
        if not case.suspect_evaluations.filter(captain_decision="").exists():
            if case.severity == Case.Severity.CRITICAL:
                case.status = Case.Status.CHIEF_REVIEW
            else:
                case.status = Case.Status.IN_TRIAL
            case.save(update_fields=["status", "updated_at"])
        log_activity(request.user, "captain_decision", "suspect_evaluation", evaluation.id, message=decision)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    def _handle_sergeant_bail_decision(self, request, pk=None):
        evaluation = self.get_object()
        if not user_has_any_role(request.user, ["Sergeant"]):
            return Response({"error": "Only sergeant can approve or reject this bail-payment request."}, status=status.HTTP_403_FORBIDDEN)
        if evaluation.case.severity != Case.Severity.LEVEL_3 or evaluation.judge_verdict != "guilty":
            return Response(
                {"error": "Sergeant bail-payment decision is only applicable to level 3 criminals."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if evaluation.captain_bail_decision:
            return Response({"error": "Sergeant bail-payment decision is already recorded."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision", "")
        note = request.data.get("note", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        if decision == "reject" and not str(note).strip():
            return Response({"error": "note is required for reject."}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.captain_bail_decision = decision
        evaluation.captain_bail_note = note
        evaluation.save(update_fields=["captain_bail_decision", "captain_bail_note", "updated_at"])
        log_activity(request.user, "sergeant_bail_decision", "suspect_evaluation", evaluation.id, message=decision)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="captain-bail-decision")
    def captain_bail_decision(self, request, pk=None):
        return self._handle_sergeant_bail_decision(request, pk)

    @action(detail=True, methods=["post"], url_path="sergeant-bail-decision")
    def sergeant_bail_decision(self, request, pk=None):
        return self._handle_sergeant_bail_decision(request, pk)

    @action(detail=True, methods=["post"], url_path="chief-decision")
    def chief_decision(self, request, pk=None):
        evaluation = self.get_object()
        if evaluation.case.severity != Case.Severity.CRITICAL:
            return Response({"error": "Chief decision allowed only for critical cases."}, status=status.HTTP_400_BAD_REQUEST)
        if not evaluation.captain_decision:
            return Response({"error": "Captain decision is required before chief decision."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision", "")
        notes = request.data.get("notes", "")
        if decision not in ["approve", "reject"]:
            return Response({"error": "decision must be approve|reject"}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.chief_decision = decision
        evaluation.notes = notes
        evaluation.status = SuspectEvaluation.Status.REVIEWED if decision == "approve" else SuspectEvaluation.Status.RETURNED
        evaluation.save()
        case = evaluation.case
        if decision == "approve":
            case.status = Case.Status.IN_TRIAL
        else:
            case.status = Case.Status.CAPTAIN_REVIEW
        case.save(update_fields=["status", "updated_at"])
        log_activity(request.user, "chief_decision", "suspect_evaluation", evaluation.id, message=decision)
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="judge-decision")
    def judge_decision(self, request, pk=None):
        evaluation = self.get_object()
        case = evaluation.case
        if case.status != Case.Status.IN_TRIAL:
            return Response({"error": "Case is not in trial stage."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision", "")
        sentence_title = request.data.get("sentence_title", "")
        sentence_description = request.data.get("sentence_description", "")
        if decision not in ["guilty", "not_guilty"]:
            return Response({"error": "decision must be guilty|not_guilty"}, status=status.HTTP_400_BAD_REQUEST)
        if not str(sentence_title).strip() or not str(sentence_description).strip():
            return Response({"error": "sentence_title and sentence_description are required."}, status=status.HTTP_400_BAD_REQUEST)
        evaluation.judge_verdict = decision
        # Bail approval for level-3 criminals is per-verdict and must be re-confirmed each judgment cycle.
        evaluation.captain_bail_decision = ""
        evaluation.captain_bail_note = ""
        evaluation.sentence_title = sentence_title
        evaluation.sentence_description = sentence_description
        evaluation.judged_at = timezone.now()
        evaluation.status = SuspectEvaluation.Status.REVIEWED
        evaluation.save()
        if not case.suspect_evaluations.filter(judge_verdict="").exists():
            case.status = Case.Status.CLOSED
            case.save(update_fields=["status", "updated_at"])
        log_activity(
            request.user,
            "judge_decision",
            "suspect_evaluation",
            evaluation.id,
            message=f"{decision}: {sentence_title}",
        )
        return Response(SuspectEvaluationSerializer(evaluation, context={"request": request}).data)


class TrialViewSet(viewsets.ModelViewSet):
    queryset = Trial.objects.select_related("case", "judge").order_by("-created_at")
    serializer_class = TrialSerializer

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsJudge()]
        return [permissions.IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        case = serializer.validated_data.get("case")
        if case.status != Case.Status.IN_TRIAL:
            return Response({"error": "Case must be in trial to create a verdict."}, status=status.HTTP_400_BAD_REQUEST)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        trial = serializer.save()
        case = trial.case
        case.status = Case.Status.CLOSED
        case.resolved_at = timezone.now()
        case.status_note = f"Verdict: {trial.verdict}"
        case.save(update_fields=["status", "resolved_at", "status_note", "updated_at"])
        log_activity(self.request.user, "create_trial", "case", case.id, message=trial.verdict)


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.select_related("actor").order_by("-created_at")
    serializer_class = ActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ["action", "target_type"]
    search_fields = ["message", "target_id", "action"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user_has_any_role(user, ["Administrator"]):
            return qs
        if user_has_any_role(user, ["Detective"]):
            return qs.filter(action__in=["create_evidence", "add_evidence_attachment"])
        return qs.none()

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        user = request.user
        if not (user.is_superuser or user_has_any_role(user, ["Administrator"])):
            return Response(
                {"error": "Only administrators can export system logs."},
                status=status.HTTP_403_FORBIDDEN,
            )
        logs = (
            ActivityLog.objects.select_related("actor")
            .order_by("-created_at")
        )
        lines = [
            "timestamp,actor,action,target_type,target_id,message",
        ]
        for entry in logs:
            actor = entry.actor.username if entry.actor_id else ""
            row = [
                (entry.created_at.isoformat() if entry.created_at else ""),
                actor,
                entry.action or "",
                entry.target_type or "",
                entry.target_id or "",
                (entry.message or "").replace("\n", " ").replace("\r", " "),
            ]
            escaped = ['"{}"'.format(str(part).replace('"', '""')) for part in row]
            lines.append(",".join(escaped))
        content = "\n".join(lines)
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
        response["Content-Disposition"] = f'attachment; filename="system-logs-{stamp}.csv"'
        return response


class MetricsViewSet(viewsets.ViewSet):
    permission_classes = [permissions.AllowAny]
    serializer_class = MetricsSummarySerializer

    @extend_schema(responses={200: MetricsSummarySerializer})
    def list(self, request):
        return self.summary(request)

    @action(detail=False, methods=["get"])
    @extend_schema(responses={200: MetricsSummarySerializer})
    def summary(self, request):
        total_cases = Case.objects.count()
        solved_cases = Case.objects.filter(status=Case.Status.CLOSED).count()
        active_cases = Case.objects.exclude(status__in=[Case.Status.CLOSED, Case.Status.REJECTED]).count()
        User = get_user_model()
        police_roles = [
            "Administrator",
            "Chief",
            "Captain",
            "Sergeant",
            "Detective",
            "Officer",
            "Patrol Officer",
            "Police Officer",
            "Cadet",
            "Judge",
            "Coroner",
        ]
        total_personnel = (
            User.objects.filter(Q(is_staff=True) | Q(groups__name__in=police_roles))
            .distinct()
            .count()
        )
        return Response(
            {
                "total_cases": total_cases,
                "solved_cases": solved_cases,
                "active_cases": active_cases,
                "total_personnel": total_personnel,
                "cases_by_severity": {
                    sev: Case.objects.filter(severity=sev).count() for sev, _ in Case.Severity.choices
                },
                "cases_by_status": {
                    st: Case.objects.filter(status=st).count() for st, _ in Case.Status.choices
                },
                "complaints_by_status": {
                    st: Complaint.objects.filter(status=st).count() for st, _ in Complaint.Status.choices
                },
                "tips_by_status": {st: Tip.objects.filter(status=st).count() for st, _ in Tip.Status.choices},
                "evidence_by_status": {
                    st: Evidence.objects.filter(status=st).count() for st, _ in Evidence.Status.choices
                },
                "pursuits_by_status": {
                    st: PursuitStatus.objects.filter(status=st).count() for st, _ in PursuitStatus.Status.choices
                },
            }
        )
