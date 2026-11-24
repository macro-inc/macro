use chrono::TimeDelta;
use macro_uuid::Uuid;

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
        reason: reason.map(str::to_owned),
        updated_at: Utc::now(),
        settled_at: None,
    }
}

fn summary(topics: &[Topic]) -> Vec<(&str, Option<&str>, u32)> {
    topics
        .iter()
        .map(|topic| (topic.key.as_str(), topic.reason.as_deref(), topic.open))
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
        summary(&topics_of(&suggestions, &kept, &HashSet::new())),
        [
            ("offsite", Some("Deposit due June 2"), 2),
            ("acme", None, 1),
            ("hire", None, 0),
        ]
    );
}

/// A reason may be about a suggestion that isn't shown: its topic goes
/// without one.
#[test]
fn a_topic_missing_a_suggestion_has_no_reason() {
    let suggestions = [
        suggestion(Some("offsite"), SuggestionState::Proposed),
        suggestion(Some("acme"), SuggestionState::Proposed),
    ];
    let kept = [
        stored("offsite", Some("Deposit due June 2")),
        stored("acme", Some("Renewal is June 9")),
    ];
    let unexplained = HashSet::from(["offsite".to_owned()]);
    assert_eq!(
        summary(&topics_of(&suggestions, &kept, &unexplained)),
        [("offsite", None, 1), ("acme", Some("Renewal is June 9"), 1)]
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

/// A reason holds until one of the topic's suggestions is done after it was
/// written.
#[test]
fn a_reason_lapses_once_a_suggestion_settles_after_it() {
    let mut topic = stored("offsite", Some("Deposit due June 2"));
    assert_eq!(topic.current_reason(), Some("Deposit due June 2"));
    topic.settled_at = Some(topic.updated_at - TimeDelta::hours(1));
    assert_eq!(topic.current_reason(), Some("Deposit due June 2"));
    topic.settled_at = Some(topic.updated_at + TimeDelta::hours(1));
    assert_eq!(topic.current_reason(), None);
}
