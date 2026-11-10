use chrono::TimeDelta;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const OWNER: &str = "macro|generation-repo@macro.com";

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

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap()
}

/// A time whose hour in UTC is `hour`.
fn at_hour(hour: u32) -> DateTime<Utc> {
    use chrono::TimeZone;
    Utc.with_ymd_and_hms(2026, 11, 10, hour, 30, 0).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn onboarding_runs_once_one_run_at_a_time_and_nightly_once_a_night(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = Utc::now();
    let stale = now - TimeDelta::minutes(25);
    let nightly_since = now - TimeDelta::hours(20);
    let begin = |trigger, now: DateTime<Utc>, stale, since| {
        let repo = repo.clone();
        async move {
            repo.begin(&owner(), trigger, now, stale, since)
                .await
                .unwrap()
        }
    };
    let onboarding = begin(GenerationTrigger::Onboarding, now, stale, nightly_since)
        .await
        .unwrap();
    // One runs at a time.
    assert_eq!(
        begin(GenerationTrigger::Nightly, now, stale, nightly_since).await,
        None
    );
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        Some(GenerationStatus::Generating)
    );
    // Still running half an hour later: its process stopped, so it starts again in place.
    let later = now + TimeDelta::minutes(30);
    assert_eq!(
        begin(
            GenerationTrigger::Onboarding,
            later,
            later - TimeDelta::minutes(25),
            nightly_since
        )
        .await,
        Some(onboarding)
    );
    repo.finish(onboarding, true, later).await.unwrap();
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        Some(GenerationStatus::Ready)
    );
    // Onboarding never runs again.
    assert_eq!(
        begin(GenerationTrigger::Onboarding, later, stale, nightly_since).await,
        None
    );
    // The night of onboarding still gets its nightly run.
    let night = begin(GenerationTrigger::Nightly, later, stale, nightly_since)
        .await
        .unwrap();
    repo.finish(night, false, later).await.unwrap();
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        Some(GenerationStatus::Failed)
    );
    assert_eq!(
        begin(GenerationTrigger::Nightly, later, stale, nightly_since).await,
        None
    );
    let next_day = later + TimeDelta::hours(24);
    assert!(
        begin(
            GenerationTrigger::Nightly,
            next_day,
            stale,
            next_day - TimeDelta::hours(20)
        )
        .await
        .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_is_found_while_open_and_swept_when_left_open(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = Utc::now();
    let generation = repo
        .begin(&owner(), GenerationTrigger::Onboarding, now, now, now)
        .await
        .unwrap()
        .unwrap();
    let session = Uuid::now_v7();
    GenerationRepo::open_session(
        &repo,
        session,
        generation,
        &owner(),
        bot_id::MACRO_NEW_BOT_ID,
        SessionKind::Routines,
        &["email".to_owned(), "tasks".to_owned()],
        now - TimeDelta::minutes(30),
    )
    .await
    .unwrap();
    let found = GenerationSessions::open_session(&repo, session)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.generation, generation);
    assert_eq!(found.kind, SessionKind::Routines);
    assert_eq!(found.surfaces, ["email", "tasks"]);
    let stale = repo
        .stale_sessions(now - TimeDelta::minutes(20), 10)
        .await
        .unwrap();
    assert_eq!(
        stale.iter().map(|s| s.session).collect::<Vec<_>>(),
        [session]
    );
    assert_eq!(stale[0].agent, bot_id::MACRO_NEW_BOT_ID);
    repo.close_session(session).await.unwrap();
    assert!(
        GenerationSessions::open_session(&repo, session)
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.stale_sessions(now, 10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn people_seen_this_week_are_due_in_their_night_once(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    // 18:30 UTC is 03:30 in Tokyo, inside the night.
    let now = at_hour(18);
    let due = |now: DateTime<Utc>| {
        let repo = repo.clone();
        async move {
            repo.due(
                now,
                now - TimeDelta::days(7),
                now - TimeDelta::hours(20),
                (2, 5),
                10,
            )
            .await
            .unwrap()
        }
    };
    assert!(due(now).await.is_empty(), "never seen");
    repo.see(&owner(), "Asia/Tokyo", now - TimeDelta::days(2))
        .await
        .unwrap();
    assert_eq!(
        due(now).await,
        [AudienceMember {
            user: owner(),
            timezone: chrono_tz::Asia::Tokyo
        }]
    );
    // 09:30 UTC is 18:30 in Tokyo: not their night.
    assert!(due(at_hour(9)).await.is_empty());
    // Seen over a week ago.
    assert!(due(now + TimeDelta::days(6)).await.is_empty());
    // Not again once tonight's run started.
    let night = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            now,
            now,
            now - TimeDelta::hours(20),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(due(now).await.is_empty());
    repo.finish(night, true, now).await.unwrap();
    assert!(due(now + TimeDelta::minutes(30)).await.is_empty());
    // The next night, it is due again.
    assert_eq!(due(now + TimeDelta::days(1)).await.len(), 1);
}
