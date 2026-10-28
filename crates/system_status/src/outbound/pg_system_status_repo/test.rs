use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgSystemStatusRepo;
use crate::domain::models::{StatusMessage, StatusUpdate, SystemStatus};
use crate::domain::ports::SystemStatusRepo;

fn update(status: SystemStatus, minutes_ago: i64) -> StatusUpdate {
    StatusUpdate {
        id: Uuid::now_v7(),
        status,
        user_id: MacroUserIdStr::parse_from_str("macro|oncall@macro.com").unwrap(),
        created_at: Utc::now() - Duration::minutes(minutes_ago),
    }
}

fn message(text: &str) -> StatusMessage {
    StatusMessage::try_from(text.to_owned()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn latest_is_none_without_updates(pool: PgPool) {
    let repo = PgSystemStatusRepo::new(pool);

    assert_eq!(repo.latest_update().await.unwrap(), None);
    assert!(repo.list_updates(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn updates_round_trip_newest_first(pool: PgPool) {
    let repo = PgSystemStatusRepo::new(pool);
    let outage = update(
        SystemStatus::MajorOutage {
            message: message("Macro is down"),
        },
        30,
    );
    let degraded = update(
        SystemStatus::Degraded {
            message: message("Recovering"),
        },
        20,
    );
    let operational = update(SystemStatus::Operational, 10);
    for update in [&outage, &degraded, &operational] {
        repo.insert_update(update).await.unwrap();
    }

    let latest = repo.latest_update().await.unwrap().unwrap();
    let listed = repo.list_updates(2).await.unwrap();

    assert_eq!(latest.id, operational.id);
    assert_eq!(latest.status, SystemStatus::Operational);
    let listed: Vec<(Uuid, SystemStatus)> = listed
        .into_iter()
        .map(|update| (update.id, update.status))
        .collect();
    assert_eq!(
        listed,
        vec![
            (operational.id, SystemStatus::Operational),
            (degraded.id, degraded.status.clone()),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn schema_rejects_operational_with_message_and_outage_without(pool: PgPool) {
    let insert = |status: &'static str, message: Option<&'static str>| {
        sqlx::query(
            "INSERT INTO system_status (id, status, message, user_id) VALUES ($1, $2, $3, 'macro|oncall@macro.com')",
        )
        .bind(Uuid::now_v7())
        .bind(status)
        .bind(message)
        .execute(&pool)
    };

    assert!(insert("operational", Some("all good")).await.is_err());
    assert!(insert("major_outage", None).await.is_err());
    assert!(insert("unknown", Some("?")).await.is_err());
}
