//! Daily memory against the real activity log: a user whose agents work every
//! day but who has not used Macro is passed over; one who has is generated for.
use super::*;
use activity::{Activity, Actor, CommonAction, EntityType, SeenLog};
use chrono::{Duration, NaiveTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use memory::domain::models::MemoryKind;
use sqlx::PgPool;
use std::sync::Mutex;
use uuid::Uuid;

const ADA: &str = "macro|ada@example.com";
const BEA: &str = "macro|bea@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

/// Records whom it generated for.
#[derive(Default)]
struct Generator(Mutex<Vec<String>>);
#[async_trait::async_trait]
impl MemoryGenerator for Generator {
    async fn research(&self, user: MacroUserIdStr<'static>, _: &str) -> Result<String> {
        self.0.lock().unwrap().push(user.as_ref().to_owned());
        Ok("Reviewed the launch plan".into())
    }
    async fn summarize(&self, user: MacroUserIdStr<'static>, _: &str, _: &str) -> Result<String> {
        self.0.lock().unwrap().push(user.as_ref().to_owned());
        Ok("Launch preparation".into())
    }
}

struct Passing;
#[async_trait::async_trait]
impl MemoryJudge for Passing {
    async fn review(&self, _: MacroUserIdStr<'static>, _: MemoryKind, _: &str) -> Result<()> {
        Ok(())
    }
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A bot of `owner`'s edits a document for them at noon of each of the last
/// `days` days, as a daily routine would.
fn routine_edits(owner: &str, days: i64, source: u128) -> Vec<Activity> {
    let today = Utc::now().date_naive();
    (1..=days)
        .map(|back| {
            Activity::common(
                Uuid::from_u128(source + back as u128),
                0,
                Actor::new_from_bot(bot_id::BotId::new_from_uuid(Uuid::from_u128(source))),
                Some(user(owner)),
                EntityType::Document,
                "routine-document",
                CommonAction::Edited,
                (today - Duration::days(back))
                    .and_time(NaiveTime::from_hms_opt(12, 0, 0).unwrap())
                    .and_utc(),
            )
        })
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_away_user_with_daily_agent_work_gets_no_memory_and_an_active_one_does(pool: PgPool) {
    for id in [ADA, BEA] {
        insert_user(&pool, id).await;
    }
    let log = activity::outbound::pg_activity_repo::PgActivityRepo::new(pool.clone());
    activity::outbound::pg_activity_repo::insert_activities(
        &pool,
        &[routine_edits(ADA, 3, 0xA00), routine_edits(BEA, 3, 0xB00)].concat(),
    )
    .await
    .unwrap();
    // Bea had Macro open an hour ago; Ada was last seen three weeks ago.
    log.record_seen(&[user(ADA)], Utc::now() - Duration::days(21))
        .await
        .unwrap();
    log.record_seen(&[user(BEA)], Utc::now() - Duration::hours(1))
        .await
        .unwrap();

    let repo = PgMemoryRepo::new(pool.clone());
    for id in [ADA, BEA] {
        repo.enroll(&user(id)).await.unwrap();
    }
    // Enrolled two days ago, so at least the two days before yesterday are due
    // at any hour.
    sqlx::query!("UPDATE memory_refresh_job SET created_at = NOW() - INTERVAL '2 days'")
        .execute(&pool)
        .await
        .unwrap();

    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo,
        generator.clone(),
        Arc::new(Passing),
        Arc::new(MemoryTeamRepository(
            teams::outbound::team_repo::TeamRepositoryImpl::new(pool.clone()),
        )),
        memory_activity(pool.clone()),
    );
    service.refresh_pending(|| async { false }).await.unwrap();

    let generated = generator.0.lock().unwrap().clone();
    assert!(!generated.is_empty());
    assert!(generated.iter().all(|id| id == BEA), "{generated:?}");
    let profiles = sqlx::query!(
        r#"SELECT p.user_id, p.through_date, p.content,
            (SELECT COUNT(*) FROM memory_activity a WHERE a.user_id = p.user_id AND a.granularity = 'day') AS "days!"
        FROM memory_profile p ORDER BY p.user_id"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(profiles.len(), 2);
    let (ada, bea) = (&profiles[0], &profiles[1]);
    assert_eq!(ada.user_id, ADA);
    assert_eq!(ada.through_date, bea.through_date, "both moved past the same days");
    assert_eq!(ada.days, 0, "Ada's days passed without a report");
    assert_eq!(ada.content, "");
    assert!(bea.days >= 2, "each of Bea's due days has a report");
    assert_eq!(bea.content, "Reviewed the launch plan");
}
