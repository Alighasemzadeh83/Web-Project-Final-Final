from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction

from accounts.apps import DEFAULT_ROLES
from cases.models import (
    ActivityLog,
    BailPayment,
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
    SuspectEvaluation,
    Tip,
    Trial,
)

User = get_user_model()


def _get_or_create_user(username: str, *, role_names=None, password="changeme", **fields):
    role_names = role_names or []
    user, created = User.objects.get_or_create(username=username, defaults=fields)
    if created:
        user.set_password(password)
        user.save(update_fields=["password"])
    if role_names:
        roles = Group.objects.filter(name__in=role_names)
        if created or user.groups.count() == 0:
            user.groups.set(roles)
    return user, created


def seed_demo_data():
    if seed_exists():
        return {"already_seeded": True}

    stats = {
        "roles_created": 0,
        "users_created": 0,
    }

    for name in DEFAULT_ROLES:
        _, created = Group.objects.get_or_create(name=name)
        if created:
            stats["roles_created"] += 1

    base_users = [
        ("admin", ["Administrator"], True, True),
        ("chief", ["Chief"], True, False),
        ("captain", ["Captain"], True, False),
        ("sergeant", ["Sergeant"], False, False),
        ("detective", ["Detective"], False, False),
        ("officer", ["Officer"], False, False),
        ("patrol", ["Patrol Officer"], False, False),
        ("cadet", ["Cadet"], False, False),
        ("coroner", ["Coroner"], False, False),
        ("judge", ["Judge"], False, False),
        ("citizen", [], False, False),
        ("citizen2", [], False, False),
    ]

    for idx, (username, roles, is_staff, is_super) in enumerate(base_users, start=1):
        user, created = _get_or_create_user(
            username,
            role_names=roles,
            is_staff=is_staff,
            is_superuser=is_super,
            email=f"{username}@example.com",
            first_name=username.title(),
            last_name="Seed",
            national_id=f"99000000{idx:02d}",
            phone_number=f"+9891200000{idx:02d}",
        )
        if created:
            stats["users_created"] += 1
    return stats


def seed_exists() -> bool:
    return User.objects.filter(username__in=["cadet", "officer", "detective", "citizen"]).exists()


def reset_demo_data():
    """
    Reset application data while preserving superusers.
    Intended for local/dev usage only.
    """
    with transaction.atomic():
        ActivityLog.objects.all().delete()
        BoardLink.objects.all().delete()
        BoardNote.objects.all().delete()
        DetectiveBoard.objects.all().delete()
        EvidenceAttachment.objects.all().delete()
        Evidence.objects.all().delete()
        CaseParticipant.objects.all().delete()
        ComplaintComplainant.objects.all().delete()
        Tip.objects.all().delete()
        PursuitStatus.objects.all().delete()
        SuspectEvaluation.objects.all().delete()
        Trial.objects.all().delete()
        BailPayment.objects.all().delete()
        Case.objects.all().delete()
        Complaint.objects.all().delete()
        Person.objects.exclude(user__is_superuser=True).delete()
        User.objects.filter(is_superuser=False).delete()
        Group.objects.all().delete()
    return {"reset": True}
