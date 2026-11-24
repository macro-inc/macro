//! Topics: named by a session, given to suggestions, grouped in the feed.

use super::*;
use crate::domain::service::topics::TOPICS_PER_GENERATION;
use crate::domain::topic::{Topic, TopicName, TopicReason};

const VENUE: &str = "event:offsite";

/// A document.
fn document(id: &str) -> Target {
    Target {
        entity_type: EntityType::Document,
        entity_id: id.to_owned(),
        part_id: None,
    }
}

fn reason(text: &str) -> TopicReason {
    TopicReason {
        text: text.to_owned(),
        source: document("contract"),
    }
}

fn named(key: &str, name: &str, text: Option<&str>) -> NameTopic {
    NameTopic {
        key: key.to_owned(),
        name: name.to_owned(),
        reason: text.map(reason),
    }
}

fn texts(topics: &[Topic]) -> Vec<Option<&str>> {
    topics
        .iter()
        .map(|topic| topic.reason.as_ref().map(|reason| reason.text.as_str()))
        .collect()
}

fn offsite() -> NameTopic {
    named(VENUE, "Spring offsite", Some("Deposit due June 2"))
}

impl Harness {
    async fn name(&self, session: Uuid, topic: NameTopic) -> SuggestionWriteOutcome {
        self.service
            .name_topic(&principal(OWNER), Some(session), topic)
            .await
            .unwrap()
    }

    /// A session with the offsite topic named, holding a reply and a review.
    async fn offsite(&self) -> (Uuid, Suggestion, Suggestion) {
        let session = self.session(OWNER, "suggestions").await;
        assert!(self.name(session, offsite()).await.ok);
        let reply = NewSuggestion {
            topic: TopicChange::To(VENUE.to_owned()),
            ..entity_suggestion("venue:headcount")
        };
        let review = NewSuggestion {
            topic: TopicChange::To(VENUE.to_owned()),
            about: vec![document("contract")],
            ..review_suggestion("venue:contract")
        };
        let reply = self.suggest(session, reply).await.suggestion.unwrap();
        let review = self.suggest(session, review).await.suggestion.unwrap();
        (session, reply, review)
    }

    async fn topics(&self) -> Vec<Topic> {
        self.service
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
            .await
            .unwrap()
            .topics
            .unwrap()
    }

    async fn change_topic(
        &self,
        session: Uuid,
        suggestion: Uuid,
        topic: TopicChange,
    ) -> SuggestionWriteOutcome {
        self.service
            .rewrite(
                &principal(OWNER),
                Some(session),
                suggestion,
                RewriteSuggestion {
                    topic,
                    reason: "Regrouped".to_owned(),
                    ..RewriteSuggestion::default()
                },
            )
            .await
            .unwrap()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_named_topic_groups_its_suggestions_in_the_feed_and_the_review(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, reply, _) = h.offsite().await;
    h.suggest(session, prompt_suggestion("quotes:compare", "Compare"))
        .await;
    assert_eq!(
        reply.topic,
        Some(TopicName {
            key: VENUE.to_owned(),
            name: "Spring offsite".to_owned(),
        })
    );
    let expected = [Topic {
        key: VENUE.to_owned(),
        name: "Spring offsite".to_owned(),
        reason: Some(reason("Deposit due June 2")),
        open: 2,
    }];
    assert_eq!(h.topics().await, expected);
    let review = h
        .service
        .review(&principal(OWNER), Some(session))
        .await
        .unwrap();
    assert_eq!(review.topics, expected);
    // A glance at the best few has no groups.
    let glance = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, Some(1))
        .await
        .unwrap();
    assert_eq!(glance.topics, None);
}

/// Naming a key again changes the same topic, for every suggestion that has
/// it, without touching them.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn naming_a_topic_again_changes_its_name_and_reason_only(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, reply, _) = h.offsite().await;
    assert!(h.name(session, named(VENUE, "Offsite", None)).await.ok);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    let topics = feed.topics.unwrap();
    assert_eq!(topics.len(), 1);
    assert_eq!(topics[0].name, "Offsite");
    assert_eq!(topics[0].reason, None);
    let after = feed
        .suggestions
        .into_iter()
        .find(|suggestion| suggestion.id == reply.id)
        .unwrap();
    assert_eq!(after.updated_at, reply.updated_at);
    assert_eq!(after.topic.unwrap().name, "Offsite");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_suggestion_takes_only_a_topic_that_was_named(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let refused = h
        .suggest(
            session,
            NewSuggestion {
                topic: TopicChange::To("customer:acme".to_owned()),
                ..entity_suggestion("venue:headcount")
            },
        )
        .await;
    assert!(!refused.ok);
    assert!(problems(&refused).contains("nameTopic"), "{refused:?}");
    let kept = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    assert!(
        !h.change_topic(
            session,
            kept.id,
            TopicChange::To("customer:acme".to_owned())
        )
        .await
        .ok
    );
    // Another person's topic is no topic of theirs.
    let others = h.session(OTHER, "suggestions").await;
    assert!(
        h.service
            .name_topic(&principal(OTHER), Some(others), offsite())
            .await
            .unwrap()
            .ok
    );
    assert!(
        !h.change_topic(session, kept.id, TopicChange::To(VENUE.to_owned()))
            .await
            .ok
    );
    assert!(h.topics().await.is_empty());
}

/// A rewrite that says nothing of the topic keeps it; the change log has the
/// topic before and after.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rewrite_moves_a_suggestion_between_topics(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, reply, _) = h.offsite().await;
    let kept = h
        .change_topic(session, reply.id, TopicChange::Keep)
        .await
        .suggestion
        .unwrap();
    assert_eq!(kept.topic, reply.topic);
    let cleared = h
        .change_topic(session, reply.id, TopicChange::Clear)
        .await
        .suggestion
        .unwrap();
    assert_eq!(cleared.topic, None);
    assert_eq!(h.topics().await[0].open, 1);
    let back = h
        .change_topic(session, reply.id, TopicChange::To(VENUE.to_owned()))
        .await
        .suggestion
        .unwrap();
    assert_eq!(back.topic, reply.topic);
    let logged: Vec<(Option<String>, Option<String>)> = sqlx::query!(
        r#"SELECT old_value->>'topic' AS old, new_value->>'topic' AS new FROM suggestion_change
           WHERE subject_id = $1 AND action = 'rewritten' ORDER BY created_at, id"#,
        reply.id,
    )
    .fetch_all(&h.pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.old, row.new))
    .collect();
    let venue = || Some(VENUE.to_owned());
    assert_eq!(
        logged,
        [(venue(), venue()), (venue(), None), (None, venue())]
    );
}

/// Suggesting a key again keeps its topic unless the new version names one, or
/// none.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suggesting_again_keeps_the_topic_unless_it_says(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, reply, _) = h.offsite().await;
    let again = |topic| NewSuggestion {
        topic,
        ..entity_suggestion("venue:headcount")
    };
    let kept = h.suggest(session, again(TopicChange::Keep)).await;
    assert_eq!(kept.suggestion.unwrap().topic, reply.topic);
    let cleared = h.suggest(session, again(TopicChange::Clear)).await;
    assert_eq!(cleared.suggestion.unwrap().topic, None);
    let kept = h.suggest(session, again(TopicChange::Keep)).await;
    assert_eq!(kept.suggestion.unwrap().topic, None);
}

/// A reason is shown only while the person can open the item it was read in,
/// whatever became of the suggestion that cited it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reason_is_hidden_with_its_source(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, _, review) = h.offsite().await;
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("contract".to_owned());
    assert_eq!(texts(&h.topics().await), [None]);
    let seen = h.service.review(&principal(OWNER), Some(session)).await;
    assert_eq!(texts(&seen.unwrap().topics), [None]);
    // The suggestion about the contract leaves the topic: what it said of the
    // contract stays hidden.
    h.change_topic(session, review.id, TopicChange::Clear).await;
    assert_eq!(texts(&h.topics().await), [None]);
    h.access.denied.lock().unwrap().clear();
    h.access
        .failing
        .lock()
        .unwrap()
        .insert("contract".to_owned());
    assert_eq!(texts(&h.topics().await), [None]);
    h.access.failing.lock().unwrap().clear();
    assert_eq!(texts(&h.topics().await), [Some("Deposit due June 2")]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reason_is_read_in_an_item_the_person_can_open(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("contract".to_owned());
    let refused = h.name(session, offsite()).await;
    assert!(!refused.ok);
    assert!(problems(&refused).contains("contract"), "{refused:?}");
}

/// A reason may be about a suggestion now done: the topic then goes without it
/// until it is named again. Undo brings it back.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reason_lapses_once_one_of_the_suggestions_is_done(pool: PgPool) {
    let h = harness(pool, true).await;
    let (session, _, review) = h.offsite().await;
    h.accept(&user(OWNER), review.id).await.unwrap();
    assert_eq!(texts(&h.topics().await), [None]);
    h.service
        .restore(&user(OWNER), SuggestionCaller::User, review.id)
        .await
        .unwrap();
    assert_eq!(texts(&h.topics().await), [Some("Deposit due June 2")]);

    h.accept(&user(OWNER), review.id).await.unwrap();
    h.name(session, offsite()).await;
    assert_eq!(texts(&h.topics().await), [Some("Deposit due June 2")]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_topics_words_are_checked(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    for refused in [
        named("Event Offsite", "Spring offsite", None),
        named("", "Spring offsite", None),
        named(VENUE, "", None),
        named(VENUE, &"a".repeat(check::MAX_TOPIC_NAME_CHARS + 1), None),
        named(VENUE, "Spring offsite", Some("")),
        named(VENUE, "Spring offsite", Some("Ask sam@example.com")),
        named(
            VENUE,
            "Spring offsite",
            Some(&"a".repeat(check::MAX_TOPIC_REASON_CHARS + 1)),
        ),
    ] {
        let outcome = h.name(session, refused.clone()).await;
        assert!(!outcome.ok, "{refused:?}");
        assert!(!outcome.problems.is_empty(), "{refused:?}");
    }
}

/// A generation names at most so many topics; naming one of its own again is
/// always allowed, and the next generation starts over.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_generation_names_at_most_its_limit(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    for n in 0..TOPICS_PER_GENERATION {
        assert!(
            h.name(session, named(&format!("topic:{n}"), "Topic", None))
                .await
                .ok
        );
    }
    assert!(!h.name(session, named("topic:more", "Topic", None)).await.ok);
    assert!(
        h.name(session, named("topic:0", "Topic again", None))
            .await
            .ok
    );
    h.close(session).await;
    let next = h.session(OWNER, "suggestions").await;
    assert!(h.name(next, named("topic:more", "Topic", None)).await.ok);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_persons_open_suggestions_session_names_topics(pool: PgPool) {
    let h = harness(pool, true).await;
    let suggestions = h.session(OWNER, "suggestions").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "suggestions").await;
    h.close(suggestions).await;
    for correlation in [None, Some(routines), Some(others), Some(suggestions)] {
        let refused = h
            .service
            .name_topic(&principal(OWNER), correlation, offsite())
            .await;
        assert!(
            matches!(refused, Err(SuggestionError::NotGenerating)),
            "{correlation:?}: {refused:?}"
        );
    }
}
