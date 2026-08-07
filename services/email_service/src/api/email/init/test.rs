use super::*;
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
fn unusable_provider_grants_classify_as_no_gmail_grant() {
    for error in [EmailApiError::AuthRequired, EmailApiError::Forbidden] {
        assert!(matches!(
            classify_provider_init_error(error),
            InitError::NoGmailGrant
        ));
    }
}

#[test]
fn rate_limiting_classifies_as_http_429() {
    let error = classify_provider_init_error(EmailApiError::RateLimited {
        retry_after: None,
        origin: email_api_client::domain::models::RateLimitOrigin::Provider,
    });
    assert_eq!(error.status_code(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn provider_diagnostics_are_not_returned_to_clients() {
    let response = InitError::ProviderError(EmailApiError::Permanent {
        message: "sanitized provider body".to_string(),
    })
    .into_response();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(bytes, "Email provider operation failed");
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
        InitError::ProviderError(EmailApiError::AuthRequired),
    ] {
        assert!(
            should_clean_up_in_progress_link(&err),
            "terminal failure {err:?} should clean up the in_progress row"
        );
    }
}
