use super::*;
use serde_json::{Value, json};

const ENTITY_ID: &str = "01900000-0000-7000-8000-000000000001";
const OTHER_ID: &str = "01900000-0000-7000-8000-000000000002";
const EVENT_ID: &str = "01900000-0000-7000-8000-000000000003";
const HUMAN: &str = "macro|human@example.com";
const BOT: &str = "bot|01900000-0000-7000-8000-000000000004";

fn metadata() -> Value {
    json!({
        "document_id": ENTITY_ID, "owner": HUMAN, "actor": HUMAN,
        "actor_user_id": HUMAN, "document_name": "Example", "file_type": "md",
        "share_permission_updated": false, "source_document_id": OTHER_ID,
        "reason": "edited", "channel_id": ENTITY_ID, "message_id": OTHER_ID,
        "sender": HUMAN, "channel_type": "public", "participant_user_ids": [HUMAN],
        "content": "Untrusted content must not survive normalization",
        "mentions": [], "attachments": [],
        "mentioned": {"entity_type": "user", "entity_id": HUMAN},
        "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
        "added_by": HUMAN, "added_user_ids": [HUMAN],
        "removed_by": HUMAN, "removed_user_ids": [HUMAN]
    })
}

fn incoming(name: &str, mut metadata: Value) -> IncomingEvent {
    // Updates encode a FileTypeUpdate, unlike the other document events.
    if name == "document.updated" {
        metadata["file_type"] = Value::Null;
    }
    let value = json!({"event_type": name, "metadata": metadata});
    let payload = if name.starts_with("document.") {
        EventPayload::Document(serde_json::from_value(value).unwrap())
    } else {
        EventPayload::Channel(serde_json::from_value(value).unwrap())
    };
    IncomingEvent {
        event_id: Uuid::parse_str(EVENT_ID).unwrap(),
        schema_version: 1,
        payload,
    }
}

fn filters(value: Value) -> EventFilters {
    serde_json::from_value(value).unwrap()
}

#[test]
fn all_allowlisted_human_events_normalize_to_minimal_context() {
    for name in [
        "document.created",
        "document.updated",
        "channel.created",
        "channel.message_posted",
        "channel.mentioned",
        "channel.message_patched",
        "channel.message_attachment_created",
    ] {
        let event = incoming(name, metadata()).normalize().unwrap();
        assert_eq!(event.event_name().as_str(), name);
        assert_eq!(event.entity_id().to_string(), ENTITY_ID);
        assert_eq!(
            event.message_id().is_some(),
            name.starts_with("channel.") && name != "channel.created"
        );
        let encoded = serde_json::to_value(&event).unwrap();
        assert!(encoded.get("content").is_none());
        assert!(encoded.get("actor").is_none());
        assert_eq!(
            serde_json::from_value::<EventReference>(encoded).unwrap(),
            event
        );
    }
}

#[test]
fn explicit_bots_never_fall_back_to_human_owner_actor_or_subject() {
    for (name, field) in [
        ("document.created", "actor"),
        ("document.updated", "actor"),
        ("channel.created", "actor"),
        ("channel.message_posted", "sender"),
        ("channel.mentioned", "sender"),
        ("channel.message_patched", "actor"),
        ("channel.message_attachment_created", "actor"),
    ] {
        for delegated in [false, true] {
            let mut data = metadata();
            data[field] = json!(BOT);
            if delegated {
                data["on_behalf_of"] = json!(HUMAN);
            }
            assert_eq!(
                incoming(name, data).normalize(),
                Err(EventRejection::UnsafeAttribution)
            );
        }
    }
}

#[test]
fn missing_creation_attribution_and_delegation_are_not_human_authorship() {
    let mut data = metadata();
    data.as_object_mut().unwrap().remove("actor");
    assert_eq!(
        incoming("document.created", data.clone()).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
    assert!(
        incoming("document.updated", data.clone())
            .normalize()
            .is_ok()
    );
    data["on_behalf_of"] = json!(HUMAN);
    assert_eq!(
        incoming("document.updated", data).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
    for name in ["document.created", "document.updated", "channel.created"] {
        let mut data = metadata();
        data["on_behalf_of"] = json!(HUMAN);
        assert_eq!(
            incoming(name, data).normalize(),
            Err(EventRejection::UnsafeAttribution)
        );
    }
    let mut data = metadata();
    data["triggered_by"] = json!(HUMAN);
    assert_eq!(
        incoming("channel.message_posted", data).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
}

#[test]
fn update_prefers_explicit_actor_and_requires_a_fallback_when_absent() {
    let mut data = metadata();
    data["actor_user_id"] = Value::Null;
    assert!(
        incoming("document.updated", data.clone())
            .normalize()
            .is_ok()
    );
    data["actor"] = Value::Null;
    assert_eq!(
        incoming("document.updated", data).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
    let mut data = metadata();
    data["actor_user_id"] = json!("macro|other@example.com");
    assert!(incoming("document.updated", data).normalize().is_ok());
}

#[test]
fn every_non_allowlisted_variant_is_rejected() {
    for name in [
        "document.deleted",
        "document.content_uploaded",
        "document.sync_content_updated",
        "document.purged",
        "document.copied",
        "document.interaction",
        "channel.updated",
        "channel.deleted",
        "channel.message_deleted",
        "channel.message_attachment_removed",
        "channel.participant_added",
        "channel.participant_removed",
    ] {
        assert_eq!(
            incoming(name, metadata()).normalize(),
            Err(EventRejection::UnsupportedEvent)
        );
        assert!(serde_json::from_value::<EventName>(json!(name)).is_err());
    }
    assert!(serde_json::from_value::<EventName>(json!("document.future_event")).is_err());
    assert!(serde_json::from_value::<EventName>(json!("document.*")).is_err());
}

#[test]
fn validates_schema_identity_and_document_uuid() {
    let mut event = incoming("document.updated", metadata());
    for version in [0, 2, 255] {
        event.schema_version = version;
        assert_eq!(event.normalize(), Err(EventRejection::UnsupportedSchema));
    }
    event.schema_version = 1;
    for id in [
        "00000000-0000-0000-0000-000000000000",
        "01900000-0000-4000-8000-000000000003",
        "01900000-0000-7000-0000-000000000003",
    ] {
        event.event_id = Uuid::parse_str(id).unwrap();
        assert_eq!(event.normalize(), Err(EventRejection::InvalidIdentity));
    }
    let mut data = metadata();
    data["document_id"] = json!("not-a-uuid");
    assert_eq!(
        incoming("document.created", data).normalize(),
        Err(EventRejection::InvalidEntityId)
    );
}

#[test]
fn matching_is_same_filter_and_empty_ids_match_nothing() {
    let event = incoming("document.created", metadata())
        .normalize()
        .unwrap();
    let activation = event.published_at();
    let separate = filters(json!([
        {"events": ["document.created"], "ids": [OTHER_ID]},
        {"events": ["document.updated"], "ids": [ENTITY_ID]}
    ]));
    assert!(!separate.matches(&event, activation));
    for ids in [Value::Null, json!([ENTITY_ID])] {
        assert!(
            filters(json!([{"events": ["document.created"], "ids": ids}]))
                .matches(&event, activation)
        );
    }
    assert!(filters(json!([{"events": ["document.created"]}])).matches(&event, activation));
    assert!(
        !filters(json!([{"events": ["document.created"], "ids": []}])).matches(&event, activation)
    );
}

#[test]
fn duplicates_do_not_multiply_matches_and_pre_activation_events_do_not_match() {
    let event = incoming("document.created", metadata())
        .normalize()
        .unwrap();
    let filter =
        json!({"events": ["document.created", "document.created"], "ids": [ENTITY_ID, ENTITY_ID]});
    let filters = filters(json!([filter, filter]));
    assert_eq!(filters.as_slice().len(), 1);
    assert_eq!(filters.as_slice()[0].events().len(), 1);
    assert_eq!(filters.as_slice()[0].ids().unwrap().len(), 1);
    assert!(filters.matches(&event, event.published_at()));
    assert!(filters.matches(
        &event,
        event.published_at() - chrono::Duration::milliseconds(1)
    ));
    assert!(!filters.matches(
        &event,
        event.published_at() + chrono::Duration::milliseconds(1)
    ));
}

#[test]
fn filter_validation_cannot_be_bypassed_by_deserialization() {
    for value in [
        json!([]),
        json!([{"events": []}]),
        json!([{"events": ["document.copied"]}]),
        json!([{"events": ["document.created"], "ids": ["invalid"]}]),
        json!([{"events": ["document.created"], "unexpected": true}]),
        json!(vec![
            json!({"events": ["document.created"]});
            MAX_FILTERS + 1
        ]),
        json!([{"events": vec!["document.created"; MAX_EVENTS_PER_FILTER + 1]}]),
        json!([{"events": ["document.created"], "ids": vec![ENTITY_ID; MAX_IDS_PER_FILTER + 1]}]),
    ] {
        assert!(serde_json::from_value::<EventFilters>(value).is_err());
    }
    assert!(serde_json::from_value::<EventFilters>(json!([
        {"events": vec!["document.created"; MAX_EVENTS_PER_FILTER], "ids": vec![ENTITY_ID; MAX_IDS_PER_FILTER]}
    ])).is_ok());
}

#[test]
fn stored_context_cannot_bypass_identity_or_message_shape_validation() {
    let event = incoming("channel.message_posted", metadata())
        .normalize()
        .unwrap();
    let mut stored = serde_json::to_value(event).unwrap();
    stored["message_id"] = Value::Null;
    assert!(serde_json::from_value::<EventReference>(stored.clone()).is_err());
    stored["event_name"] = json!("document.created");
    assert!(serde_json::from_value::<EventReference>(stored.clone()).is_ok());
    stored["event_id"] = json!("01900000-0000-4000-8000-000000000003");
    assert!(serde_json::from_value::<EventReference>(stored).is_err());
}

#[test]
fn run_revisions_claim_tokens_and_page_sizes_are_validated() {
    use crate::domain::event_runs::{ClaimToken, ConfigurationRevision, EventRunState, PageSize};

    assert_eq!(ConfigurationRevision::INITIAL.next().unwrap().get(), 2);
    for value in [0, -1] {
        assert!(serde_json::from_value::<ConfigurationRevision>(json!(value)).is_err());
    }
    assert!(
        ConfigurationRevision::try_from(i64::MAX)
            .unwrap()
            .next()
            .is_err()
    );
    let first = ClaimToken::generate();
    let second = ClaimToken::generate();
    assert_ne!(first, second);
    assert_eq!(
        serde_json::from_value::<ClaimToken>(serde_json::to_value(first).unwrap()).unwrap(),
        first
    );
    assert!(ClaimToken::try_from(Uuid::nil()).is_err());
    assert!(PageSize::try_from(0).is_err());
    assert!(PageSize::try_from(PageSize::MAX + 1).is_err());
    assert_eq!(
        PageSize::try_from(PageSize::MAX).unwrap().get(),
        PageSize::MAX
    );
    assert!(serde_json::from_value::<EventRunState>(json!({"state": "retry_scheduled"})).is_err());
}

#[test]
fn tagged_trigger_round_trips_and_rejects_conflicting_fields() {
    for value in [
        json!({"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"}),
        json!({"type": "events", "filters": [{"events": ["document.created"]}]}),
    ] {
        let trigger: ActionTrigger = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(trigger).unwrap(), value);
    }
    assert!(serde_json::from_value::<ActionTrigger>(json!({"type": "events", "filters": [{"events": ["document.created"]}], "schedule": "0 0 9 * * *"})).is_err());
}
