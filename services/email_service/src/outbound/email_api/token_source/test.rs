use authentication_service_client::error::AuthServiceClientError;
use email_api_client::domain::models::{TokenError, TokenFreshness};
use email_api_client::domain::ports::ProviderTokenSource;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    StaticTokenSource, TokenHealthAction, clear_stale_reauth_flag, map_token_acquisition_error,
    token_health_action,
};

async fn insert_link_needing_reauth(pool: &PgPool) -> Uuid {
    let link_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider, needs_reauth
        )
        VALUES ($1, $2, $2, $3, 'GMAIL', true)
        "#,
        link_id,
        "macro|token-health@example.com",
        format!("token-health-{link_id}@example.com"),
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

async fn needs_reauth(pool: &PgPool, link_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT needs_reauth FROM email_links WHERE id = $1"#,
        link_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reauth_flagged_row_is_cleared_after_a_successful_fetch(pool: PgPool) {
    let link_id = insert_link_needing_reauth(&pool).await;

    clear_stale_reauth_flag(&pool, link_id).await;

    assert!(!needs_reauth(&pool, link_id).await);
}

/// Pins the full token-health decision table. The DB effects of each action
/// are covered by `clear_stale_reauth_flag` above and by email_db_client's
/// `set_needs_reauth_is_edge_triggered` (notify fires only on the false→true
/// transition, so repeat failures never re-enqueue).
#[test]
fn token_health_actions_cover_success_reauth_and_transient_outcomes() {
    // Success against a row that may be flagged clears the flag.
    assert_eq!(
        token_health_action(&Ok("token".to_string()), true),
        TokenHealthAction::ClearReauth
    );
    // Success against a known-healthy row skips the redundant UPDATE.
    assert_eq!(
        token_health_action(&Ok("token".to_string()), false),
        TokenHealthAction::None
    );
    // A revoked or missing grant marks the link for reauthorization.
    assert_eq!(
        token_health_action(
            &Err(anyhow::Error::new(AuthServiceClientError::Forbidden)),
            true,
        ),
        TokenHealthAction::MarkReauth
    );
    assert_eq!(
        token_health_action(
            &Err(anyhow::Error::new(AuthServiceClientError::NotFound)),
            false,
        ),
        TokenHealthAction::MarkReauth
    );
    // Transient infrastructure failures leave health untouched.
    assert_eq!(
        token_health_action(&Err(anyhow::anyhow!("redis unavailable")), true),
        TokenHealthAction::None
    );
}

#[test]
fn forbidden_auth_service_response_requires_reauthorization() {
    let error = anyhow::Error::new(AuthServiceClientError::Forbidden)
        .context("failed to acquire provider token");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::ReauthRequired
    );
}

#[test]
fn missing_auth_service_grant_requires_reauthorization() {
    let error = anyhow::Error::new(AuthServiceClientError::NotFound)
        .context("failed to acquire provider token");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::ReauthRequired
    );
}

#[test]
fn infrastructure_failure_is_transient_and_sanitized() {
    let error = anyhow::anyhow!("redis unavailable at redis://user:secret@example.test");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::Transient {
            message: "email provider access token is temporarily unavailable".to_string(),
        }
    );
}

#[tokio::test]
async fn static_source_returns_token_for_both_freshness_modes() {
    let source = StaticTokenSource::new("access-token");
    let link_id = Uuid::new_v4();

    for freshness in [TokenFreshness::Cached, TokenFreshness::Fresh] {
        let token = source
            .get_access_token(link_id, freshness)
            .await
            .expect("static token should be available");
        assert_eq!(token.expose_secret(), "access-token");
    }
}
