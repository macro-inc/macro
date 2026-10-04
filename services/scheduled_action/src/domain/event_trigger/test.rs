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
    let payload = if name.starts_with("document.") {
        let value = json!({"event_type": name, "metadata": metadata});
        EventPayload::Document(serde_json::from_value(value).unwrap())
    } else if let Some(message_name) = message_event_name(name) {
        EventPayload::Message(message_fact(message_name, metadata))
    } else {
        let value = json!({"event_type": name, "metadata": metadata});
        EventPayload::Channel(serde_json::from_value(value).unwrap())
    };
    IncomingEvent {
        event_id: Uuid::parse_str(EVENT_ID).unwrap(),
        schema_version: 1,
        payload,
    }
}

/// Channel message triggers arrive on `macro.messages` under these names.
fn message_event_name(trigger: &str) -> Option<&'static str> {
    match trigger {
        "channel.message_posted" => Some("message.posted"),
        "channel.mentioned" => Some("message.mentioned"),
        "channel.message_patched" => Some("message.patched"),
        "channel.message_attachment_created" => Some("message.attachment_created"),
        _ => None,
    }
}

fn message_fact(name: &str, mut metadata: Value) -> MessageFact {
    if metadata.get("parent").is_none() {
        metadata["parent"] = json!({"type": "channel", "id": metadata["channel_id"]});
    }
    metadata["root_id"] = metadata["message_id"].clone();
    let value = json!({"event_type": name, "metadata": metadata});
    match serde_json::from_value(value).unwrap() {
        messages::outbound::broker::MessageTopicEvent::Posted(data) => MessageFact::Posted(data),
        messages::outbound::broker::MessageTopicEvent::Mentioned(data) => {
            MessageFact::Mentioned(data)
        }
        messages::outbound::broker::MessageTopicEvent::Patched(data) => MessageFact::Patched(data),
        messages::outbound::broker::MessageTopicEvent::AttachmentCreated(data) => {
            MessageFact::AttachmentCreated(data)
        }
        _ => MessageFact::Other,
    }
}

#[test]
fn message_facts_on_other_parents_never_trigger() {
    for name in [
        "channel.message_posted",
        "channel.mentioned",
        "channel.message_patched",
        "channel.message_attachment_created",
    ] {
        let mut data = metadata();
        data["parent"] = json!({"type": "document", "id": "document-1"});
        assert_eq!(
            incoming(name, data).normalize(),
            Err(EventRejection::UnsupportedEvent)
        );
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

#[test]
fn multiple_triggers_preserve_event_filters_and_choose_the_next_schedule() {
    let trigger: ActionTrigger = serde_json::from_value(serde_json::json!({
        "type": "multiple",
        "triggers": [
            {"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"},
            {"type":"cron", "schedule":"0 0 17 * * *", "timezone":"UTC"},
            {"type":"events", "filters":[{"events":["channel.message_posted"]}]}
        ]
    }))
    .unwrap();
    let after = chrono::DateTime::parse_from_rfc3339("2040-01-01T10:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(
        trigger.next_run_after(after).unwrap().to_rfc3339(),
        "2040-01-01T17:00:00+00:00"
    );
    assert_eq!(
        trigger.event_filters().unwrap().as_slice()[0].events(),
        &[EventName::ChannelMessagePosted]
    );
    assert!(trigger.has_schedule());
}

#[test]
fn event_groups_must_be_combined_and_external_webhooks_are_rejected() {
    let events = serde_json::json!({"type":"events", "filters":[{"events":["document.created"]}]});
    assert!(
        serde_json::from_value::<ActionTrigger>(
            serde_json::json!({"type":"multiple", "triggers":[events.clone(),events]})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ActionTrigger>(serde_json::json!({"type":"webhook"})).is_err()
    );
}

fn property_event(name: &str, metadata: Value) -> IncomingEvent {
    IncomingEvent {
        event_id: Uuid::parse_str(EVENT_ID).unwrap(),
        schema_version: 1,
        payload: EventPayload::Property(
            serde_json::from_value(json!({
                "event_type": name, "metadata": metadata
            }))
            .unwrap(),
        ),
    }
}

fn property_metadata() -> Value {
    json!({
        "entity_property_id": OTHER_ID, "entity_id": ENTITY_ID,
        "entity_type": "TASK", "property_definition_id": SystemPropertyKey::STATUS_UUID,
        "actor": HUMAN, "actor_user_id": HUMAN,
        "value": {"type": "SelectOption", "value": [OTHER_ID]},
        "previous_value": null, "updated_at": "2024-01-01T00:00:00Z"
    })
}

#[test]
fn document_lifecycle_distinguishes_tasks() {
    let mut data = metadata();
    assert_eq!(
        incoming("document.created", data.clone())
            .normalize()
            .unwrap()
            .event_name(),
        EventName::DocumentCreated
    );
    assert_eq!(
        incoming("document.deleted", data.clone())
            .normalize()
            .unwrap()
            .event_name(),
        EventName::DocumentDeleted
    );
    data["sub_type"] = json!("task");
    assert_eq!(
        incoming("document.created", data.clone())
            .normalize()
            .unwrap()
            .event_name(),
        EventName::TaskCreated
    );
    assert_eq!(
        incoming("document.deleted", data.clone()).normalize(),
        Err(EventRejection::UnsupportedEvent)
    );
    data["actor"] = json!(BOT);
    assert_eq!(
        incoming("document.created", data).normalize(),
        Err(EventRejection::UnsafeAttribution)
    );
}

#[test]
fn task_changes_match_specific_and_any_property_selectors() {
    for (property, name) in [
        (SystemPropertyKey::STATUS_UUID, EventName::TaskStatusChanged),
        (
            SystemPropertyKey::PRIORITY_UUID,
            EventName::TaskPriorityChanged,
        ),
        (
            SystemPropertyKey::DUE_DATE_UUID,
            EventName::TaskPropertyChanged,
        ),
    ] {
        let mut data = property_metadata();
        data["property_definition_id"] = json!(property);
        for source in ["entity_property.updated", "entity_property.deleted"] {
            let event = property_event(source, data.clone()).normalize().unwrap();
            assert_eq!(event.event_name(), name);
            let any = EventFilter::new(vec![EventName::TaskPropertyChanged], None).unwrap();
            assert!(any.accepts(event.event_name(), event.entity_id()));
            let other_task =
                EventFilter::new(vec![name], Some(vec![Uuid::parse_str(OTHER_ID).unwrap()]))
                    .unwrap();
            assert!(!other_task.accepts(name, event.entity_id()));
            let stored = serde_json::to_value(&event).unwrap();
            assert_eq!(stored.as_object().unwrap().len(), 4);
            assert_eq!(
                serde_json::from_value::<EventReference>(stored).unwrap(),
                event
            );
        }
    }
    let event = property_event("entity_properties.cleared", property_metadata())
        .normalize()
        .unwrap();
    assert_eq!(event.event_name(), EventName::TaskPropertyChanged);
}

#[test]
fn property_changes_ignore_other_entities_noops_and_bot_writes() {
    let original = property_metadata();
    for kind in ["DOCUMENT", "PROJECT", "INITIATIVE", "THREAD"] {
        let mut data = original.clone();
        data["entity_type"] = json!(kind);
        assert_eq!(
            property_event("entity_property.updated", data).normalize(),
            Err(EventRejection::UnsupportedEvent)
        );
    }
    let mut data = original.clone();
    data["previous_value"] = data["value"].clone();
    assert_eq!(
        property_event("entity_property.updated", data).normalize(),
        Err(EventRejection::UnsupportedEvent)
    );
    for field in ["actor", "on_behalf_of"] {
        let mut data = original.clone();
        data[field] = json!(if field == "actor" { BOT } else { HUMAN });
        assert_eq!(
            property_event("entity_property.updated", data).normalize(),
            Err(EventRejection::UnsafeAttribution)
        );
    }
}

#[test]
fn mention_trigger_is_only_for_the_mentioned_user() {
    let owner = MacroUserIdStr::parse_from_str(HUMAN).unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    let event = incoming("channel.mentioned", metadata());
    assert!(event.is_for_owner(&owner));
    assert!(!event.is_for_owner(&other));
    let mut data = metadata();
    data["mentioned"]["entity_type"] = json!("document");
    assert_eq!(
        incoming("channel.mentioned", data).normalize(),
        Err(EventRejection::UnsupportedEvent)
    );
}

#[test]
fn email_receipts_keep_only_ids_and_exclude_spam_and_backfills() {
    use email::domain::events::ThreadBackfilledMetadata;
    let owner = MacroUserIdStr::parse_from_str(HUMAN).unwrap();
    let mut event = IncomingEvent {
        event_id: Uuid::parse_str(EVENT_ID).unwrap(),
        schema_version: 1,
        payload: EventPayload::Email(
            serde_json::from_value(json!({
                "event_type":"email.message_received", "metadata": {
                    "link_id": OTHER_ID, "owner": HUMAN, "message_id": OTHER_ID,
                    "provider_message_id": "provider-msg", "thread_id": ENTITY_ID,
                    "provider_thread_id": "provider-thread", "is_new_thread": false,
                    "subject": "private subject", "from_email": "private@example.com",
                    "to_emails": [], "attachment_count": 0, "is_spam_or_trash": false
                }
            }))
            .unwrap(),
        ),
    };
    let normalized = event.normalize().unwrap();
    assert_eq!(normalized.event_name(), EventName::EmailMessageReceived);
    assert_eq!(normalized.entity_type(), EventEntityType::EmailThread);
    let stored = serde_json::to_string(&normalized).unwrap();
    assert!(!stored.contains("private"));
    assert!(!stored.contains("provider"));
    assert!(event.is_for_owner(&owner));
    assert!(
        !event.is_for_owner(&MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap())
    );
    if let EventPayload::Email(EmailTopicEvent::MessageReceived(ref mut data)) = event.payload {
        data.is_spam_or_trash = true;
    }
    assert_eq!(event.normalize(), Err(EventRejection::UnsupportedEvent));
    event.payload = EventPayload::Email(EmailTopicEvent::ThreadBackfilled(
        ThreadBackfilledMetadata {
            link_id: Uuid::parse_str(OTHER_ID).unwrap(),
            owner,
            thread_id: Uuid::parse_str(ENTITY_ID).unwrap(),
        },
    ));
    assert_eq!(event.normalize(), Err(EventRejection::UnsupportedEvent));
}
