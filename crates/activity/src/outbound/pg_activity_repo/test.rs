use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Actor, CommonAction};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn seed(source_event: u128, action: CommonAction, entity_id: &str) -> Activity {
    Activity::common(
        Uuid::from_u128(source_event),
        0,
        Actor::new_from_user(user("macro|actor@example.com")),
        None,
        model_entity::EntityType::Document,
        entity_id,
        action,
        Utc::now(),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inserts_activities_with_split_action_columns(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());

    repo.insert_activities(&[seed(1, CommonAction::Opened, "doc-1")])
        .await
        .unwrap();

    let row = sqlx::query!(
        r#"
        SELECT actor_id, subject_id, action, action_payload, entity_type, entity_id
        FROM activity_events
        "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.actor_id, "macro|actor@example.com");
    assert_eq!(row.subject_id, "macro|actor@example.com");
    assert_eq!(row.action, "opened");
    assert_eq!(row.action_payload, None);
    assert_eq!(row.entity_type, "document");
    assert_eq!(row.entity_id, "doc-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replayed_activities_are_absorbed_by_the_id_conflict(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let seed_activity = seed(2, CommonAction::Edited, "doc-2");

    repo.insert_activities(std::slice::from_ref(&seed_activity))
        .await
        .unwrap();
    repo.insert_activities(std::slice::from_ref(&seed_activity))
        .await
        .unwrap();

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) FROM activity_events"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purge_removes_only_that_entitys_activities(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    repo.insert_activities(&[
        seed(3, CommonAction::Created, "doc-purged"),
        seed(4, CommonAction::Opened, "doc-purged"),
        seed(5, CommonAction::Created, "doc-kept"),
    ])
    .await
    .unwrap();

    repo.purge_entities(&[(model_entity::EntityType::Document, "doc-purged".to_string())])
        .await
        .unwrap();

    let remaining = sqlx::query_scalar!(r#"SELECT entity_id FROM activity_events"#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, vec!["doc-kept".to_string()]);
}
