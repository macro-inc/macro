use super::*;
use anyhow::anyhow;

async fn body_json(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn no_gmail_grant_is_a_coded_400() {
    let response = InitError::NoGmailGrant.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_json(response).await;
    assert_eq!(body["code"], NO_GMAIL_GRANT_CODE);
}

#[tokio::test]
async fn already_initialized_is_a_coded_400() {
    let response = InitError::AlreadyInitialized.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_json(response).await;
    assert_eq!(body["code"], ALREADY_INITIALIZED_CODE);
}

#[test]
fn auth_service_not_found_classifies_as_no_gmail_grant() {
    let err = anyhow::Error::new(AuthServiceClientError::NotFound)
        .context("Failed to get Google access token from auth service");
    assert!(matches!(
        classify_token_fetch_error(err),
        InitError::NoGmailGrant
    ));
}

#[test]
fn other_token_fetch_failures_stay_bad_request() {
    for err in [
        anyhow!("connection refused"),
        anyhow::Error::new(AuthServiceClientError::Unauthorized),
    ] {
        assert!(matches!(
            classify_token_fetch_error(err),
            InitError::BadRequest(_)
        ));
    }
}

#[test]
fn watch_forbidden_classifies_as_no_gmail_grant() {
    assert!(matches!(
        classify_watch_error(GmailError::Forbidden),
        InitError::NoGmailGrant
    ));
}

#[test]
fn other_watch_failures_stay_gmail_errors() {
    for err in [
        GmailError::Unauthorized,
        GmailError::RateLimitExceeded,
        GmailError::ApiError("(500): boom".to_string()),
    ] {
        assert!(matches!(
            classify_watch_error(err),
            InitError::GmailError(_)
        ));
    }
}

async fn seed_macro_user(pool: &sqlx::PgPool) -> anyhow::Result<Uuid> {
    // in_progress_user_link.macro_user_id has a FK to macro_user(id); every test row
    // needs a parent user.
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'tester', 'tester@example.com', 'cus_test')",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(id)
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn failed_init_cleans_up_in_progress_link(pool: sqlx::PgPool) -> anyhow::Result<()> {
    let macro_user_id = seed_macro_user(&pool).await?;
    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &pool,
        &macro_user_id.to_string(),
    )
    .await?;

    cleanup_in_progress_link_on_failure(&pool, Some(link_id), &InitError::AlreadyInitialized).await;

    assert!(
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&pool, &link_id)
            .await
            .is_err(),
        "a terminal init failure should delete the in_progress_user_link row so it stops counting toward the start cap"
    );
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_inbox_conflict_keeps_in_progress_link(pool: sqlx::PgPool) -> anyhow::Result<()> {
    let macro_user_id = seed_macro_user(&pool).await?;
    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &pool,
        &macro_user_id.to_string(),
    )
    .await?;

    let conflict = InitError::SharedInboxConflict {
        email_address: "shared@example.com".to_string(),
        existing_owner_email: "owner@example.com".to_string(),
        existing_link_id: Uuid::new_v4(),
    };
    cleanup_in_progress_link_on_failure(&pool, Some(link_id), &conflict).await;

    assert!(
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&pool, &link_id)
            .await
            .is_ok(),
        "SharedInboxConflict must keep the in_progress_user_link row for the force_share retry"
    );
    Ok(())
}
