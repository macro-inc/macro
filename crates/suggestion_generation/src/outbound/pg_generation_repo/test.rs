use std::sync::Arc;

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

/// A person is due from their next run time until it moves on; seeing them
/// again in the same zone keeps it, a new zone takes the new one; a
/// generation running holds them back.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_is_due_from_their_next_run_until_it_moves_on(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = at_hour(18);
    let due = |at: DateTime<Utc>| {
        let repo = repo.clone();
        async move { repo.due(at, at - TimeDelta::minutes(25), 10).await.unwrap() }
    };
    assert!(due(now).await.is_empty(), "never seen");
    let seen = now - TimeDelta::days(2);
    let next = now - TimeDelta::minutes(1);
    repo.see(&owner(), "Asia/Tokyo", seen, next).await.unwrap();
    assert_eq!(
        due(now).await,
        [AudienceMember {
            user: owner(),
            timezone: chrono_tz::Asia::Tokyo,
            seen_at: seen,
        }]
    );
    assert!(
        due(next - TimeDelta::minutes(1)).await.is_empty(),
        "not yet"
    );
    // Seen again in the same zone: the next run stays.
    repo.see(&owner(), "Asia/Tokyo", now, now + TimeDelta::hours(5))
        .await
        .unwrap();
    assert_eq!(due(now).await.len(), 1);
    // In another zone: the next run is that zone's.
    repo.see(&owner(), "Europe/Paris", now, now + TimeDelta::hours(5))
        .await
        .unwrap();
    assert!(due(now).await.is_empty());
    repo.reschedule(&owner(), now).await.unwrap();
    assert_eq!(due(now).await.len(), 1);
    // A generation running holds them back.
    let night = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            now,
            now - TimeDelta::minutes(25),
            now - TimeDelta::hours(20),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(due(now).await.is_empty());
    repo.finish(night, true, now).await.unwrap();
    // Rescheduled to the next night, they are due then.
    repo.reschedule(&owner(), now + TimeDelta::days(1))
        .await
        .unwrap();
    assert!(due(now + TimeDelta::minutes(30)).await.is_empty());
    assert_eq!(due(now + TimeDelta::days(1)).await.len(), 1);
}

/// A generation its process never finished (cancelled by a deploy, or the
/// process stopped) holds the person back only until it is stale; then the
/// nightly run starts and records the interrupted one failed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_interrupted_generation_holds_no_one_back_once_stale(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool.clone());
    let now = at_hour(18);
    let stale = TimeDelta::minutes(25);
    repo.see(&owner(), "Asia/Tokyo", now - TimeDelta::days(1), now)
        .await
        .unwrap();
    let due = |at: DateTime<Utc>| {
        let repo = repo.clone();
        async move { repo.due(at, at - TimeDelta::minutes(25), 10).await.unwrap() }
    };
    let begun = now - TimeDelta::minutes(10);
    let onboarding = repo
        .begin(
            &owner(),
            GenerationTrigger::Onboarding,
            begun,
            begun - stale,
            begun - TimeDelta::hours(20),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(due(now).await.is_empty(), "still running");
    let later = now + TimeDelta::minutes(20);
    assert_eq!(due(later).await.len(), 1, "interrupted");
    let night = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            later,
            later - stale,
            later - TimeDelta::hours(20),
        )
        .await
        .unwrap();
    assert!(night.is_some_and(|night| night != onboarding));
    let status = sqlx::query_scalar!(
        "SELECT status FROM suggestion_generation WHERE id = $1",
        onboarding
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "failed");
}

/// A generation interrupted mid-run reads as failed once stale, with no
/// later run started, so the suggestions UI stops waiting on it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_interrupted_generation_reads_as_failed_once_stale(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = Utc::now();
    let stale = TimeDelta::minutes(25);
    let begun = now - TimeDelta::minutes(30);
    repo.begin(
        &owner(),
        GenerationTrigger::Onboarding,
        begun,
        begun - stale,
        begun - TimeDelta::hours(20),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        Some(GenerationStatus::Failed)
    );
    // It still restarts in place, and reads as generating again.
    repo.begin(
        &owner(),
        GenerationTrigger::Onboarding,
        now,
        now - stale,
        now - TimeDelta::hours(20),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        GenerationStatuses::latest(&repo, &owner()).await.unwrap(),
        Some(GenerationStatus::Generating)
    );
}

/// A nightly run interrupted tonight doesn't hold back tonight's run: the
/// person is due again once it is stale, and it restarts in place.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_interrupted_nightly_run_holds_no_cooldown(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = at_hour(18);
    let stale = TimeDelta::minutes(25);
    repo.see(&owner(), "Asia/Tokyo", now - TimeDelta::days(1), now)
        .await
        .unwrap();
    let begun = now - TimeDelta::minutes(30);
    let night = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            begun,
            begun - stale,
            begun - TimeDelta::hours(20),
        )
        .await
        .unwrap()
        .unwrap();
    let due = repo.due(now, now - stale, 10).await.unwrap();
    assert_eq!(due.len(), 1);
    let again = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            now,
            now - stale,
            now - TimeDelta::hours(20),
        )
        .await
        .unwrap();
    assert_eq!(again, Some(night));
}

/// A routines session this week holds the next one back a week; forgetting
/// a person takes them out of the nightly audience.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn routines_come_weekly_and_a_forgotten_person_is_not_due(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgGenerationRepo::new(pool);
    let now = at_hour(18);
    assert!(
        !repo
            .routines_since(&owner(), now - TimeDelta::days(7))
            .await
            .unwrap()
    );
    let generation = repo
        .begin(
            &owner(),
            GenerationTrigger::Nightly,
            now - TimeDelta::days(3),
            now - TimeDelta::days(3) - TimeDelta::minutes(25),
            now - TimeDelta::days(4),
        )
        .await
        .unwrap()
        .unwrap();
    GenerationRepo::open_session(
        &repo,
        Uuid::now_v7(),
        generation,
        &owner(),
        bot_id::MACRO_NEW_BOT_ID,
        SessionKind::Routines,
        &["email".to_owned()],
        now - TimeDelta::days(3),
    )
    .await
    .unwrap();
    assert!(
        repo.routines_since(&owner(), now - TimeDelta::days(7))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .routines_since(&owner(), now - TimeDelta::days(2))
            .await
            .unwrap()
    );

    repo.see(&owner(), "Asia/Tokyo", now - TimeDelta::days(1), now)
        .await
        .unwrap();
    let due = |repo: PgGenerationRepo| async move {
        repo.due(now, now - TimeDelta::minutes(25), 10)
            .await
            .unwrap()
    };
    assert_eq!(due(repo.clone()).await.len(), 1);
    repo.forget(&owner()).await.unwrap();
    assert!(due(repo.clone()).await.is_empty());
}

/// Everyone paid or nobody.
struct Plans(bool);

#[async_trait::async_trait]
impl crate::domain::ports::Plans for Plans {
    async fn paid(&self, _: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        Ok(self.0)
    }
}

/// Reading the ideas feed counts a person in for nightly runs only on a
/// paid plan, due in their next night.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_counts_in_only_paid_readers_due_in_their_night(pool: PgPool) {
    use ideas::domain::ports::SuggestionAudience;

    use crate::domain::audience::PaidAudience;
    use crate::domain::night;

    insert_user(&pool, OWNER).await;
    let repo = Arc::new(PgGenerationRepo::new(pool));
    let now = Utc::now();
    let unpaid = PaidAudience::new(Arc::clone(&repo), Arc::new(Plans(false)));
    unpaid.seen(&owner(), "Asia/Tokyo", now).await.unwrap();
    let far = now + TimeDelta::days(2);
    assert!(repo.due(far, far, 10).await.unwrap().is_empty());
    let paid = PaidAudience::new(Arc::clone(&repo), Arc::new(Plans(true)));
    paid.seen(&owner(), "Not/AZone", now).await.unwrap();
    assert!(repo.due(far, far, 10).await.unwrap().is_empty());
    paid.seen(&owner(), "Asia/Tokyo", now).await.unwrap();
    let next = night::upcoming(&owner(), chrono_tz::Asia::Tokyo, now);
    assert!(
        repo.due(next - TimeDelta::seconds(1), far, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(repo.due(next, far, 10).await.unwrap().len(), 1);
}
