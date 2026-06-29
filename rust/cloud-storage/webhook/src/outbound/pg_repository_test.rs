use super::*;
use crate::domain::ports::WebhookRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use sqlx::PgPool;

const USER_ID: &str = "macro|webhook-owner@example.com";
const UNKNOWN_WORKSPACE: &str = "workspace_unknown";

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(USER_ID.to_string()).expect("valid macro user id")
}

fn create_request() -> CreateWebhookRequest {
    CreateWebhookRequest {
        workspace_id: USER_ID.to_string(),
        name: "Build events".to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        headers: None,
        rule: json!({ "version": "v1", "events": ["build.created"] }),
    }
}

async fn insert_user(pool: &PgPool) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    let stripe_customer_id = format!("stripe_{macro_user_id}");
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
        macro_user_id,
        "webhook-owner@example.com",
        "webhook-owner@example.com",
        stripe_customer_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        USER_ID,
        "webhook-owner@example.com",
        macro_user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn create_webhook(repo: &PgRepository) -> Webhook {
    repo.create_webhook(
        user_id(),
        create_request(),
        "signing-secret".to_string(),
        json!({ "X-Test": "true" }),
    )
    .await
    .expect("create webhook")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_inserts_webhook_and_rule(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());

    let webhook = create_webhook(&repo).await;
    let rule_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM webhook_rule WHERE webhook_id = $1",
        webhook.id
    )
    .fetch_one(&pool)
    .await?
    .unwrap_or_default();

    assert!(webhook.id.starts_with("wh_"));
    assert!(webhook.rule.id.starts_with("whr_"));
    assert!(!webhook.is_valid);
    assert_eq!(rule_count, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_updates_endpoint_and_resets_validity(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let webhook = create_webhook(&repo).await;
    repo.set_webhook_validity(webhook.id.clone(), true).await?;

    let patched = repo
        .patch_webhook(
            webhook.id,
            PatchWebhookRequest {
                name: Some("Deploy events".to_string()),
                endpoint_url: Some("https://example.com/deploy".to_string()),
                headers: None,
                rule: None,
                status: None,
            },
        )
        .await?
        .expect("patched webhook");

    assert_eq!(patched.name, "Deploy events");
    assert_eq!(patched.endpoint_url, "https://example.com/deploy");
    assert!(!patched.is_valid);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_webhook_validity_marks_valid_and_invalid(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool);
    let webhook = create_webhook(&repo).await;

    let valid = repo
        .set_webhook_validity(webhook.id.clone(), true)
        .await?
        .expect("valid webhook");
    let invalid = repo
        .set_webhook_validity(webhook.id, false)
        .await?
        .expect("invalid webhook");

    assert!(valid.is_valid);
    assert!(!invalid.is_valid);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_webhook_excludes_deleted_rows(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());
    let webhook = create_webhook(&repo).await;

    sqlx::query!(
        "UPDATE webhook SET deleted_at = now() WHERE id = $1",
        webhook.id
    )        .execute(&pool)
        .await?;

    assert!(repo.get_webhook(webhook.id).await?.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unauthorized_workspace_check_returns_false_for_unknown_workspace(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool);

    assert!(
        repo.user_can_edit_workspace(user_id(), USER_ID.to_string())
            .await?
    );
    assert!(
        !repo
            .user_can_edit_workspace(user_id(), UNKNOWN_WORKSPACE.to_string())
            .await?
    );
    Ok(())
}
