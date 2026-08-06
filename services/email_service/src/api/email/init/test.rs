use super::*;
use anyhow::anyhow;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

async fn insert_email_link(pool: &PgPool) -> Uuid {
    let link_id = Uuid::now_v7();
    let email_address = format!("sso-grant-{link_id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|sso-grant@example.com",
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

async fn body_json(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn zero_grant_is_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    sqlx::query!(
        "INSERT INTO email_link_google_scopes (link_id) VALUES ($1)",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_side_table_state_is_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;

    assert!(has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recorded_side_table_grant_is_not_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    sqlx::query!(
        "INSERT INTO email_link_google_scopes (link_id, grant_version) VALUES ($1, 1)",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_email_link_is_not_unrecorded(pool: PgPool) {
    assert!(!has_unrecorded_google_grant(&pool, Uuid::now_v7()).await);
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

#[test]
fn only_shared_inbox_conflict_keeps_the_in_progress_link() {
    // SharedInboxConflict is held open for the force_share retry, so its row must be kept;
    // every other terminal failure must clean up the row so it stops counting toward the
    // /link/gmail start cap. The delete itself is covered by macro_db_client's own tests.
    assert!(
        !should_clean_up_in_progress_link(&InitError::SharedInboxConflict {
            email_address: "shared@example.com".to_string(),
            existing_owner_email: "owner@example.com".to_string(),
            existing_link_id: Uuid::new_v4(),
        }),
        "SharedInboxConflict must keep the row for the force_share retry"
    );

    for err in [
        InitError::AlreadyInitialized,
        InitError::NoGmailGrant,
        InitError::EnqueueError,
        InitError::BadRequest("bad".to_string()),
        InitError::GmailError(GmailError::Unauthorized),
    ] {
        assert!(
            should_clean_up_in_progress_link(&err),
            "terminal failure {err:?} should clean up the in_progress row"
        );
    }
}
