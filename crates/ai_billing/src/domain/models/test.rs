use super::*;

const CHARGE_STATUSES: [OverageChargeStatus; 6] = [
    OverageChargeStatus::Pending,
    OverageChargeStatus::RequiresAction,
    OverageChargeStatus::Paid,
    OverageChargeStatus::Failed,
    OverageChargeStatus::Voided,
    OverageChargeStatus::Uncollectible,
];

const RELOAD_STATUSES: [CreditReloadStatus; 6] = [
    CreditReloadStatus::Pending,
    CreditReloadStatus::RequiresAction,
    CreditReloadStatus::Paid,
    CreditReloadStatus::Failed,
    CreditReloadStatus::Voided,
    CreditReloadStatus::Uncollectible,
];

#[test]
fn paid_and_voided_are_final_and_a_write_off_only_moves_to_them() {
    for from in CHARGE_STATUSES {
        for to in CHARGE_STATUSES {
            let expected = from != to
                && match from {
                    OverageChargeStatus::Paid | OverageChargeStatus::Voided => false,
                    OverageChargeStatus::Uncollectible => {
                        matches!(to, OverageChargeStatus::Paid | OverageChargeStatus::Voided)
                    }
                    _ => true,
                };
            assert_eq!(from.accepts(to), expected, "{from} -> {to}");
        }
    }
    for from in RELOAD_STATUSES {
        for to in RELOAD_STATUSES {
            let expected = from != to
                && match from {
                    CreditReloadStatus::Paid | CreditReloadStatus::Voided => false,
                    CreditReloadStatus::Uncollectible => {
                        matches!(to, CreditReloadStatus::Paid | CreditReloadStatus::Voided)
                    }
                    _ => true,
                };
            assert_eq!(from.accepts(to), expected, "{from} -> {to}");
        }
    }
}

#[test]
fn only_invoices_stripe_may_still_collect_cover_block_and_count() {
    for has_invoice in [false, true] {
        assert!(OverageChargeStatus::Pending.may_collect(has_invoice));
        assert!(OverageChargeStatus::RequiresAction.may_collect(has_invoice));
        assert!(OverageChargeStatus::Paid.may_collect(has_invoice));
        assert_eq!(
            OverageChargeStatus::Failed.may_collect(has_invoice),
            has_invoice
        );
        assert!(!OverageChargeStatus::Voided.may_collect(has_invoice));
        assert!(!OverageChargeStatus::Uncollectible.may_collect(has_invoice));

        assert!(CreditReloadStatus::Pending.may_collect(has_invoice));
        assert!(CreditReloadStatus::RequiresAction.may_collect(has_invoice));
        assert!(CreditReloadStatus::Paid.may_collect(has_invoice));
        assert_eq!(
            CreditReloadStatus::Failed.may_collect(has_invoice),
            has_invoice
        );
        assert!(!CreditReloadStatus::Voided.may_collect(has_invoice));
        assert!(!CreditReloadStatus::Uncollectible.may_collect(has_invoice));
    }
}

#[test]
fn every_outcome_but_paid_and_pending_pauses_the_feature() {
    for status in CHARGE_STATUSES {
        assert_eq!(
            status.suspends(),
            !matches!(
                status,
                OverageChargeStatus::Pending | OverageChargeStatus::Paid
            ),
            "{status}"
        );
    }
    for status in RELOAD_STATUSES {
        assert_eq!(
            status.suspends(),
            !matches!(
                status,
                CreditReloadStatus::Pending | CreditReloadStatus::Paid
            ),
            "{status}"
        );
    }
}

#[test]
fn provider_outcomes_map_onto_both_status_vocabularies() {
    let url = Some("https://invoice.stripe.test/i/in_1".to_string());
    let cases = [
        (
            InvoiceOutcome::Paid,
            OverageChargeStatus::Paid,
            CreditReloadStatus::Paid,
        ),
        (
            InvoiceOutcome::PaymentFailed,
            OverageChargeStatus::Failed,
            CreditReloadStatus::Failed,
        ),
        (
            InvoiceOutcome::ActionRequired {
                hosted_invoice_url: url.clone(),
            },
            OverageChargeStatus::RequiresAction,
            CreditReloadStatus::RequiresAction,
        ),
        (
            InvoiceOutcome::Voided,
            OverageChargeStatus::Voided,
            CreditReloadStatus::Voided,
        ),
        (
            InvoiceOutcome::Uncollectible,
            OverageChargeStatus::Uncollectible,
            CreditReloadStatus::Uncollectible,
        ),
    ];
    for (outcome, charge, reload) in cases {
        assert_eq!(outcome.charge_status(), charge, "{outcome:?}");
        assert_eq!(outcome.reload_status(), reload, "{outcome:?}");
        assert_eq!(
            outcome.hosted_invoice_url(),
            matches!(outcome, InvoiceOutcome::ActionRequired { .. })
                .then_some(url.as_deref())
                .flatten(),
            "{outcome:?}"
        );
    }
}

#[test]
fn statuses_round_trip_through_their_snake_case_names() {
    for status in CHARGE_STATUSES {
        assert_eq!(
            status.to_string().parse::<OverageChargeStatus>(),
            Ok(status)
        );
    }
    for status in RELOAD_STATUSES {
        assert_eq!(status.to_string().parse::<CreditReloadStatus>(), Ok(status));
    }
    assert_eq!(
        OverageChargeStatus::RequiresAction.to_string(),
        "requires_action"
    );
    assert_eq!(
        CreditReloadStatus::Uncollectible.to_string(),
        "uncollectible"
    );
}
