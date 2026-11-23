use super::*;
use crate::domain::models::WebhookEventQueueMessage;

fn key(user: &str, url: &str, arguments: serde_json::Value) -> McpSubscriptionKey {
    McpSubscriptionKey {
        user_id: MacroUserIdStr::try_from(user.to_owned()).expect("valid user id"),
        endpoint_url: url.to_owned(),
        event_type: "macro.events".to_owned(),
        arguments,
    }
}

#[test]
fn id_is_stable_over_canonical_arguments() {
    let first = key(
        "macro|me@example.com",
        "https://hooks.example.com/a",
        serde_json::json!({ "query": "mentions", "nested": { "b": 1, "a": [2, { "y": 1, "x": 0 }] } }),
    );
    let reordered = key(
        "macro|me@example.com",
        "https://hooks.example.com/a",
        serde_json::json!({ "nested": { "a": [2, { "x": 0, "y": 1 }], "b": 1 }, "query": "mentions" }),
    );
    let id = first.id();
    assert_eq!(id, reordered.id());
    assert!(id.as_str().starts_with("sub_"));
    assert_eq!(id.as_str().len(), "sub_".len() + 32);
}

#[test]
fn every_key_part_changes_the_id() {
    let base = key(
        "macro|me@example.com",
        "https://hooks.example.com/a",
        serde_json::json!({ "query": "mentions" }),
    );
    let other_user = key(
        "macro|other@example.com",
        "https://hooks.example.com/a",
        serde_json::json!({ "query": "mentions" }),
    );
    let other_url = key(
        "macro|me@example.com",
        "https://hooks.example.com/b",
        serde_json::json!({ "query": "mentions" }),
    );
    let other_arguments = key(
        "macro|me@example.com",
        "https://hooks.example.com/a",
        serde_json::json!({ "query": "messages" }),
    );
    let mut other_name = base.clone();
    other_name.event_type = "message.mentioned".to_owned();
    let ids = [
        base.id(),
        other_user.id(),
        other_url.id(),
        other_arguments.id(),
        other_name.id(),
    ];
    for (index, id) in ids.iter().enumerate() {
        assert!(
            ids.iter().skip(index + 1).all(|other| other != id),
            "{id} repeats"
        );
    }
}

#[test]
fn grants_clamp_to_the_policy() {
    let now = Utc::now();
    assert_eq!(McpTtlRequest::Default.grant(now), now + DEFAULT_TTL);
    assert_eq!(McpTtlRequest::NoExpiry.grant(now), now + DEFAULT_TTL);
    assert_eq!(
        McpTtlRequest::Millis { value: 5 * 60_000 }.grant(now),
        now + Duration::minutes(5)
    );
    assert_eq!(McpTtlRequest::Millis { value: 1 }.grant(now), now + MIN_TTL);
    assert_eq!(
        McpTtlRequest::Millis { value: u64::MAX }.grant(now),
        now + MAX_TTL
    );
    assert_eq!(
        McpTtlRequest::Millis {
            value: 7 * 24 * 3_600_000
        }
        .grant(now),
        now + MAX_TTL
    );
}

fn event() -> NormalizedWebhookEvent {
    NormalizedWebhookEvent {
        event_id: "0193b2c4-0000-7000-8000-000000000009".to_owned(),
        schema_version: 1,
        event_name: "message.mentioned".to_owned(),
        entity_type: "channel".to_owned(),
        entity_id: "c".to_owned(),
        ordering_key: "c".to_owned(),
        occurred_at: Utc::now(),
        broker_envelope: serde_json::json!({ "event_type": "message.mentioned" }),
    }
}

#[test]
fn queue_messages_parse_as_one_kind_only() {
    let mcp = McpEventQueueMessage::new(Uuid::now_v7(), event());
    let body = serde_json::to_string(&mcp).expect("serializable");
    assert!(serde_json::from_str::<WebhookEventQueueMessage>(&body).is_err());
    assert_eq!(
        serde_json::from_str::<McpEventQueueMessage>(&body).expect("parses"),
        mcp
    );

    let webhook = WebhookEventQueueMessage::new("wh_1".to_owned(), event());
    let body = serde_json::to_string(&webhook).expect("serializable");
    assert!(serde_json::from_str::<McpEventQueueMessage>(&body).is_err());
}

#[test]
fn message_ids_are_fresh_per_message() {
    let first = McpEventQueueMessage::new(Uuid::now_v7(), event());
    let second = McpEventQueueMessage::new(first.mcp_subscription_id, event());
    assert!(first.webhook_message_id.starts_with("msg_"));
    assert_ne!(first.webhook_message_id, second.webhook_message_id);
    assert_ne!(first.webhook_message_id, first.event.event_id);
}

#[test]
fn occurrence_carries_the_envelope_and_a_null_cursor() {
    let event = event();
    let occurrence = McpEventOccurrence::new(
        "macro.events",
        &event,
        McpDeliveryProfile::Mcp,
        "msg_1",
        &subscriber(),
    );
    let json = serde_json::to_value(&occurrence).expect("serializable");
    assert_eq!(json["eventId"], event.event_id.as_str());
    assert_eq!(json["name"], "macro.events");
    assert_eq!(json["data"], event.broker_envelope);
    assert_eq!(json.get("cursor"), Some(&serde_json::Value::Null));
}

#[test]
fn verification_envelope_wire_shape() {
    let envelope = McpControlEnvelope::Verification {
        challenge: "nonce".to_owned(),
    };
    assert_eq!(
        serde_json::to_value(envelope).expect("serializable"),
        serde_json::json!({ "type": "verification", "challenge": "nonce" })
    );
}

#[test]
fn ciphertext_travels_as_base64() {
    let ciphertext = McpSecretCiphertext {
        ciphertext: vec![0, 1, 2, 255],
        kms_key_id: "alias/key".to_owned(),
        encryption_version: 1,
    };
    let json = serde_json::to_value(&ciphertext).expect("serializable");
    assert_eq!(json["ciphertext"], "AAEC/w==");
    assert_eq!(
        serde_json::from_value::<McpSecretCiphertext>(json).expect("round trip"),
        ciphertext
    );
}

fn subscriber() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|Me@Example.com".to_owned()).expect("valid user id")
}

#[test]
fn chatgpt_occurrence_carries_the_delivery_id_and_no_people() {
    let mut event = event();
    event.broker_envelope = serde_json::json!({
        "event_id": event.event_id,
        "event_type": "message.mentioned",
        "metadata": {
            "sender": "macro|other@example.com",
            "mentioned": { "entity_type": "user", "entity_id": "macro|me@example.com" },
            "content": "ping other@example.org and ME@example.com",
            "count": 2,
            "macro|other@example.com": true
        }
    });
    let occurrence = McpEventOccurrence::new(
        "message.mentioned",
        &event,
        McpDeliveryProfile::Chatgpt,
        "msg_1",
        &subscriber(),
    );
    let json = serde_json::to_value(&occurrence).expect("serializable");
    assert_eq!(
        json["eventId"], "msg_1",
        "ChatGPT's webhook-id is the eventId"
    );
    assert_eq!(json["data"]["event_id"], event.event_id.as_str());
    assert_eq!(
        json["data"]["metadata"],
        serde_json::json!({
            "sender": "someone",
            "mentioned": { "entity_type": "user", "entity_id": "me" },
            "content": "ping someone and me",
            "count": 2,
            "macro|other@example.com": true
        }),
        "values lose people, keys are kept"
    );
}

#[test]
fn the_default_profile_is_left_out_of_the_subscribe_body() {
    assert!(McpDeliveryProfile::Mcp.is_default());
    assert_eq!(
        "chatgpt".parse::<McpDeliveryProfile>().expect("parses"),
        McpDeliveryProfile::Chatgpt
    );
    assert_eq!(McpDeliveryProfile::Chatgpt.as_ref(), "chatgpt");
}

#[test]
fn a_previous_secret_signs_until_its_window_closes() {
    let now = Utc::now();
    let ciphertext = McpSecretCiphertext {
        ciphertext: vec![1],
        kms_key_id: "alias/key".to_owned(),
        encryption_version: 1,
    };
    let row = McpEventSubscription {
        id: Uuid::now_v7(),
        user_id: subscriber(),
        subscription_id: McpSubscriptionId::from_stored("sub_1".to_owned()),
        event_type: "macro.events".to_owned(),
        arguments: serde_json::json!({}),
        filter: crate::domain::mcp::filter::McpEventFilter::for_events(
            vec!["message.mentioned".to_owned()],
            None,
        ),
        endpoint_url: "https://hooks.example.com/a".to_owned(),
        secret: ciphertext.clone(),
        previous_secret: Some(McpPreviousSecret {
            secret: ciphertext.clone(),
            expires_at: now + Duration::minutes(1),
        }),
        profile: McpDeliveryProfile::Mcp,
        expires_at: now + Duration::hours(1),
    };
    assert_eq!(row.signing_previous_secret(now), Some(&ciphertext));
    assert_eq!(
        row.signing_previous_secret(now + Duration::minutes(2)),
        None
    );
}
