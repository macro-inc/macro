use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::generate_uuid_v7;

use super::*;

const USER: &str = "macro|webhook-owner@macro.com";

async fn routine(pool: &PgPool) -> Uuid {
    let id = generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO scheduled_action
            (id, owner, name, kind, task, enabled, trigger_type, event_filters, event_activated_at)
        VALUES ($1, $2, 'webhook test', 'Agent', '{}', true, 'events',
                '[{"events":["webhook.received"]}]', $3)
        "#,
        id,
        USER,
        Utc::now(),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_token_finds_its_routine_until_replaced_or_deleted(pool: PgPool) {
    let repo = PgRoutineWebhookRepo::new(pool.clone());
    let action_id = routine(&pool).await;

    repo.replace(action_id, "mrw_first", &[1; 32])
        .await
        .unwrap();
    assert_eq!(repo.find_action(&[1; 32]).await.unwrap(), Some(action_id));

    let replaced = repo
        .replace(action_id, "mrw_second", &[2; 32])
        .await
        .unwrap();
    assert_eq!(replaced.token_prefix, "mrw_second");
    assert_eq!(repo.find_action(&[1; 32]).await.unwrap(), None);
    assert_eq!(repo.find_action(&[2; 32]).await.unwrap(), Some(action_id));
    assert_eq!(repo.get(action_id).await.unwrap(), Some(replaced));

    repo.delete(action_id).await.unwrap();
    assert_eq!(repo.find_action(&[2; 32]).await.unwrap(), None);
    assert_eq!(repo.get(action_id).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_routine_deletes_its_url(pool: PgPool) {
    let repo = PgRoutineWebhookRepo::new(pool.clone());
    let action_id = routine(&pool).await;
    repo.replace(action_id, "mrw_first", &[1; 32])
        .await
        .unwrap();

    sqlx::query!("DELETE FROM scheduled_action WHERE id = $1", action_id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(repo.find_action(&[1; 32]).await.unwrap(), None);
}
