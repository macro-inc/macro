use std::collections::HashSet;
use std::sync::Arc;

use chrono::TimeDelta;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const OWNER: &str = "macro|generation-repo@macro.com";
const OTHER: &str = "macro|generation-repo-other@macro.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn person(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn owner() -> MacroUserIdStr<'static> {
    person(OWNER)
}

/// Store a generation of `user` in `status` directly, whatever the guards
/// say, last alive at `heartbeat_at`.
async fn insert_generation(
    pool: &PgPool,
    user: &str,
    trigger: GenerationTrigger,
    status: GenerationStatus,
    started_at: DateTime<Utc>,
    heartbeat_at: DateTime<Utc>,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion_generation
             (id, user_id, trigger, status, attempt, started_at, heartbeat_at, finished_at)
           VALUES ($1, $2, $3, $4, 1, $5, $6::timestamptz,
                   CASE WHEN $4 = 'generating' THEN NULL ELSE $6::timestamptz END)"#,
        id,
        user,
        trigger.as_ref(),
        status.as_ref(),
        started_at,
        heartbeat_at,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn stored_status(pool: &PgPool, generation: Uuid) -> GenerationStatus {
    sqlx::query_scalar!(
        "SELECT status FROM suggestion_generation WHERE id = $1",
        generation
    )
    .fetch_one(pool)
    .await
    .unwrap()
    .parse()
    .unwrap()
}

async fn heartbeat(pool: &PgPool, generation: Uuid) -> DateTime<Utc> {
    sqlx::query_scalar!(
        "SELECT heartbeat_at FROM suggestion_generation WHERE id = $1",
        generation
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn agent_id() -> BotId {
    BotId::new_from_uuid(Uuid::now_v7())
}

/// Store a session of `generation` in cleanup state `state` directly, ended
/// (unless open) and opened at `opened_at`.
async fn insert_session(
    pool: &PgPool,
    generation: Uuid,
    user: &str,
    state: Cleanup,
    opened_at: DateTime<Utc>,
) -> Uuid {
    let session = Uuid::now_v7();
    let ended = (state != Cleanup::Open).then_some(opened_at);
    sqlx::query!(
        r#"INSERT INTO suggestion_generation_session
             (session_id, generation_id, user_id, agent_id, kind, opened_at,
              cleanup, ending, ended_at, cleanup_at)
           VALUES ($1, $2, $3, $4, 'suggestions', $5, $6, $7, $8, $8)"#,
        session,
        generation,
        user,
        agent_id().as_uuid().to_string(),
        opened_at,
        state.as_ref(),
        ended.map(|_| SessionEnding::Finished.as_ref()),
        ended,
    )
    .execute(pool)
    .await
    .unwrap();
    session
}

struct StoredSession {
    cleanup: Cleanup,
    ending: Option<SessionEnding>,
    attempts: i16,
    cleanup_at: Option<DateTime<Utc>>,
}

async fn stored_session(pool: &PgPool, session: Uuid) -> StoredSession {
    let row = sqlx::query!(
        r#"SELECT cleanup, ending, cleanup_attempts, cleanup_at
           FROM suggestion_generation_session WHERE session_id = $1"#,
        session
    )
    .fetch_one(pool)
    .await
    .unwrap();
    StoredSession {
        cleanup: row.cleanup.parse().unwrap(),
        ending: row.ending.map(|ending| ending.parse().unwrap()),
        attempts: row.cleanup_attempts,
        cleanup_at: row.cleanup_at,
    }
}

fn new_generation(
    trigger: GenerationTrigger,
    attempt: u8,
    started_at: DateTime<Utc>,
    after: Option<DateTime<Utc>>,
) -> NewGeneration {
    NewGeneration {
        id: Uuid::now_v7(),
        user: owner(),
        trigger,
        attempt,
        started_at,
        after,
    }
}

/// Every status write goes as the generation table says: an event moves a
/// generation only out of the statuses it may leave, into the one it enters.
/// Every status and trigger is storable.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ending_a_generation_follows_the_table(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    for trigger in GenerationTrigger::iter() {
        for status in GenerationStatus::iter() {
            for event in GenerationEvent::iter() {
                let generation = insert_generation(&pool, OWNER, trigger, status, now, now).await;
                let moved = repo.end(generation, event, now).await.unwrap();
                let expected = status.on(event);
                assert_eq!(moved, expected.is_ok(), "{trigger:?} {status:?} {event:?}");
                assert_eq!(
                    stored_status(&pool, generation).await,
                    expected.unwrap_or(status),
                    "{trigger:?} {status:?} {event:?}"
                );
                sqlx::query!(
                    "DELETE FROM suggestion_generation WHERE id = $1",
                    generation
                )
                .execute(&pool)
                .await
                .unwrap();
            }
        }
    }
}

/// A heartbeat keeps only a running generation alive.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_heartbeat_reaches_only_a_running_generation(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let then = Utc::now() - TimeDelta::minutes(10);
    let now = Utc::now();
    for status in GenerationStatus::iter() {
        let generation =
            insert_generation(&pool, OWNER, GenerationTrigger::Nightly, status, then, then).await;
        assert_eq!(
            repo.beat(generation, now).await.unwrap(),
            status.is_running(),
            "{status:?}"
        );
        let expected = if status.is_running() { now } else { then };
        assert_eq!(
            heartbeat(&pool, generation).await.timestamp_micros(),
            expected.timestamp_micros(),
            "{status:?}"
        );
    }
}

/// The sweep marks interrupted exactly the generations the table lets a lost
/// heartbeat end, and only once their heartbeat is older than the cut-off,
/// longest silent first, at most a batch.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_interrupts_generations_whose_heartbeat_stopped(pool: PgPool) {
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let before = now - TimeDelta::minutes(3);
    let silent = now - TimeDelta::minutes(10);
    // One person per status: only one generation of a person may run.
    let mut stale = Vec::new();
    for status in GenerationStatus::iter() {
        let user = format!("macro|lost-{}@macro.com", status.as_ref());
        insert_user(&pool, &user).await;
        let generation = insert_generation(
            &pool,
            &user,
            GenerationTrigger::Nightly,
            status,
            silent,
            silent,
        )
        .await;
        stale.push((status, generation));
    }
    insert_user(&pool, OWNER).await;
    let alive = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Onboarding,
        GenerationStatus::Generating,
        silent,
        now - TimeDelta::minutes(1),
    )
    .await;

    let lost = repo.interrupt_lost(before, now, 64).await.unwrap();
    let lost: HashSet<Uuid> = lost.into_iter().map(|lost| lost.generation).collect();
    let event = GenerationEvent::HeartbeatLost;
    for (status, generation) in stale {
        let expected = status.on(event);
        assert_eq!(lost.contains(&generation), expected.is_ok(), "{status:?}");
        assert_eq!(
            stored_status(&pool, generation).await,
            expected.unwrap_or(status),
            "{status:?}"
        );
    }
    assert!(!lost.contains(&alive));
    assert_eq!(
        stored_status(&pool, alive).await,
        GenerationStatus::Generating
    );

    // Longest silent first, a batch at a time; whose and what started it.
    let first = now - TimeDelta::minutes(30);
    insert_user(&pool, OTHER).await;
    let older = insert_generation(
        &pool,
        OTHER,
        GenerationTrigger::Manual,
        GenerationStatus::Generating,
        first,
        first,
    )
    .await;
    sqlx::query!(
        "UPDATE suggestion_generation SET heartbeat_at = $2 WHERE id = $1",
        alive,
        silent
    )
    .execute(&pool)
    .await
    .unwrap();
    let batch = repo.interrupt_lost(before, now, 1).await.unwrap();
    assert_eq!(
        batch,
        vec![LostGeneration {
            generation: older,
            user: person(OTHER),
            trigger: GenerationTrigger::Manual,
        }]
    );
    let rest = repo.interrupt_lost(before, now, 1).await.unwrap();
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0].generation, alive);
    assert!(
        repo.interrupt_lost(before, now, 1)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Admission reads whether any of the person's generations runs, and their
/// latest of one trigger: other triggers and other people don't count.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_reads_the_running_one_and_the_latest_of_the_trigger(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let nothing = AdmissionFacts {
        running: false,
        latest: None,
    };
    assert_eq!(
        repo.admission(&owner(), GenerationTrigger::Nightly)
            .await
            .unwrap(),
        nothing
    );
    let earlier = now - TimeDelta::days(2);
    let yesterday = now - TimeDelta::days(1);
    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Ready,
        earlier,
        earlier,
    )
    .await;
    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Interrupted,
        yesterday,
        yesterday,
    )
    .await;
    insert_generation(
        &pool,
        OTHER,
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    let facts = repo
        .admission(&owner(), GenerationTrigger::Nightly)
        .await
        .unwrap();
    assert!(!facts.running);
    let latest = facts.latest.unwrap();
    assert_eq!(latest.status, GenerationStatus::Interrupted);
    assert_eq!(latest.attempt, 1);
    assert_eq!(
        latest.started_at.timestamp_micros(),
        yesterday.timestamp_micros()
    );

    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Onboarding,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    let facts = repo
        .admission(&owner(), GenerationTrigger::Manual)
        .await
        .unwrap();
    assert_eq!(
        facts,
        AdmissionFacts {
            running: true,
            latest: None
        }
    );
}

/// A generation is stored only while what admission read still holds: none
/// of the person's running, none of its trigger started since, and one
/// onboarding generation per attempt.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_generation_is_stored_only_while_admission_holds(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();

    let onboarding = new_generation(GenerationTrigger::Onboarding, 1, now, None);
    assert!(repo.insert(&onboarding).await.unwrap());
    let row = sqlx::query!(
        "SELECT status, attempt, heartbeat_at FROM suggestion_generation WHERE id = $1",
        onboarding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.status, GenerationStatus::Generating.as_ref());
    assert_eq!(row.attempt, 1);
    assert_eq!(row.heartbeat_at.timestamp_micros(), now.timestamp_micros());

    // One runs at a time, of any trigger.
    let manual = new_generation(GenerationTrigger::Manual, 1, now, None);
    assert!(!repo.insert(&manual).await.unwrap());

    // Cut short, onboarding starts again only as the next attempt, and
    // only if no other started since admission read.
    assert!(
        repo.end(onboarding.id, GenerationEvent::ProcessStopped, now)
            .await
            .unwrap()
    );
    let later = now + TimeDelta::minutes(1);
    let same_attempt = new_generation(GenerationTrigger::Onboarding, 1, later, Some(now));
    assert!(!repo.insert(&same_attempt).await.unwrap());
    let unaware = new_generation(GenerationTrigger::Onboarding, 2, later, None);
    assert!(!repo.insert(&unaware).await.unwrap());
    let stale_read = new_generation(
        GenerationTrigger::Onboarding,
        2,
        later,
        Some(now - TimeDelta::minutes(1)),
    );
    assert!(!repo.insert(&stale_read).await.unwrap());
    let next = new_generation(GenerationTrigger::Onboarding, 2, later, Some(now));
    assert!(repo.insert(&next).await.unwrap());
    assert!(
        repo.end(next.id, GenerationEvent::AllFinished, later)
            .await
            .unwrap()
    );

    // Another trigger counts its own latest.
    assert!(repo.insert(&manual).await.unwrap());
    assert!(
        repo.end(manual.id, GenerationEvent::NoneFinished, later)
            .await
            .unwrap()
    );
    let nightly = new_generation(GenerationTrigger::Nightly, 1, later, None);
    assert!(repo.insert(&nightly).await.unwrap());
}

/// A session's cleanup goes as its table says: each event moves it only out
/// of the states it may leave, an end records how the turn ended, and a
/// failed delete counts one more attempt. Every ending is storable.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn session_cleanup_follows_the_table(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let generation = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    let later = now + TimeDelta::minutes(1);
    for state in Cleanup::iter() {
        for event in CleanupEvent::iter() {
            let session = insert_session(&pool, generation, OWNER, state, now).await;
            let before = stored_session(&pool, session).await;
            let expected = state.on(event);
            let moved = if event == CleanupEvent::Ended {
                // Only an end carries the ending.
                assert!(
                    !repo.advance_cleanup(session, event, later).await.unwrap(),
                    "{state:?}"
                );
                repo.end_session(session, SessionEnding::TimedOut, later)
                    .await
                    .unwrap()
            } else {
                repo.advance_cleanup(session, event, later).await.unwrap()
            };
            assert_eq!(moved, expected.is_ok(), "{state:?} {event:?}");
            let after = stored_session(&pool, session).await;
            assert_eq!(
                after.cleanup,
                expected.unwrap_or(state),
                "{state:?} {event:?}"
            );
            let counted = i16::from(moved && event.counts_attempt());
            assert_eq!(
                after.attempts,
                before.attempts + counted,
                "{state:?} {event:?}"
            );
            if moved {
                assert_eq!(
                    after.cleanup_at.map(|at| at.timestamp_micros()),
                    Some(later.timestamp_micros())
                );
            } else {
                assert_eq!(after.cleanup_at, before.cleanup_at, "{state:?} {event:?}");
            }
            let ending = if moved && event == CleanupEvent::Ended {
                Some(SessionEnding::TimedOut)
            } else {
                before.ending
            };
            assert_eq!(after.ending, ending, "{state:?} {event:?}");
        }
    }
    for ending in SessionEnding::iter() {
        let session = insert_session(&pool, generation, OWNER, Cleanup::Open, now).await;
        assert!(repo.end_session(session, ending, later).await.unwrap());
        assert_eq!(stored_session(&pool, session).await.ending, Some(ending));
    }
}

/// A session is open exactly while it has no ending.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_leaves_open_only_with_its_ending(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let now = Utc::now();
    let generation = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    let open = insert_session(&pool, generation, OWNER, Cleanup::Open, now).await;
    let ended_open = sqlx::query!(
        r#"UPDATE suggestion_generation_session SET ending = 'finished', ended_at = $2
           WHERE session_id = $1"#,
        open,
        now
    )
    .execute(&pool)
    .await;
    assert!(ended_open.is_err());
    let stopped_unended = sqlx::query!(
        "UPDATE suggestion_generation_session SET cleanup = 'stopping' WHERE session_id = $1",
        open,
    )
    .execute(&pool)
    .await;
    assert!(stopped_unended.is_err());
}

/// Tools work for a session in exactly the states the table says take
/// tools, and its code keeps a generation session's scope while it is not
/// yet deleted.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tools_and_scope_follow_the_cleanup_state(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let generation = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    repo.traced(generation, "4bf92f3577b34da6a3ce929d0e0e4736")
        .await
        .unwrap();
    for state in Cleanup::iter() {
        let session = insert_session(&pool, generation, OWNER, state, now).await;
        let found = GenerationSessions::open_session(&repo, session)
            .await
            .unwrap();
        assert_eq!(found.is_some(), state.takes_tools(), "{state:?}");
        if let Some(found) = found {
            assert_eq!(found.generation, generation);
            assert_eq!(found.user, owner());
            assert_eq!(found.kind, SessionKind::Suggestions);
            assert_eq!(
                found.trace_id.as_deref(),
                Some("4bf92f3577b34da6a3ce929d0e0e4736")
            );
        }
        assert_eq!(
            repo.undeleted(session).await.unwrap(),
            state.undeleted(),
            "{state:?}"
        );
    }
    assert!(!repo.undeleted(Uuid::now_v7()).await.unwrap());
}

/// A session opened through the repo is open, with its surfaces.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_opened_session_takes_its_tools(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let generation = new_generation(GenerationTrigger::Onboarding, 1, now, None);
    assert!(repo.insert(&generation).await.unwrap());
    let session = Uuid::now_v7();
    let surfaces = vec!["email".to_owned(), "calendar".to_owned()];
    GenerationRepo::open_session(
        &repo,
        session,
        generation.id,
        &owner(),
        agent_id(),
        SessionKind::Routines,
        &surfaces,
        now,
    )
    .await
    .unwrap();
    let found = GenerationSessions::open_session(&repo, session)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.kind, SessionKind::Routines);
    assert_eq!(found.surfaces, surfaces);
    assert_eq!(stored_session(&pool, session).await.cleanup, Cleanup::Open);
}

/// The sweep ends, as interrupted, exactly the sessions the table lets an
/// end leave, when their generation no longer runs or they opened before the
/// cut-off; one of a running generation opened since is left running.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_ends_sessions_left_open(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let stale_before = now - TimeDelta::minutes(20);
    let recent = now - TimeDelta::minutes(5);
    let ended_generation = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Cancelled,
        recent,
        recent,
    )
    .await;
    let mut orphans = Vec::new();
    for state in Cleanup::iter() {
        let session = insert_session(&pool, ended_generation, OWNER, state, recent).await;
        orphans.push((state, session));
    }
    let running = insert_generation(
        &pool,
        OTHER,
        GenerationTrigger::Manual,
        GenerationStatus::Generating,
        recent,
        now,
    )
    .await;
    let live = insert_session(&pool, running, OTHER, Cleanup::Open, recent).await;
    let overdue = insert_session(
        &pool,
        running,
        OTHER,
        Cleanup::Open,
        now - TimeDelta::minutes(30),
    )
    .await;

    let swept = repo
        .end_orphaned_sessions(stale_before, now, 64)
        .await
        .unwrap();
    let ended: HashSet<Uuid> = swept.iter().map(|stale| stale.session).collect();
    let event = CleanupEvent::Ended;
    for (state, session) in orphans {
        let expected = state.on(event);
        assert_eq!(ended.contains(&session), expected.is_ok(), "{state:?}");
        let stored = stored_session(&pool, session).await;
        assert_eq!(stored.cleanup, expected.unwrap_or(state), "{state:?}");
        if expected.is_ok() {
            assert_eq!(stored.ending, Some(SessionEnding::Interrupted));
        }
    }
    assert!(ended.contains(&overdue));
    assert!(!ended.contains(&live));
    assert_eq!(stored_session(&pool, live).await.cleanup, Cleanup::Open);
    assert!(
        swept
            .iter()
            .all(|stale| stale.ending == SessionEnding::Interrupted && stale.attempts == 0)
    );
    let overdue_swept = swept.iter().find(|stale| stale.session == overdue).unwrap();
    assert_eq!(overdue_swept.user, person(OTHER));
    assert!(
        repo.end_orphaned_sessions(stale_before, now, 64)
            .await
            .unwrap()
            .is_empty()
    );
}

/// The sweep claims ended sessions left undeleted, exactly in the states a
/// delete may leave, longest waiting first; a claimed one waits again before
/// the next claim, and keeps its ending and failed attempts.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stuck_sessions_are_claimed_and_then_wait(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let long_ago = now - TimeDelta::minutes(30);
    let generation = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Ready,
        long_ago,
        long_ago,
    )
    .await;
    let mut sessions = Vec::new();
    for state in Cleanup::iter() {
        let session = insert_session(&pool, generation, OWNER, state, long_ago).await;
        sessions.push((state, session));
    }
    let (_, stopping) = sessions
        .iter()
        .find(|(state, _)| *state == Cleanup::Stopping)
        .copied()
        .unwrap();
    assert!(
        repo.advance_cleanup(stopping, CleanupEvent::DeleteFailed, long_ago)
            .await
            .unwrap()
    );
    let fresh = insert_session(
        &pool,
        generation,
        OWNER,
        Cleanup::Stopping,
        now + TimeDelta::minutes(1),
    )
    .await;

    let before = now - TimeDelta::minutes(5);
    let claimed = repo.claim_stuck_sessions(before, now, 64).await.unwrap();
    let ids: HashSet<Uuid> = claimed.iter().map(|stale| stale.session).collect();
    let claimable = CleanupEvent::Deleted.sources();
    for (state, session) in &sessions {
        assert_eq!(
            ids.contains(session),
            claimable.contains(state),
            "{state:?}"
        );
    }
    assert!(!ids.contains(&fresh));
    let claim = claimed
        .iter()
        .find(|stale| stale.session == stopping)
        .unwrap();
    assert_eq!(claim.ending, SessionEnding::Finished);
    assert_eq!(claim.attempts, 1);
    assert_eq!(claim.user, owner());
    assert_eq!(
        stored_session(&pool, stopping)
            .await
            .cleanup_at
            .map(|at| at.timestamp_micros()),
        Some(now.timestamp_micros())
    );
    // Claimed: waits before the next sweep claims it again.
    assert!(
        repo.claim_stuck_sessions(before, now, 64)
            .await
            .unwrap()
            .is_empty()
    );
    let next_sweep = now + TimeDelta::minutes(6);
    let again = repo
        .claim_stuck_sessions(next_sweep - TimeDelta::minutes(5), next_sweep, 1)
        .await
        .unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].session, stopping);
}

/// Someone is due from their next run, while nothing of theirs runs; out of
/// the rotation, never, until seen again. A run set for the same zone stands
/// when they are seen; a new zone moves it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_is_due_while_in_the_rotation(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let run = now + TimeDelta::hours(2);
    repo.see(&owner(), "Asia/Tokyo", now, run).await.unwrap();
    assert!(
        repo.due(run - TimeDelta::seconds(1), 10)
            .await
            .unwrap()
            .is_empty()
    );
    let due = repo.due(run, 10).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].user, owner());
    assert_eq!(due[0].timezone, chrono_tz::Asia::Tokyo);

    // Seen again in the same zone: the run stands.
    repo.see(&owner(), "Asia/Tokyo", now, run + TimeDelta::hours(5))
        .await
        .unwrap();
    assert_eq!(repo.due(run, 10).await.unwrap().len(), 1);

    // Running: not due.
    let running = insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Manual,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    assert!(repo.due(run, 10).await.unwrap().is_empty());
    assert!(
        repo.end(running, GenerationEvent::AllFinished, now)
            .await
            .unwrap()
    );

    // Each outcome is storable; dropped leaves the rotation.
    for outcome in NightlyOutcome::iter() {
        repo.record_nightly(&owner(), outcome, Some(run), now)
            .await
            .unwrap();
        let stored = sqlx::query!(
            "SELECT last_outcome, last_outcome_at FROM suggestion_audience WHERE user_id = $1",
            OWNER
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.last_outcome.as_deref(), Some(outcome.as_ref()));
        assert_eq!(
            stored.last_outcome_at.map(|at| at.timestamp_micros()),
            Some(now.timestamp_micros())
        );
    }
    repo.record_nightly(&owner(), NightlyOutcome::Dropped, None, now)
        .await
        .unwrap();
    let far = now + TimeDelta::days(30);
    assert!(repo.due(far, 10).await.unwrap().is_empty());

    // Seen again: back in, at the run given.
    let back = now + TimeDelta::hours(3);
    repo.see(&owner(), "Asia/Tokyo", now, back).await.unwrap();
    assert!(
        repo.due(back - TimeDelta::seconds(1), 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(repo.due(back, 10).await.unwrap().len(), 1);

    // A new zone moves the run.
    let moved = now + TimeDelta::hours(7);
    repo.see(&owner(), "Europe/London", now, moved)
        .await
        .unwrap();
    assert!(repo.due(back, 10).await.unwrap().is_empty());
    let due = repo.due(moved, 10).await.unwrap();
    assert_eq!(due[0].timezone, chrono_tz::Europe::London);
}

/// The routines cadence is kept for anyone: someone out of the rotation gets
/// a row outside it, and someone in it keeps their next run.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_routines_cadence_is_kept_in_or_out_of_the_rotation(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    assert_eq!(repo.last_routines_ok(&owner()).await.unwrap(), None);

    repo.routines_ok(&owner(), "Asia/Tokyo", now).await.unwrap();
    assert_eq!(
        repo.last_routines_ok(&owner())
            .await
            .unwrap()
            .map(|at| at.timestamp_micros()),
        Some(now.timestamp_micros())
    );
    let far = now + TimeDelta::days(30);
    assert!(repo.due(far, 10).await.unwrap().is_empty());

    let run = now + TimeDelta::hours(2);
    repo.see(&person(OTHER), "Asia/Tokyo", now, run)
        .await
        .unwrap();
    let later = now + TimeDelta::days(8);
    repo.routines_ok(&person(OTHER), "Europe/London", later)
        .await
        .unwrap();
    let due = repo.due(run, 10).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].timezone, chrono_tz::Asia::Tokyo);
    assert_eq!(
        repo.last_routines_ok(&person(OTHER))
            .await
            .unwrap()
            .map(|at| at.timestamp_micros()),
        Some(later.timestamp_micros())
    );
}

/// The overview reads the running generation, the latest that ended and the
/// latest manual one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_overview_reads_the_running_the_ended_and_the_manual(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    assert_eq!(
        repo.overview(&owner()).await.unwrap(),
        OverviewFacts::default()
    );
    let two_hours = now - TimeDelta::hours(2);
    let hour = now - TimeDelta::hours(1);
    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Manual,
        GenerationStatus::Partial,
        two_hours,
        two_hours,
    )
    .await;
    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Nightly,
        GenerationStatus::Failed,
        hour,
        hour,
    )
    .await;
    insert_generation(
        &pool,
        OWNER,
        GenerationTrigger::Onboarding,
        GenerationStatus::Generating,
        now,
        now,
    )
    .await;
    insert_generation(
        &pool,
        OTHER,
        GenerationTrigger::Manual,
        GenerationStatus::Ready,
        now,
        now,
    )
    .await;
    let facts = repo.overview(&owner()).await.unwrap();
    let (trigger, started_at) = facts.running.unwrap();
    assert_eq!(trigger, GenerationTrigger::Onboarding);
    assert_eq!(started_at.timestamp_micros(), now.timestamp_micros());
    let (status, ended_at) = facts.last_ended.unwrap();
    assert_eq!(status, GenerationStatus::Failed);
    assert_eq!(ended_at.timestamp_micros(), hour.timestamp_micros());
    let manual = facts.latest_manual.unwrap();
    assert_eq!(manual.status, GenerationStatus::Partial);
    assert_eq!(
        manual.started_at.timestamp_micros(),
        two_hours.timestamp_micros()
    );
}

/// Routine suggestions read a generation that ended part way as ready, and
/// one cut short as failed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn routine_suggestions_read_the_latest_status(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        None
    );
    let start = Utc::now();
    for (offset, status) in (0_i64..).zip(GenerationStatus::iter()) {
        let at = start + TimeDelta::minutes(offset);
        insert_generation(&pool, OWNER, GenerationTrigger::Nightly, status, at, at).await;
        let expected = match status {
            GenerationStatus::Generating => RoutineGenerationStatus::Generating,
            GenerationStatus::Ready | GenerationStatus::Partial => RoutineGenerationStatus::Ready,
            GenerationStatus::Failed
            | GenerationStatus::Cancelled
            | GenerationStatus::Interrupted => RoutineGenerationStatus::Failed,
        };
        assert_eq!(
            GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
            Some(expected),
            "{status:?}"
        );
        if status.is_running() {
            sqlx::query!(
                "UPDATE suggestion_generation SET status = 'ready' WHERE user_id = $1 AND status = 'generating'",
                OWNER
            )
            .execute(&pool)
            .await
            .unwrap();
        }
    }
}

struct Plans(bool);

#[async_trait::async_trait]
impl crate::domain::ports::Plans for Plans {
    async fn paid(&self, _: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        Ok(self.0)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_counts_in_only_paid_readers_due_in_their_night(pool: PgPool) {
    use suggestions::domain::ports::SuggestionAudience;

    use crate::domain::audience::PaidAudience;
    use crate::domain::night;

    insert_user(&pool, OWNER).await;
    let repo = Arc::new(PgGenerationRepo::new(pool));
    let now = Utc::now();
    let unpaid = PaidAudience::new(Arc::clone(&repo), Arc::new(Plans(false)));
    unpaid.seen(&owner(), "Asia/Tokyo", now).await.unwrap();
    let far = now + TimeDelta::days(2);
    assert!(repo.due(far, 10).await.unwrap().is_empty());
    let paid = PaidAudience::new(Arc::clone(&repo), Arc::new(Plans(true)));
    paid.seen(&owner(), "Not/AZone", now).await.unwrap();
    assert!(repo.due(far, 10).await.unwrap().is_empty());
    paid.seen(&owner(), "Asia/Tokyo", now).await.unwrap();
    let next = night::upcoming(&owner(), chrono_tz::Asia::Tokyo, now);
    assert!(
        repo.due(next - TimeDelta::seconds(1), 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(repo.due(next, 10).await.unwrap().len(), 1);
}

/// The change log keeps entries for a while: pruning deletes the ones
/// written before the cut-off, a batch at a time, and keeps the rest.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pruning_deletes_only_old_change_log_entries(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = Utc::now();
    let generation = new_generation(GenerationTrigger::Onboarding, 1, now, None);
    assert!(repo.insert(&generation).await.unwrap());
    let written = |at: DateTime<Utc>| {
        let millis = u64::try_from(at.timestamp_millis()).unwrap();
        let timestamp = uuid::Timestamp::from_unix(
            uuid::NoContext,
            millis / 1000,
            u32::try_from(millis % 1000).unwrap() * 1_000_000,
        );
        Uuid::new_v7(timestamp)
    };
    for at in [
        now - TimeDelta::days(120),
        now - TimeDelta::days(100),
        now - TimeDelta::days(91),
        now - TimeDelta::days(1),
    ] {
        sqlx::query!(
            r#"INSERT INTO suggestion_change
                 (id, user_id, generation_id, session_id, subject, subject_id, action, created_at)
               VALUES ($1, $2, $3, $4, 'suggestion', $4, 'created', $5)"#,
            written(at),
            OWNER,
            generation.id,
            Uuid::now_v7(),
            at,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let cut = now - TimeDelta::days(90);
    assert_eq!(repo.prune_changes(cut, 2).await.unwrap(), 2);
    assert_eq!(repo.prune_changes(cut, 2).await.unwrap(), 1);
    assert_eq!(repo.prune_changes(cut, 2).await.unwrap(), 0);
    let left: i64 = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM suggestion_change"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 1);
}
