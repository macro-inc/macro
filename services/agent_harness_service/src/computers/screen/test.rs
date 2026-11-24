use axum::response::IntoResponse;
use computer_screen::domain::service::ScreenError;

use super::TicketError;

async fn body_of(error: ScreenError) -> (axum::http::StatusCode, serde_json::Value) {
    let response = TicketError(error).into_response();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .expect("a small body");
    (status, serde_json::from_slice(&bytes).expect("a JSON body"))
}

#[tokio::test]
async fn a_rate_limited_ticket_says_too_many_tickets() {
    let (status, body) = body_of(ScreenError::TooManyTickets).await;
    assert_eq!(status, axum::http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["code"], "too_many_tickets");
}

#[tokio::test]
async fn a_full_computer_says_too_many_screens() {
    let (status, body) = body_of(ScreenError::TooManySockets).await;
    assert_eq!(status, axum::http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["code"], "too_many_screens");
}
