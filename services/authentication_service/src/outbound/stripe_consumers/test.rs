use serde_json::json;

use super::*;

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

#[test]
fn idempotency_keys_name_the_consumer_event_and_action() {
    let event_id: EventId = "evt_1Trial".parse().unwrap();

    assert_eq!(
        idempotency_key(Consumer::PersonalPlan, &event_id, "has_trialed"),
        "personal_plan:evt_1Trial:has_trialed"
    );
}
