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
