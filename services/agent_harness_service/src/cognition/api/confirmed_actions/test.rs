use super::*;
use crate::cognition::api::context::test::{authorized_request, test_api_context};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use tower::ServiceExt;

async fn message(response: Response) -> String {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    body["message"].as_str().unwrap().to_owned()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_email_without_the_users_approval_is_never_sent(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    let router = Router::new()
        .route("/email/send-confirmed", post(send_confirmed_email))
        .with_state((*ctx).clone());
    let email = json!({
        "subject": "Q3 numbers",
        "body": "Attached.",
        "to": [{"email": "ada@example.com"}],
    });

    let unquoted = router
        .clone()
        .oneshot(authorized_request("/email/send-confirmed", email.clone()))
        .await
        .unwrap();
    assert_eq!(unquoted.status(), StatusCode::BAD_REQUEST);

    let mut blank = email;
    blank["userConfirmation"] = json!("  ");
    let blank = router
        .oneshot(authorized_request("/email/send-confirmed", blank))
        .await
        .unwrap();
    assert_eq!(blank.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        message(blank)
            .await
            .contains("requires the user's own message approving this email")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_without_the_users_approval_is_never_created(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    let router = Router::new()
        .route(
            "/calendar/events/create-confirmed",
            post(create_confirmed_calendar_event),
        )
        .with_state((*ctx).clone());
    let event = json!({
        "title": "Q3 review",
        "time": {
            "kind": "timed",
            "startsAt": "2026-11-10T15:00:00Z",
            "endsAt": "2026-11-10T15:30:00Z",
        },
    });

    let unquoted = router
        .clone()
        .oneshot(authorized_request(
            "/calendar/events/create-confirmed",
            event.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(unquoted.status(), StatusCode::BAD_REQUEST);

    let mut blank = event;
    blank["userConfirmation"] = json!("");
    let blank = router
        .oneshot(authorized_request(
            "/calendar/events/create-confirmed",
            blank,
        ))
        .await
        .unwrap();
    assert_eq!(blank.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        message(blank)
            .await
            .contains("requires the user's own message approving this event")
    );
}
