use std::time::Duration;

use axum::body::to_bytes;
use axum::http::StatusCode;
use axum::http::header::RETRY_AFTER;
use axum::response::Response;

use super::error_response;
use crate::ping::{AllowanceExceeded, PingError};

async fn message(response: Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    body["message"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_sender_without_the_flag_is_told_the_feature_is_not_enabled() {
    let response = error_response(PingError::NotEnabled);

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        message(response).await,
        "agent notifications are not enabled for this account"
    );
}

#[tokio::test]
async fn an_unreadable_flag_asks_the_sender_to_try_again_without_the_cause() {
    let response = error_response(PingError::FlagsUnavailable(rootcause::report!(
        "connection refused by flag provider"
    )));

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        message(response).await,
        "could not check whether agent notifications are enabled; try again"
    );
}

#[tokio::test]
async fn a_spent_allowance_says_when_to_try_again() {
    let response = error_response(PingError::AllowanceExceeded(AllowanceExceeded {
        limit: 1000,
        retry_after: Duration::from_secs(90),
    }));

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[RETRY_AFTER], "90");
}
