use strum::IntoEnumIterator;

use super::*;

fn run(state: RunStateName) -> SuggestionRun {
    SuggestionRun {
        session_id: Uuid::now_v7(),
        started_at: Utc::now(),
        state,
        state_changed_at: Utc::now(),
    }
}

/// The status the feed shows, for every state and latest run there is.
#[test]
fn a_suggestions_status_follows_its_state_then_its_latest_run() {
    use SuggestionState as S;
    use SuggestionStatus as Status;
    for state in S::iter() {
        let runs = RunStateName::iter().map(Some).chain([None]);
        for latest in runs {
            let status = SuggestionStatus::of(state, latest.map(run).as_ref());
            let expected = match (state, latest) {
                (S::Done, _) => Status::Done,
                (S::Dismissed | S::Resolved | S::Retired, _) => Status::Closed,
                (_, Some(latest)) if !latest.is_settled() && latest != RunStateName::Cancelling => {
                    Status::Running
                }
                (S::Accepted, Some(RunStateName::Failed)) => Status::Failed,
                (S::Proposed | S::Accepted, _) => Status::Open,
            };
            assert_eq!(status, expected, "{state:?} with {latest:?}");
        }
    }
    // Spelled out: what the feed shows a card as.
    assert_eq!(
        SuggestionStatus::of(S::Accepted, Some(&run(RunStateName::Waiting))),
        Status::Running
    );
    assert_eq!(
        SuggestionStatus::of(S::Accepted, Some(&run(RunStateName::Cancelled))),
        Status::Open
    );
    assert_eq!(
        SuggestionStatus::of(S::Proposed, Some(&run(RunStateName::Failed))),
        Status::Open
    );
    assert_eq!(
        SuggestionStatus::of(S::Dismissed, Some(&run(RunStateName::Cancelling))),
        Status::Closed
    );
    // Restored after a dismissal stopped its run: open, the run still stopping.
    assert_eq!(
        SuggestionStatus::of(S::Proposed, Some(&run(RunStateName::Cancelling))),
        Status::Open
    );
}

fn target(entity_type: EntityType) -> Target {
    Target {
        entity_type,
        entity_id: Uuid::now_v7().to_string(),
        part_id: None,
    }
}

/// What a card opens: once a run settles, what it made over its session; a
/// failed run's session; nothing for a run under way or cancelled; without a
/// run, what acting on a done suggestion made.
#[test]
fn a_suggestions_result_is_what_its_settled_run_made() {
    let session_of = |run: &SuggestionRun| Target {
        entity_type: EntityType::AgentSession,
        entity_id: run.session_id.to_string(),
        part_id: None,
    };
    let document = target(EntityType::Document);
    let made = [target(EntityType::AgentSession), document.clone()];
    for state in SuggestionState::iter() {
        for name in RunStateName::iter() {
            let latest = run(name);
            // Only a done suggestion's finished run, or an accepted one's
            // failed run, has a result: a suggestion restored while its
            // cancelled run settled shows none.
            let expected = match (state, name) {
                (SuggestionState::Done, RunStateName::Finished) => Some(document.clone()),
                (SuggestionState::Accepted, RunStateName::Failed) => Some(session_of(&latest)),
                _ => None,
            };
            assert_eq!(
                result_of(state, Some(&latest), &made),
                expected,
                "{state:?} with {name:?}"
            );
        }
        let without_run = (state == SuggestionState::Done).then(|| document.clone());
        assert_eq!(result_of(state, None, &made), without_run, "{state:?}");
    }
    // A finished run that made nothing but its session opens the session.
    let finished = run(RunStateName::Finished);
    assert_eq!(
        result_of(
            SuggestionState::Done,
            Some(&finished),
            &[session_of(&finished)]
        ),
        Some(session_of(&finished))
    );
    assert_eq!(
        result_of(SuggestionState::Done, Some(&finished), &[]),
        Some(session_of(&finished))
    );
    assert_eq!(result_of(SuggestionState::Done, None, &[]), None);
}

#[test]
fn a_draft_preview_is_the_start_of_its_words() {
    assert_eq!(
        preview_of("  Thanks,\n\n  see you\tMonday  "),
        Some("Thanks, see you Monday".to_owned())
    );
    assert_eq!(preview_of(" \n\t "), None);
    assert_eq!(preview_of(""), None);
    let long = preview_of(&"é".repeat(1_000)).unwrap();
    assert_eq!(long.chars().count(), DRAFT_PREVIEW_CHARS);
    let words = preview_of(&"word ".repeat(1_000)).unwrap();
    assert_eq!(words.chars().count(), DRAFT_PREVIEW_CHARS);
    assert!(words.starts_with("word word "));
}

#[test]
fn a_sender_is_shown_by_a_plain_name_only() {
    assert_eq!(
        sender_name("  Ada Lovelace "),
        Some("Ada Lovelace".to_owned())
    );
    for refused in [
        "",
        "   ",
        "ada@example.com",
        "Ada <ada@example.com>",
        "Ada\nLovelace",
        &"a".repeat(MAX_SENDER_CHARS + 1),
    ] {
        assert_eq!(sender_name(refused), None, "{refused:?}");
    }
}

fn suggestion(status: SuggestionStatus) -> Suggestion {
    let now = Utc::now();
    Suggestion {
        id: Uuid::now_v7(),
        dedup_key: Uuid::now_v7().to_string(),
        title: "Compare the quotes".to_owned(),
        summary: "Three arrived.".to_owned(),
        importance: 50,
        categories: Vec::new(),
        state: SuggestionState::Proposed,
        state_reason: None,
        about: Vec::new(),
        produced: Vec::new(),
        created_at: now,
        updated_at: now,
        state_changed_at: now,
        status,
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

#[test]
fn the_feed_counts_each_status_but_closed() {
    use SuggestionStatus as Status;
    let suggestions: Vec<Suggestion> = [
        Status::Open,
        Status::Open,
        Status::Running,
        Status::Failed,
        Status::Done,
        Status::Done,
        Status::Done,
        Status::Closed,
    ]
    .into_iter()
    .map(suggestion)
    .collect();
    assert_eq!(
        FeedCounts::of(&suggestions),
        FeedCounts {
            open: 2,
            running: 1,
            failed: 1,
            done: 3,
        }
    );
    assert_eq!(FeedCounts::of(std::iter::empty()), FeedCounts::default());
}
