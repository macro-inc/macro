use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::generate_uuid_v7;
use serde_json::json;

use super::*;
use crate::domain::event_runs::{AdmissionResult, ConfigurationRevision, EventRunRepository};
use crate::domain::event_trigger::{EventReference, WebhookDelivery};
use crate::domain::webhooks::WebhookToken;
use crate::outbound::pg_event_run_repo::PgEventRunRepo;

const USER: &str = "macro|webhook-owner@macro.com";

async fn routine(pool: &PgPool) -> Uuid {
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2) ON CONFLICT DO NOTHING",
        generate_uuid_v7(),
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           SELECT $1, $1, id FROM macro_user WHERE email = $1 ON CONFLICT DO NOTHING"#,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    let id = generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO scheduled_action
            (id, owner, name, kind, task, enabled, trigger_type, event_filters, event_activated_at)
        VALUES ($1, $2, 'webhook test', 'Agent', '{}', true, 'events', $3, $4)
        "#,
        id,
        USER,
        json!([{ "events": ["webhook"] }]),
        Utc::now() - chrono::Duration::days(1),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_has_one_url_found_by_its_token(pool: PgPool) {
    let repo = PgRoutineWebhookRepo::new(pool.clone());
    let id = routine(&pool).await;
    let first = WebhookToken::generate();
    let second = WebhookToken::generate();

    let stored = repo
        .replace(id, first.hash(), first.prefix())
        .await
        .unwrap();
    assert_eq!(stored.routine_id, id);
    assert_eq!(stored.token_prefix, first.prefix());
    assert_eq!(repo.get(id).await.unwrap(), Some(stored));
    assert_eq!(repo.routine_for(first.hash()).await.unwrap(), Some(id));

    repo.replace(id, second.hash(), second.prefix())
        .await
        .unwrap();
    assert_eq!(repo.routine_for(first.hash()).await.unwrap(), None);
    assert_eq!(repo.routine_for(second.hash()).await.unwrap(), Some(id));
    assert_eq!(
        repo.get(id).await.unwrap().unwrap().token_prefix,
        second.prefix()
    );

    repo.delete(id).await.unwrap();
    assert_eq!(repo.get(id).await.unwrap(), None);
    assert_eq!(repo.routine_for(second.hash()).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_url_goes_with_its_routine(pool: PgPool) {
    let repo = PgRoutineWebhookRepo::new(pool.clone());
    let id = routine(&pool).await;
    let token = WebhookToken::generate();
    repo.replace(id, token.hash(), token.prefix())
        .await
        .unwrap();

    sqlx::query!("DELETE FROM scheduled_action WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(repo.routine_for(token.hash()).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_pending_webhook_deliveries_count_as_queued(pool: PgPool) {
    let repo = PgRoutineWebhookRepo::new(pool.clone());
    let runs = PgEventRunRepo::new(pool.clone());
    let id = routine(&pool).await;
    let delivery = |body: &str| {
        EventReference::webhook(WebhookDelivery::new(id, body.as_bytes(), None).unwrap())
    };
    for body in ["one", "two"] {
        assert_eq!(
            runs.admit(id, ConfigurationRevision::INITIAL, &delivery(body))
                .await
                .unwrap(),
            AdmissionResult::Admitted
        );
    }
    assert_eq!(repo.queued_deliveries(id).await.unwrap(), 2);

    let pending = runs.pending_runs(10.try_into().unwrap()).await.unwrap();
    runs.cancel_pending(
        pending[0].key(),
        ConfigurationRevision::INITIAL,
        crate::domain::event_runs::CancellationReason::Disabled,
    )
    .await
    .unwrap();
    assert_eq!(repo.queued_deliveries(id).await.unwrap(), 1);
    assert_eq!(repo.queued_deliveries(generate_uuid_v7()).await.unwrap(), 0);
}
