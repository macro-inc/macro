use roles_and_permissions::domain::model::SubscriptionStatus;
use stripe_webhook::EventType;

use serde_json::json;

use super::{
    PaymentEventOutcome, PostHogSubscriptionEvent, PostHogTeamGroup, SubscriptionEvent,
    is_active_subscription_except_current,
};

#[test]
fn invoice_payment_failed_maps_to_revoke_outcome() {
    let outcome = PaymentEventOutcome::from_event_type(&EventType::InvoicePaymentFailed)
        .expect("invoice payment failure should map to an outcome");

    assert_eq!(outcome, PaymentEventOutcome::RevokePremiumAccess);
    assert_eq!(
        outcome.personal_subscription_status(),
        SubscriptionStatus::PastDue
    );
    assert_eq!(outcome.team_subscription_status(), "past_due");
    assert!(outcome.is_revoke());
}

#[test]
fn invoice_payment_success_events_map_to_restore_outcome() {
    let success_event_types = [EventType::InvoicePaymentSucceeded, EventType::InvoicePaid];

    for event_type in success_event_types {
        let outcome = PaymentEventOutcome::from_event_type(&event_type)
            .expect("invoice payment success should map to an outcome");

        assert_eq!(outcome, PaymentEventOutcome::RestorePremiumAccess);
        assert_eq!(
            outcome.personal_subscription_status(),
            SubscriptionStatus::Active
        );
        assert_eq!(outcome.team_subscription_status(), "active");
        assert!(!outcome.is_revoke());
    }
}

#[test]
fn non_invoice_payment_events_do_not_map_to_payment_outcomes() {
    let non_payment_event_types = [
        EventType::CustomerSubscriptionCreated,
        EventType::CustomerSubscriptionUpdated,
        EventType::CustomerSubscriptionDeleted,
        EventType::CustomerSubscriptionPaused,
    ];

    for event_type in non_payment_event_types {
        assert_eq!(PaymentEventOutcome::from_event_type(&event_type), None);
    }
}

#[test]
fn invoice_payment_active_subscription_check_excludes_current_subscription() {
    let current_subscription_id = "sub_failed";

    assert!(!is_active_subscription_except_current(
        current_subscription_id,
        &stripe::SubscriptionStatus::Active,
        current_subscription_id,
    ));
    assert!(is_active_subscription_except_current(
        "sub_active",
        &stripe::SubscriptionStatus::Active,
        current_subscription_id,
    ));
    assert!(is_active_subscription_except_current(
        "sub_trialing",
        &stripe::SubscriptionStatus::Trialing,
        current_subscription_id,
    ));
    assert!(!is_active_subscription_except_current(
        "sub_past_due",
        &stripe::SubscriptionStatus::PastDue,
        current_subscription_id,
    ));
}

#[test]
fn posthog_team_subscription_event_carries_team_id_and_group() {
    let team_id = uuid::Uuid::from_u128(1);
    let event = SubscriptionEvent {
        transaction_id: "sub_123".to_string(),
        value: 20.0,
        currency: "USD".to_string(),
    };

    let properties = serde_json::to_value(PostHogSubscriptionEvent {
        event: &event,
        team_id: Some(team_id),
        groups: Some(PostHogTeamGroup { team: team_id }),
    })
    .unwrap();

    assert_eq!(
        properties,
        json!({
            "transaction_id": "sub_123",
            "value": 20.0,
            "currency": "USD",
            "team_id": "00000000-0000-0000-0000-000000000001",
            "$groups": { "team": "00000000-0000-0000-0000-000000000001" },
        })
    );
}

#[test]
fn posthog_personal_subscription_event_has_no_team() {
    let event = SubscriptionEvent {
        transaction_id: "sub_123".to_string(),
        value: 20.0,
        currency: "USD".to_string(),
    };

    let properties = serde_json::to_value(PostHogSubscriptionEvent {
        event: &event,
        team_id: None,
        groups: None,
    })
    .unwrap();

    assert_eq!(
        properties,
        json!({
            "transaction_id": "sub_123",
            "value": 20.0,
            "currency": "USD",
        })
    );
}
