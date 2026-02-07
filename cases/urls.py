from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BailPaymentViewSet,
    BoardLinkViewSet,
    BoardNoteViewSet,
    CaseViewSet,
    ComplaintViewSet,
    FieldReportViewSet,
    DetectiveBoardViewSet,
    EvidenceViewSet,
    ActivityLogViewSet,
    MetricsViewSet,
    PursuitStatusViewSet,
    SuspectEvaluationViewSet,
    TipViewSet,
    TrialViewSet,
)

router = DefaultRouter()
router.register(r"complaints", ComplaintViewSet, basename="complaint")
router.register(r"cases", CaseViewSet, basename="case")
router.register(r"field-reports", FieldReportViewSet, basename="fieldreport")
router.register(r"evidences", EvidenceViewSet, basename="evidence")
router.register(r"boards", DetectiveBoardViewSet, basename="board")
router.register(r"board-notes", BoardNoteViewSet, basename="boardnote")
router.register(r"board-links", BoardLinkViewSet, basename="boardlink")
router.register(r"pursuits", PursuitStatusViewSet, basename="pursuit")
router.register(r"tips", TipViewSet, basename="tip")
router.register(r"bail-payments", BailPaymentViewSet, basename="bailpayment")
router.register(r"suspect-evaluations", SuspectEvaluationViewSet, basename="suspectevaluation")
router.register(r"trials", TrialViewSet, basename="trial")
router.register(r"activity-logs", ActivityLogViewSet, basename="activitylog")
router.register(r"metrics", MetricsViewSet, basename="metrics")

urlpatterns = [
    path("", include(router.urls)),
]
