from django.contrib import admin

from .models import (
    BailPayment,
    SuspectEvaluation,
    Trial,
    ActivityLog,
    BoardLink,
    BoardNote,
    Case,
    CaseParticipant,
    Complaint,
    ComplaintComplainant,
    DetectiveBoard,
    Evidence,
    EvidenceAttachment,
    Person,
    PursuitStatus,
    Tip,
)


admin.site.register(Person)
admin.site.register(Complaint)
admin.site.register(ComplaintComplainant)
admin.site.register(Case)
admin.site.register(CaseParticipant)
admin.site.register(Evidence)
admin.site.register(EvidenceAttachment)
admin.site.register(DetectiveBoard)
admin.site.register(BoardNote)
admin.site.register(BoardLink)
admin.site.register(PursuitStatus)
admin.site.register(Tip)
admin.site.register(BailPayment)
admin.site.register(SuspectEvaluation)
admin.site.register(Trial)
admin.site.register(ActivityLog)
