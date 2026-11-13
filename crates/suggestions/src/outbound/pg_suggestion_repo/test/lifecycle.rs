//! Every write's SQL guard, tried from every state, against the lifecycle
//! table ([`crate::domain::lifecycle`]) and the run state machine
//! ([`crate::domain::run`]).

use strum::IntoEnumIterator;

use super::*;
use crate::domain::lifecycle::{cancels_run, sources, transition};
use crate::domain::run::RunStateName;

/// Where `event` leaves a suggestion in state `from`: moved as the table
/// says, or untouched.
fn after(from: SuggestionState, event: LifecycleEvent) -> SuggestionState {
    transition(from, event).unwrap_or(from)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn state_moves_follow_the_table(pool: PgPool) {
    let f = fixture(pool).await;
    for (event, to) in [
        (LifecycleEvent::TakeOn, SuggestionState::Accepted),
        (LifecycleEvent::Complete, SuggestionState::Done),
        (LifecycleEvent::Dismiss, SuggestionState::Dismissed),
        (LifecycleEvent::Retire, SuggestionState::Retired),
    ] {
        for from in SuggestionState::iter() {
            let id = f.prompt_in(from).await;
            let moved = f
                .repo
                .set_state(&f.user, id, &sources(event), to, None, Utc::now())
                .await
                .unwrap();
            assert_eq!(
                moved,
                transition(from, event).is_some(),
                "{event:?} from {from:?}"
            );
            assert_eq!(
                f.state(id).await,
                after(from, event),
                "{event:?} from {from:?}"
            );
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moves_as_shown_follow_the_table_and_the_card(pool: PgPool) {
    let f = fixture(pool).await;
    for (event, to) in [
        (LifecycleEvent::TakeOn, SuggestionState::Accepted),
        (LifecycleEvent::Complete, SuggestionState::Done),
    ] {
        for from in SuggestionState::iter() {
            let id = f.prompt_in(from).await;
            let shown = f.suggestion(id).await.updated_at;
            // A card read before the last write moves nothing.
            let stale = f
                .repo
                .set_state_as_shown(
                    &f.user,
                    id,
                    &sources(event),
                    to,
                    shown - chrono::Duration::seconds(1),
                    Utc::now(),
                )
                .await
                .unwrap();
            assert!(!stale);
            let moved = f
                .repo
                .set_state_as_shown(&f.user, id, &sources(event), to, shown, Utc::now())
                .await
                .unwrap();
            assert_eq!(
                moved,
                transition(from, event).is_some(),
                "{event:?} from {from:?}"
            );
            assert_eq!(
                f.state(id).await,
                after(from, event),
                "{event:?} from {from:?}"
            );
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_starts_only_as_the_table_says_and_once(pool: PgPool) {
    let f = fixture(pool).await;
    for from in SuggestionState::iter() {
        let id = f.prompt_in(from).await;
        let started = f.start(id).await;
        assert_eq!(
            started.is_some(),
            transition(from, LifecycleEvent::StartRun).is_some(),
            "from {from:?}"
        );
        assert_eq!(f.state(id).await, after(from, LifecycleEvent::StartRun));
        // Never a second run while one is unsettled.
        if started.is_some() {
            assert!(f.start(id).await.is_none(), "from {from:?}");
        }
    }
    // Only background prompt suggestions run.
    let id = f.prompt(None).await;
    sqlx::query!(
        "UPDATE suggestion_prompt SET run_mode = 'composer' WHERE suggestion_id = $1",
        id
    )
    .execute(&f.pool)
    .await
    .unwrap();
    assert!(f.start(id).await.is_none());
}

/// The unique index keeps one unsettled run per suggestion even past the
/// guard.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_database_keeps_one_unsettled_run_per_suggestion(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let first = f.start(id).await.unwrap();
    let second = f.run_of(id, None);
    let inserted = sqlx::query!(
        r#"INSERT INTO suggestion_run
             (session_id, suggestion_id, user_id, agent_id, action_id, started_at, state,
              state_changed_at)
           VALUES ($1, $2, $3, 'agent', $4, now(), 'starting', now())"#,
        second.session,
        id,
        OWNER,
        second.action,
    )
    .execute(&f.pool)
    .await;
    assert!(inserted.is_err());
    // Settled and unsettled must agree with the state.
    let mismatched = sqlx::query!(
        "UPDATE suggestion_run SET state = 'finished' WHERE session_id = $1",
        first.session,
    )
    .execute(&f.pool)
    .await;
    assert!(mismatched.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_run_makes_only_an_accepted_suggestion_done(pool: PgPool) {
    let f = fixture(pool).await;
    for from in SuggestionState::iter() {
        let id = f.prompt(None).await;
        let run = f.start(id).await.unwrap();
        f.force(id, from).await;
        let now = Utc::now();
        assert!(
            f.repo
                .move_run(&run, RunState::Finished, now, &[], now)
                .await
                .unwrap()
        );
        assert_eq!(
            f.state(id).await,
            after(from, LifecycleEvent::RunFinished),
            "from {from:?}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolving_follows_the_table(pool: PgPool) {
    let f = fixture(pool).await;
    for from in SuggestionState::iter() {
        let id = f.prompt_in(from).await;
        let moved = f
            .repo
            .resolve(&f.user, id, ResolveReason::Replied, Utc::now())
            .await
            .unwrap();
        assert_eq!(
            moved,
            transition(from, LifecycleEvent::Resolve).is_some(),
            "from {from:?}"
        );
        assert_eq!(f.state(id).await, after(from, LifecycleEvent::Resolve));
    }
}

/// A routine suggestion in `state` for a fresh routine suggestion: the
/// routine suggestion's id and the suggestion's.
async fn routine_in(f: &Fixture, state: SuggestionState) -> (Uuid, Uuid) {
    let routine_suggestion = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO routine_suggestion
             (id, user_id, session_id, surfaces, routine, reason, keep_probability, created_at)
           VALUES ($1, $2, $3, '{tasks}', '{}'::jsonb, 'You plan on Mondays', 0.4, now())"#,
        routine_suggestion,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(&f.pool)
    .await
    .unwrap();
    let mut tx = f.pool.begin().await.unwrap();
    let room = suggestions_db_utils::add_routine_card(
        &mut tx,
        &suggestions_db_utils::NewRoutineSuggestionCard {
            user: OWNER,
            suggestion: routine_suggestion,
            title: "Plan the week",
            summary: "You plan on Mondays",
            importance: 40,
            categories: &[],
            session: Uuid::now_v7(),
            generation: f.generation,
            at: Utc::now(),
        },
        NO_LIMITS.open,
        NO_LIMITS.new_per_generation,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(room, suggestions_db_utils::Room::Fits);
    let id = sqlx::query_scalar!(
        "SELECT suggestion_id FROM suggestion_routine WHERE routine_suggestion_id = $1",
        routine_suggestion,
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    f.force(id, state).await;
    (routine_suggestion, id)
}

/// Routine suggestions close and complete through `suggestions_db_utils`,
/// which writes for `crates/scheduled_action`; its guards allow exactly the
/// table's sources too.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn routine_suggestion_moves_follow_the_table(pool: PgPool) {
    let f = fixture(pool).await;
    for event in [
        LifecycleEvent::Dismiss,
        LifecycleEvent::Retire,
        LifecycleEvent::Complete,
    ] {
        for from in SuggestionState::iter() {
            let (routine_suggestion, id) = routine_in(&f, from).await;
            let mut conn = f.pool.acquire().await.unwrap();
            let moved = match event {
                LifecycleEvent::Complete => suggestions_db_utils::complete_routine_card(
                    &mut conn,
                    OWNER,
                    routine_suggestion,
                    Uuid::now_v7(),
                    Utc::now(),
                )
                .await
                .unwrap(),
                _ => {
                    let to = if event == LifecycleEvent::Dismiss {
                        SuggestionState::Dismissed
                    } else {
                        SuggestionState::Retired
                    };
                    suggestions_db_utils::close_routine_card(
                        &mut conn,
                        routine_suggestion,
                        to.as_ref(),
                        None,
                        Utc::now(),
                    )
                    .await
                    .unwrap()
                }
            };
            assert_eq!(
                moved,
                transition(from, event).is_some(),
                "{event:?} from {from:?}"
            );
            assert_eq!(
                f.state(id).await,
                after(from, event),
                "{event:?} from {from:?}"
            );
        }
    }
}

/// Only a suggestion dismissed at or after the window's start comes back, and
/// only from the states the table allows.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undismissing_follows_the_table_within_its_window(pool: PgPool) {
    let f = fixture(pool).await;
    for from in SuggestionState::iter() {
        let id = f.prompt_in(from).await;
        let changed = f.suggestion(id).await.state_changed_at;
        let late = f
            .repo
            .undismiss(
                &f.user,
                id,
                changed + chrono::Duration::seconds(1),
                Utc::now(),
            )
            .await
            .unwrap();
        assert!(!late, "from {from:?}");
        assert_eq!(f.state(id).await, from);
        let moved = f
            .repo
            .undismiss(&f.user, id, changed, Utc::now())
            .await
            .unwrap();
        assert_eq!(
            moved,
            transition(from, LifecycleEvent::Undismiss).is_some(),
            "from {from:?}"
        );
        assert_eq!(f.state(id).await, after(from, LifecycleEvent::Undismiss));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_attaches_only_as_the_table_says(pool: PgPool) {
    let f = fixture(pool).await;
    let draft = Target {
        entity_type: EntityType::EmailThread,
        entity_id: Uuid::now_v7().to_string(),
        part_id: Some(Uuid::now_v7().to_string()),
    };
    for from in SuggestionState::iter() {
        let id = f.prompt_in(from).await;
        let attached = f
            .repo
            .set_draft(
                &f.user,
                id,
                &draft,
                None,
                &f.change(ChangeAction::Rewritten),
            )
            .await
            .unwrap();
        assert_eq!(
            attached,
            transition(from, LifecycleEvent::AttachDraft).is_some(),
            "from {from:?}"
        );
        assert_eq!(f.state(id).await, from);
    }
}

/// A rewrite keeps an open suggestion's state and a restore reopens a closed
/// one, as the table says; either written from a state the suggestion left
/// meanwhile is refused.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacing_follows_the_table_from_the_state_read(pool: PgPool) {
    let f = fixture(pool).await;
    for from in SuggestionState::iter() {
        let event = if from.is_open() {
            LifecycleEvent::Rewrite
        } else {
            LifecycleEvent::Restore
        };
        let to = transition(from, event).unwrap();
        let id = f.prompt_in(from).await;
        let content = SuggestionContent::of(&f.suggestion(id).await);
        let elsewhere = SuggestionState::iter()
            .find(|state| *state != from)
            .unwrap();
        let stale = f
            .repo
            .replace(
                &f.user,
                id,
                &content,
                elsewhere,
                to,
                NO_LIMITS,
                &f.change(ChangeAction::Rewritten),
            )
            .await
            .unwrap();
        assert_eq!(stale, Written::Conflict, "from {from:?}");
        let written = f
            .repo
            .replace(
                &f.user,
                id,
                &content,
                from,
                to,
                NO_LIMITS,
                &f.change(ChangeAction::Rewritten),
            )
            .await
            .unwrap();
        assert_eq!(written, Written::Applied, "from {from:?}");
        assert_eq!(f.state(id).await, to);
    }
}

/// Closing a suggestion without doing it cancels its unsettled run as the run
/// state machine says, in the same write; being done doesn't.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn closing_a_suggestion_cancels_its_run_as_the_machine_says(pool: PgPool) {
    let f = fixture(pool).await;
    let close: [(&str, LifecycleEvent, SuggestionState); 4] = [
        (
            "dismiss",
            LifecycleEvent::Dismiss,
            SuggestionState::Dismissed,
        ),
        ("retire", LifecycleEvent::Retire, SuggestionState::Retired),
        (
            "resolve",
            LifecycleEvent::Resolve,
            SuggestionState::Resolved,
        ),
        ("complete", LifecycleEvent::Complete, SuggestionState::Done),
    ];
    for name in RunStateName::iter().filter(|name| !name.is_settled()) {
        for (how, event, to) in close {
            let id = f.prompt(None).await;
            let run = f.start(id).await.unwrap();
            let since = Utc::now() - chrono::Duration::minutes(3);
            sqlx::query!(
                "UPDATE suggestion_run SET state = $2, state_changed_at = $3 WHERE session_id = $1",
                run.session,
                name.as_ref(),
                since,
            )
            .execute(&f.pool)
            .await
            .unwrap();
            let now = Utc::now();
            let moved = if event == LifecycleEvent::Resolve {
                f.repo
                    .resolve(&f.user, id, ResolveReason::Replied, now)
                    .await
                    .unwrap()
            } else {
                f.repo
                    .set_state(&f.user, id, &sources(event), to, None, now)
                    .await
                    .unwrap()
            };
            assert!(moved, "{how} with a {name:?} run");
            let stored = f.repo.run(run.session).await.unwrap().unwrap();
            let before = RunState::stored(name, since);
            let expected = if cancels_run(to) {
                before
                    .on(RunEvent::Cancel, run.started_at, now)
                    .map_or(before, |step| step.to)
            } else {
                before
            };
            assert_eq!(
                stored.state.name(),
                expected.name(),
                "{how} with a {name:?} run"
            );
            // A stop already asked for keeps when it was asked; a new one starts now.
            let entered = if expected == before {
                since
            } else {
                expected.since_or(now)
            };
            assert_eq!(
                (stored.state_changed_at - entered).num_milliseconds(),
                0,
                "{how} with a {name:?} run"
            );
        }
    }
}
