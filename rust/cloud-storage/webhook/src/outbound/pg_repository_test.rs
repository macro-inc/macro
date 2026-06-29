use super::*;
use crate::domain::ports::WebhookRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use sqlx::{PgPool, types::Uuid};

const USER_ID: &str = "macro|webhook-owner@example.com";
const TEAM_ID: &str = "11111111-1111-1111-1111-111111111111";

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(USER_ID.to_string()).expect("valid macro user id")
}

fn create_request() -> CreateWebhookRequest {
    CreateWebhookRequest {
        scope: crate::domain::models::WebhookScope::User,
        name: "Build events".to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        headers: None,
        rule: json!({ "events": ["build.created"] }),
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
        USER_ID.to_string(),
        create_request(),
        "signing-secret".to_string(),
        json!({ "X-Test": "true" }),
    )
    .await
    .expect("create webhook")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_inserts_webhook_with_rule(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let repo = PgRepository::new(pool.clone());

    let webhook = create_webhook(&repo).await;

    assert!(webhook.id.starts_with("wh_"));
    assert_eq!(webhook.rule, json!({ "events": ["build.created"] }));
    assert!(!webhook.is_valid);
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
    )
    .execute(&pool)
    .await?;

    assert!(repo.get_webhook(webhook.id).await?.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_user_team_workspace_id_returns_team_membership(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool).await?;
    let team_id = Uuid::parse_str(TEAM_ID)?;
    sqlx::query!(
        r#"INSERT INTO team (id, owner_id, name) VALUES ($1, $2, $3)"#,
        team_id,
        USER_ID,
        team_id.to_string(),
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        USER_ID,
        team_id
    )
    .execute(&pool)
    .await?;
    let repo = PgRepository::new(pool);

    assert_eq!(
        repo.get_user_team_workspace_id(user_id()).await?,
        Some(TEAM_ID.to_string())
    );
    Ok(())
}
