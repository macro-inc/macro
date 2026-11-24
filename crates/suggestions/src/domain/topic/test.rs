use chrono::TimeDelta;
use macro_uuid::Uuid;
use model_entity::EntityType;

use super::*;
use crate::domain::model::{
    EntityAction, RewriteSuggestion, SuggestionKind, SuggestionState, SuggestionStatus,
};

fn suggestion(topic: Option<&str>, state: SuggestionState) -> Suggestion {
    let now = Utc::now();
    Suggestion {
        id: Uuid::now_v7(),
        dedup_key: Uuid::now_v7().to_string(),
        title: "Read the venue contract".to_owned(),
        summary: "The venue sent its contract.".to_owned(),
        importance: 50,
        categories: Vec::new(),
        state,
        state_reason: None,
        topic: topic.map(|key| TopicName {
            key: key.to_owned(),
            name: key.to_uppercase(),
        }),
        about: Vec::new(),
        produced: Vec::new(),
        created_at: now,
        updated_at: now,
        state_changed_at: now,
        status: SuggestionStatus::Open,
        is_new: false,
        run: None,
        result: None,
        kind: SuggestionKind::Entity {
            action: EntityAction::Review,
            draft: None,
            waiting_since: None,
            from: None,
        },
    }
}

fn stored(key: &str, reason: Option<&str>) -> StoredTopic {
    StoredTopic {
        key: key.to_owned(),
        name: key.to_uppercase(),
        reason: reason.map(|text| TopicReason {
            text: text.to_owned(),
            source: Target {
                entity_type: EntityType::Document,
                entity_id: "contract".to_owned(),
                part_id: None,
            },
        }),
        updated_at: Utc::now(),
        settled_at: None,
    }
}

fn summary(topics: &[Topic]) -> Vec<(&str, Option<&str>, u32)> {
    topics
        .iter()
        .map(|topic| {
            let reason = topic.reason.as_ref().map(|reason| reason.text.as_str());
            (topic.key.as_str(), reason, topic.open)
        })
        .collect()
}

/// Topics come in the order their suggestions do, whatever order they were
/// stored in; a closed suggestion names its topic without counting.
#[test]
fn topics_come_in_the_order_of_their_suggestions_and_count_the_open_ones() {
    let suggestions = [
        suggestion(Some("offsite"), SuggestionState::Proposed),
        suggestion(None, SuggestionState::Proposed),
        suggestion(Some("acme"), SuggestionState::Accepted),
        suggestion(Some("offsite"), SuggestionState::Proposed),
        suggestion(Some("hire"), SuggestionState::Retired),
        suggestion(Some("offsite"), SuggestionState::Dismissed),
    ];
    let kept = [
        stored("acme", None),
        stored("hire", None),
        stored("offsite", Some("Deposit due June 2")),
        stored("unused", None),
    ];
    assert_eq!(
        summary(&topics_of(&suggestions, &kept)),
        [
            ("offsite", Some("Deposit due June 2"), 2),
            ("acme", None, 1),
            ("hire", None, 0),
        ]
    );
}

/// Leaving a rewrite's topic out keeps it; null takes it away.
#[test]
fn a_rewrite_keeps_clears_or_sets_the_topic() {
    let change = |json: &str| {
        serde_json::from_str::<RewriteSuggestion>(json)
            .unwrap()
            .topic
    };
    assert_eq!(change(r#"{"reason":"r"}"#), TopicChange::Keep);
    assert_eq!(change(r#"{"reason":"r","topic":null}"#), TopicChange::Clear);
    assert_eq!(
        change(r#"{"reason":"r","topic":"acme"}"#),
        TopicChange::To("acme".to_owned())
    );
}

/// A topic renamed after its suggestions were read has one name in both.
#[test]
fn a_suggestion_takes_its_topics_name_as_last_read() {
    let mut suggestions = [
        suggestion(Some("offsite"), SuggestionState::Proposed),
        suggestion(Some("acme"), SuggestionState::Proposed),
        suggestion(None, SuggestionState::Proposed),
    ];
    let renamed = StoredTopic {
        name: "Spring offsite".to_owned(),
        ..stored("offsite", None)
    };
    let topics = topics_of(&suggestions, &[renamed]);
    let acme = suggestions[1].topic.clone();
    name_topics_from(&topics, &mut suggestions);
    let name = |index: usize| suggestions[index].topic.as_ref().map(|topic| &topic.name);
    assert_eq!(name(0), Some(&"Spring offsite".to_owned()));
    assert_eq!(suggestions[1].topic, acme);
    assert_eq!(name(2), None);
}

/// Only a suggestion done after the topic was named settles what it says.
#[test]
fn a_topic_settles_with_a_suggestion_done_after_it_was_named() {
    let mut topic = stored("offsite", Some("Deposit due June 2"));
    assert!(!topic.settled_since_named());
    topic.settled_at = Some(topic.updated_at - TimeDelta::hours(1));
    assert!(!topic.settled_since_named());
    topic.settled_at = Some(topic.updated_at + TimeDelta::hours(1));
    assert!(topic.settled_since_named());
}
