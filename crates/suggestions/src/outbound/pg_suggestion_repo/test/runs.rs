//! Runs as stored: which ones a sweep checks, holding one, moving one only
//! from where it was read, and what a finished one records.

use super::*;
use crate::domain::ports::RunScopes;
use crate::domain::run::RunStateName;

/// Runs nobody holds come least recently checked first, so runs that keep
/// waiting never hide the others from a small batch; held and settled runs
/// aren't checked.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn runs_to_check_take_turns(pool: PgPool) {
    let f = fixture(pool).await;
    let mut runs = Vec::new();
    for _ in 0..3 {
        let id = f.prompt(None).await;
        runs.push(f.start(id).await.unwrap().session);
    }
    let now = Utc::now();
    let to_check = |limit| f.repo.runs_to_check(Utc::now(), limit);
    let first: Vec<_> = to_check(3)
        .await
        .unwrap()
        .iter()
        .map(|run| run.session)
        .collect();
    assert_eq!(first, runs);
    // Checked runs go to the back.
    let held = f
        .repo
        .claim_run(runs[0], now, now + chrono::Duration::minutes(2))
        .await
        .unwrap()
        .unwrap();
    f.repo
        .release_run(runs[0], now + chrono::Duration::minutes(2))
        .await
        .unwrap();
    assert_eq!(to_check(1).await.unwrap()[0].session, runs[1]);
    // A held run isn't checked, nor a settled one.
    f.repo
        .claim_run(runs[1], now, now + chrono::Duration::minutes(2))
        .await
        .unwrap()
        .unwrap();
    let run = f.repo.run(runs[2]).await.unwrap().unwrap();
    assert!(
        f.repo
            .move_run(&run, RunState::Failed, now, &[], now)
            .await
            .unwrap()
    );
    let left: Vec<_> = to_check(3)
        .await
        .unwrap()
        .iter()
        .map(|run| run.session)
        .collect();
    assert_eq!(left, [held.session]);
}

/// One holder at a time: a held run can't be claimed until it is let go, by
/// its holder only, or its hold runs out.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_has_one_holder_at_a_time(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let session = f.start(id).await.unwrap().session;
    let now = Utc::now();
    let until = now + chrono::Duration::minutes(2);
    assert!(
        f.repo
            .claim_run(session, now, until)
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        f.repo
            .claim_run(session, now, until)
            .await
            .unwrap()
            .is_none()
    );
    // Someone else's release lets nothing go.
    f.repo
        .release_run(session, until + chrono::Duration::seconds(1))
        .await
        .unwrap();
    assert!(
        f.repo
            .claim_run(session, now, until)
            .await
            .unwrap()
            .is_none()
    );
    f.repo.release_run(session, until).await.unwrap();
    assert!(
        f.repo
            .claim_run(session, now, until)
            .await
            .unwrap()
            .is_some()
    );
    // A hold that ran out is anyone's.
    assert!(
        f.repo
            .claim_run(session, until, until + chrono::Duration::minutes(2))
            .await
            .unwrap()
            .is_some()
    );
}

/// A run is stored held by whoever starts it: no one else claims or sweeps
/// it until it is let go or the hold runs out.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_starts_held_by_its_starter(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let run = f.run_of(id, None);
    let shown = f.suggestion(id).await.updated_at;
    let hold = run.started_at + chrono::Duration::minutes(2);
    assert!(f.repo.start_run(&run, shown, hold).await.unwrap());
    let now = Utc::now();
    assert!(
        f.repo
            .claim_run(run.session, now, now + chrono::Duration::minutes(2))
            .await
            .unwrap()
            .is_none()
    );
    assert!(f.repo.runs_to_check(now, 10).await.unwrap().is_empty());
    f.repo.release_run(run.session, hold).await.unwrap();
    assert_eq!(
        f.repo
            .runs_to_check(now, 10)
            .await
            .unwrap()
            .iter()
            .map(|run| run.session)
            .collect::<Vec<_>>(),
        [run.session]
    );
}

/// A run row that doesn't decode is skipped and counted as checked, so the
/// sweep still checks the others and the row never holds the front of it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_skips_a_run_it_cant_read(pool: PgPool) {
    let f = fixture(pool).await;
    let broken = f.start(f.prompt(None).await).await.unwrap().session;
    let fine = f
        .start(f.prompt(Some("Email the supplier the order")).await)
        .await
        .unwrap()
        .session;
    sqlx::query!(
        "UPDATE suggestion_run SET agent_id = 'not-a-uuid' WHERE session_id = $1",
        broken,
    )
    .execute(&f.pool)
    .await
    .unwrap();
    let checked = |limit| {
        let repo = &f.repo;
        async move {
            repo.runs_to_check(Utc::now(), limit)
                .await
                .unwrap()
                .into_iter()
                .map(|run| run.session)
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(checked(10).await, [fine]);
    // The broken row, started first, no longer comes first.
    assert_eq!(checked(1).await, [fine]);
}

/// A move lands only on the run as it was read, lets go of it, and stamps
/// when it settled.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_moves_only_from_where_it_was_read(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let read = f.start(id).await.unwrap();
    let now = Utc::now();
    let until = now + chrono::Duration::minutes(2);
    let held = f
        .repo
        .claim_run(read.session, now, until)
        .await
        .unwrap()
        .unwrap();
    assert!(
        f.repo
            .move_run(&held, RunState::Running, now, &[], now)
            .await
            .unwrap()
    );
    // Let go of: anyone may hold it now.
    let running = f
        .repo
        .claim_run(read.session, now, until)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(running.state, RunState::Running);
    // A step decided on the old read lands nowhere.
    assert!(
        !f.repo
            .move_run(&read, RunState::Failed, now, &[], now)
            .await
            .unwrap()
    );
    let waiting = RunState::Waiting { since: now };
    assert!(
        f.repo
            .move_run(&running, waiting, now, &[], now)
            .await
            .unwrap()
    );
    let stored = f.repo.run(read.session).await.unwrap().unwrap();
    assert_eq!(stored.state.name(), RunStateName::Waiting);
    // A waiting run read before it moved again lands nowhere either.
    let later = now + chrono::Duration::minutes(1);
    let rewaited = RunState::Waiting { since: later };
    assert!(
        f.repo
            .move_run(&stored, rewaited, later, &[], later)
            .await
            .unwrap()
    );
    assert!(
        !f.repo
            .move_run(&stored, RunState::Failed, later, &[], later)
            .await
            .unwrap()
    );
    let settled = sqlx::query!(
        "SELECT settled_at, claimed_until FROM suggestion_run WHERE session_id = $1",
        read.session,
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert!(settled.settled_at.is_none());
    let current = f.repo.run(read.session).await.unwrap().unwrap();
    assert!(
        f.repo
            .move_run(&current, RunState::Cancelled, later, &[], later)
            .await
            .unwrap()
    );
    let settled = sqlx::query!(
        "SELECT settled_at FROM suggestion_run WHERE session_id = $1",
        read.session,
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert!(settled.settled_at.is_some());
}

/// A finished run adds what it made to the suggestion once each, in the order
/// given, after what the suggestion has.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_run_records_each_item_it_made_once(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let run = f.start(id).await.unwrap();
    let item = |entity_id: &str, part: Option<&str>| Target {
        entity_type: EntityType::Document,
        entity_id: entity_id.to_owned(),
        part_id: part.map(str::to_owned),
    };
    let now = Utc::now();
    assert!(
        f.repo
            .move_run(
                &run,
                RunState::Finished,
                now,
                &[
                    item("b", None),
                    item("a", None),
                    item("b", None),
                    item("a", Some("section")),
                    item("a", None),
                ],
                now,
            )
            .await
            .unwrap()
    );
    assert_eq!(
        f.suggestion(id).await.produced,
        [item("b", None), item("a", None), item("a", Some("section"))]
    );
}

/// A run's session sends nothing when the run was started with nothing to
/// send, whatever its suggestion says since; a session that is no run isn't
/// one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_sends_what_it_was_started_with(pool: PgPool) {
    let f = fixture(pool).await;
    let quiet = f.prompt(None).await;
    let loud = f.prompt(Some("Email the supplier the order")).await;
    let mut sessions = Vec::new();
    for (id, sends) in [(quiet, None), (loud, Some("Email the supplier the order"))] {
        let run = f.run_of(id, sends);
        let shown = f.suggestion(id).await.updated_at;
        assert!(f.repo.start_run(&run, shown, run.started_at).await.unwrap());
        sessions.push(run.session);
    }
    assert!(f.repo.sends_nothing(sessions[0]).await.unwrap());
    assert!(!f.repo.sends_nothing(sessions[1]).await.unwrap());
    assert!(!f.repo.sends_nothing(Uuid::now_v7()).await.unwrap());
    // What the run was started with counts, not the suggestion now.
    sqlx::query!(
        "UPDATE suggestion_prompt SET sends = 'Post it in #ops' WHERE suggestion_id = $1",
        quiet,
    )
    .execute(&f.pool)
    .await
    .unwrap();
    assert!(f.repo.sends_nothing(sessions[0]).await.unwrap());
}

/// While a run is unsettled, its suggestion's prompt and `sends` stay; the
/// rest may change, and both may once it settles.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_running_suggestions_prompt_and_sends_stay(pool: PgPool) {
    let f = fixture(pool).await;
    let id = f.prompt(None).await;
    let run = f.start(id).await.unwrap();
    let f = &f;
    let replace = |content: SuggestionContent| async move {
        f.repo
            .replace(
                &f.user,
                id,
                &content,
                SuggestionState::Accepted,
                SuggestionState::Accepted,
                NO_LIMITS,
                &f.change(ChangeAction::Rewritten),
            )
            .await
            .unwrap()
    };
    let current = SuggestionContent::of(&f.suggestion(id).await);
    let mut prompt = current.clone();
    prompt.prompt = Some("Compare them and order the cheapest.".to_owned());
    assert_eq!(replace(prompt.clone()).await, Written::RunGoing);
    let mut sends = current.clone();
    sends.sends = Some("Orders from the cheapest supplier".to_owned());
    assert_eq!(replace(sends).await, Written::RunGoing);
    let mut title = current.clone();
    title.title = "Compare the four quotes".to_owned();
    assert_eq!(replace(title).await, Written::Applied);
    let now = Utc::now();
    assert!(
        f.repo
            .move_run(&run, RunState::Failed, now, &[], now)
            .await
            .unwrap()
    );
    assert_eq!(replace(prompt).await, Written::Applied);
}
