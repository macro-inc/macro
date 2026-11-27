use super::*;
use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use macro_event_broker::Event;
use messages::domain::events::{MessageMentionedMetadata, MessagePostedMetadata};
use messages::domain::models::{MessageParent, SimpleMention};
use messages::outbound::broker::MessageTopicEvent;
use uuid::Uuid;

const ME: &str = "macro|me@example.com";
const OTHER: &str = "macro|other@example.com";
const CHANNEL_ID: Uuid = Uuid::from_u128(7);
const DOCUMENT_ID: &str = "0193b2c4-0000-7000-8000-000000000001";

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn sender(id: &str) -> ChannelSender<'static> {
    ChannelSender::try_from(id.to_owned()).expect("valid sender")
}

fn channel() -> MessageParent {
    MessageParent::Channel(CHANNEL_ID)
}

fn document() -> MessageParent {
    MessageParent::parse("document", DOCUMENT_ID).expect("valid document parent")
}

/// The broker envelope webhooks deliver for a mention, serialized from the
/// real event types so the filter's paths follow the contract.
fn mentioned(
    parent: MessageParent,
    author: &str,
    entity_type: &str,
    entity_id: &str,
) -> serde_json::Value {
    let event = Event::with_schema_version(
        MessageTopicEvent::Mentioned(MessageMentionedMetadata {
            parent,
            message_id: Uuid::from_u128(1),
            thread_id: None,
            root_id: Uuid::from_u128(1),
            sender: sender(author),
            content: "hi".to_owned(),
            mentioned: SimpleMention {
                entity_type: entity_type.to_owned(),
                entity_id: entity_id.to_owned(),
            },
            created_at: timestamp(),
        }),
        1,
    );
    serde_json::to_value(event).expect("serializable event")
}

fn posted(parent: MessageParent, author: &str) -> serde_json::Value {
    let event = Event::with_schema_version(
        MessageTopicEvent::Posted(MessagePostedMetadata {
            parent,
            message_id: Uuid::from_u128(1),
            thread_id: None,
            root_id: Uuid::from_u128(1),
            sender: sender(author),
            triggered_by: None,
            content: "hi".to_owned(),
            mentions: Vec::new(),
            attachments: Vec::new(),
            created_at: timestamp(),
        }),
        1,
    );
    serde_json::to_value(event).expect("serializable event")
}

fn literal(value: &str) -> McpFilterValue {
    McpFilterValue::Literal {
        value: value.to_owned(),
    }
}

/// "all @ mentions of me in channels".
fn my_channel_mentions() -> McpEventFilter {
    McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec!["message.mentioned".to_owned()],
            ids: None,
            all_of: vec![
                McpFieldCondition {
                    field: McpFilterField::ParentType,
                    one_of: vec![literal("channel")],
                },
                McpFieldCondition {
                    field: McpFilterField::MentionedId,
                    one_of: vec![McpFilterValue::Me],
                },
            ],
        }],
    }
}

#[test]
fn channel_mentions_of_me_match_only_channel_mentions_of_me() {
    let filter = my_channel_mentions();
    assert_eq!(filter.validate(), Ok(()));
    let channel_id = CHANNEL_ID.to_string();

    let mine = mentioned(channel(), OTHER, "user", ME);
    assert!(filter.matches("message.mentioned", &channel_id, &mine, ME));

    let someone_else = mentioned(channel(), OTHER, "user", OTHER);
    assert!(!filter.matches("message.mentioned", &channel_id, &someone_else, ME));

    let in_document = mentioned(document(), OTHER, "user", ME);
    assert!(!filter.matches("message.mentioned", DOCUMENT_ID, &in_document, ME));

    let plain = posted(channel(), OTHER);
    assert!(!filter.matches("message.posted", &channel_id, &plain, ME));
}

#[test]
fn me_is_the_subscriber_not_a_fixed_user() {
    let filter = my_channel_mentions();
    let envelope = mentioned(channel(), ME, "user", OTHER);
    assert!(filter.matches(
        "message.mentioned",
        &CHANNEL_ID.to_string(),
        &envelope,
        OTHER
    ));
}

#[test]
fn actor_reads_sender_for_posts() {
    let filter = McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec!["message.posted".to_owned()],
            ids: Some(vec![CHANNEL_ID.to_string()]),
            all_of: vec![McpFieldCondition {
                field: McpFilterField::Actor,
                one_of: vec![literal(OTHER)],
            }],
        }],
    };
    assert_eq!(filter.validate(), Ok(()));
    let channel_id = CHANNEL_ID.to_string();
    assert!(filter.matches("message.posted", &channel_id, &posted(channel(), OTHER), ME));
    assert!(!filter.matches("message.posted", &channel_id, &posted(channel(), ME), ME));
    assert!(!filter.matches("message.posted", "elsewhere", &posted(channel(), OTHER), ME));
}

#[test]
fn plain_event_filter_matches_like_a_webhook_filter() {
    let filter = McpEventFilter::for_events(vec!["document.created".to_owned()], None);
    assert_eq!(filter.validate(), Ok(()));
    let envelope = serde_json::json!({});
    assert!(filter.matches("document.created", "doc", &envelope, ME));
    assert!(!filter.matches("document.deleted", "doc", &envelope, ME));
    assert_eq!(
        filter.stream_groups(),
        vec![McpStreamGroup {
            source: WebhookFilter {
                events: vec!["document.created".to_owned()],
                ids: None
            },
            filter: filter.clone(),
        }]
    );
}

#[test]
fn a_missing_field_never_matches() {
    let filter = my_channel_mentions();
    let envelope = serde_json::json!({ "metadata": { "parent": { "type": "channel" } } });
    assert!(!filter.matches("message.mentioned", "c", &envelope, ME));
}

#[test]
fn validation_refuses_what_delivery_cannot_evaluate() {
    let mut no_clauses = my_channel_mentions();
    no_clauses.any_of.clear();
    assert_eq!(no_clauses.validate(), Err(McpFilterError::ClauseCount));

    let unknown = McpEventFilter::for_events(vec!["email.received".to_owned()], None);
    assert_eq!(
        unknown.validate(),
        Err(McpFilterError::UnknownEvent("email.received".to_owned()))
    );

    let no_events = McpEventFilter::for_events(Vec::new(), None);
    assert_eq!(no_events.validate(), Err(McpFilterError::NoEvents));

    let mut mention_field_on_post = my_channel_mentions();
    mention_field_on_post.any_of[0].events = vec!["message.posted".to_owned()];
    assert_eq!(
        mention_field_on_post.validate(),
        Err(McpFilterError::FieldNotApplicable {
            field: McpFilterField::MentionedId,
            event: "message.posted".to_owned()
        })
    );

    let mut parent_on_document = my_channel_mentions();
    parent_on_document.any_of[0].events = vec!["document.created".to_owned()];
    parent_on_document.any_of[0].all_of.truncate(1);
    assert!(matches!(
        parent_on_document.validate(),
        Err(McpFilterError::FieldNotApplicable { .. })
    ));

    let empty_ids =
        McpEventFilter::for_events(vec!["document.created".to_owned()], Some(Vec::new()));
    assert_eq!(empty_ids.validate(), Err(McpFilterError::ValueCount));

    let long = McpEventFilter::for_events(
        vec!["document.created".to_owned()],
        Some(vec!["x".repeat(MAX_VALUE_LEN + 1)]),
    );
    assert_eq!(long.validate(), Err(McpFilterError::ValueLength));

    let blank = McpEventFilter::for_events(
        vec!["document.created".to_owned()],
        Some(vec![" ".to_owned()]),
    );
    assert_eq!(blank.validate(), Err(McpFilterError::ValueLength));

    // Sixteen ids of the longest length fit each clause's limits but not the
    // whole filter's.
    let oversized = McpEventFilter::for_events(
        vec!["document.created".to_owned()],
        Some(vec!["x".repeat(MAX_VALUE_LEN); MAX_VALUES]),
    );
    assert_eq!(oversized.validate(), Err(McpFilterError::TooLarge));

    let mut too_many = my_channel_mentions();
    too_many.any_of = vec![too_many.any_of[0].clone(); MAX_CLAUSES + 1];
    assert_eq!(too_many.validate(), Err(McpFilterError::ClauseCount));
}

#[test]
fn wire_shape_is_camel_case_and_tagged() {
    let json = serde_json::to_value(my_channel_mentions()).expect("serializable");
    assert_eq!(
        json,
        serde_json::json!({
            "anyOf": [{
                "events": ["message.mentioned"],
                "allOf": [
                    { "field": "parent_type", "oneOf": [{ "kind": "literal", "value": "channel" }] },
                    { "field": "mentioned_id", "oneOf": [{ "kind": "me" }] }
                ]
            }]
        })
    );
    let back: McpEventFilter = serde_json::from_value(json).expect("round trip");
    assert_eq!(back, my_channel_mentions());
}

#[test]
fn unknown_fields_are_refused() {
    let result = serde_json::from_value::<McpEventFilter>(serde_json::json!({
        "anyOf": [{ "events": ["message.posted"], "where": "anything" }]
    }));
    assert!(result.is_err());
}

#[test]
fn event_names_are_sorted_and_unique() {
    let filter = McpEventFilter {
        any_of: vec![
            McpFilterClause {
                events: vec!["message.posted".to_owned(), "document.created".to_owned()],
                ids: None,
                all_of: Vec::new(),
            },
            McpFilterClause {
                events: vec!["message.posted".to_owned()],
                ids: None,
                all_of: Vec::new(),
            },
        ],
    };
    assert_eq!(
        filter.event_names(),
        vec!["document.created".to_owned(), "message.posted".to_owned()]
    );
}

#[test]
fn stream_groups_split_by_ids_and_leave_ids_to_the_source() {
    let mentions = my_channel_mentions().any_of.remove(0);
    let in_channel = McpFilterClause {
        events: vec!["message.posted".to_owned()],
        ids: Some(vec!["b".to_owned(), "a".to_owned()]),
        all_of: Vec::new(),
    };
    let same_ids_reordered = McpFilterClause {
        events: vec!["channel.updated".to_owned()],
        ids: Some(vec!["a".to_owned(), "b".to_owned()]),
        all_of: Vec::new(),
    };
    let filter = McpEventFilter {
        any_of: vec![
            mentions.clone(),
            in_channel.clone(),
            same_ids_reordered.clone(),
        ],
    };
    assert_eq!(filter.validate(), Ok(()));

    let without_ids = |clause: McpFilterClause| McpFilterClause {
        ids: None,
        ..clause
    };
    assert_eq!(
        filter.stream_groups(),
        vec![
            McpStreamGroup {
                source: WebhookFilter {
                    events: vec!["message.mentioned".to_owned()],
                    ids: None,
                },
                filter: McpEventFilter {
                    any_of: vec![mentions],
                },
            },
            McpStreamGroup {
                source: WebhookFilter {
                    events: vec!["channel.updated".to_owned(), "message.posted".to_owned()],
                    ids: Some(vec!["a".to_owned(), "b".to_owned()]),
                },
                filter: McpEventFilter {
                    any_of: vec![without_ids(in_channel), without_ids(same_ids_reordered)],
                },
            },
        ]
    );
}
