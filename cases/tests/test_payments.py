from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cases.models import Case, Person, SuspectEvaluation
from cases.utils import generate_case_number

User = get_user_model()


class PaymentTests(APITestCase):
    def setUp(self):
        self.sergeant_group, _ = Group.objects.get_or_create(name="Sergeant")
        self.sergeant = User.objects.create_user(
            username="sergeant2",
            email="sergeant2@example.com",
            password="Sergeant12345",
            national_id="1313131313",
            phone_number="09120002222",
        )
        self.sergeant.groups.add(self.sergeant_group)
        self.client.force_authenticate(self.sergeant)

    def test_bail_not_allowed_for_critical_case(self):
        case = Case.objects.create(
            number=generate_case_number(),
            title="Critical Case",
            description="desc",
            source=Case.Source.FIELD_REPORT,
            severity=Case.Severity.CRITICAL,
            status=Case.Status.ACTIVE,
        )
        person = Person.objects.create(full_name="Suspect B", national_id="1414141414")
        resp = self.client.post(
            reverse("bailpayment-list"),
            {
                "case": case.id,
                "person": person.id,
                "amount": 1000000,
                "payment_type": "bail",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_level3_criminal_bail_is_not_allowed(self):
        criminal_user = User.objects.create_user(
            username="criminal_user_l3",
            email="criminal_user_l3@example.com",
            password="Criminal12345",
            national_id="8818181818",
            phone_number="09128888888",
        )
        criminal_person = Person.objects.create(
            full_name="Criminal L3",
            national_id=criminal_user.national_id,
            user=criminal_user,
        )
        case = Case.objects.create(
            number=generate_case_number(),
            title="Level 3 Criminal Bail Case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.CLOSED,
            bail_amount=2_000_000,
        )
        SuspectEvaluation.objects.create(
            case=case,
            suspect=criminal_person,
            sergeant_decision="approve",
            judge_verdict="guilty",
            captain_bail_decision="approve",
        )

        self.client.force_authenticate(criminal_user)
        eligible = self.client.get(reverse("bailpayment-eligible"))
        self.assertEqual(eligible.status_code, status.HTTP_200_OK)
        self.assertEqual(len(eligible.data), 0)

        create = self.client.post(
            reverse("bailpayment-list"),
            {
                "case": case.id,
                "payment_type": "bail",
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_400_BAD_REQUEST)

    def test_level3_criminal_fine_requires_sergeant_bail_decision_approve(self):
        criminal_user = User.objects.create_user(
            username="criminal_user_reject",
            email="criminal_user_reject@example.com",
            password="Criminal12345",
            national_id="6616161616",
            phone_number="09126661111",
        )
        criminal_person = Person.objects.create(
            full_name="Criminal Reject",
            national_id=criminal_user.national_id,
            user=criminal_user,
        )
        case = Case.objects.create(
            number=generate_case_number(),
            title="Rejected Bail Case",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.CLOSED,
            fine_amount=3_000_000,
        )
        evaluation = SuspectEvaluation.objects.create(
            case=case,
            suspect=criminal_person,
            sergeant_decision="approve",
            judge_verdict="guilty",
        )

        # no sergeant decision yet -> fine blocked
        set_fine_before = self.client.post(
            reverse("case-set-fine", args=[case.id]),
            {"amount": 4_000_000},
            format="json",
        )
        self.assertEqual(set_fine_before.status_code, status.HTTP_400_BAD_REQUEST)

        # reject -> still blocked
        sergeant_reject = self.client.post(
            reverse("suspectevaluation-sergeant-bail-decision", args=[evaluation.id]),
            {"decision": "reject", "note": "Rejected by sergeant"},
            format="json",
        )
        self.assertEqual(sergeant_reject.status_code, status.HTTP_200_OK)
        set_fine_after_reject = self.client.post(
            reverse("case-set-fine", args=[case.id]),
            {"amount": 4_000_000},
            format="json",
        )
        self.assertEqual(set_fine_after_reject.status_code, status.HTTP_400_BAD_REQUEST)

        # new case + approve -> allowed
        case2 = Case.objects.create(
            number=generate_case_number(),
            title="Approved Bail Decision For Fine",
            description="desc",
            source=Case.Source.COMPLAINT,
            severity=Case.Severity.LEVEL_3,
            status=Case.Status.CLOSED,
            fine_amount=5_000_000,
        )
        evaluation2 = SuspectEvaluation.objects.create(
            case=case2,
            suspect=criminal_person,
            sergeant_decision="approve",
            judge_verdict="guilty",
        )
        sergeant_approve = self.client.post(
            reverse("suspectevaluation-sergeant-bail-decision", args=[evaluation2.id]),
            {"decision": "approve", "note": "Approved by sergeant"},
            format="json",
        )
        self.assertEqual(sergeant_approve.status_code, status.HTTP_200_OK)
        set_fine_after_approve = self.client.post(
            reverse("case-set-fine", args=[case2.id]),
            {"amount": 6_000_000},
            format="json",
        )
        self.assertEqual(set_fine_after_approve.status_code, status.HTTP_200_OK)
