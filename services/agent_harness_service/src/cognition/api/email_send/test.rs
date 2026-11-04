use super::*;
use crate::cognition::api::context::test::{authorized_request, test_api_context};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use tower::ServiceExt;

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
    let body = axum::body::to_bytes(blank.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("requires the user's own message approving this email")
    );
}
