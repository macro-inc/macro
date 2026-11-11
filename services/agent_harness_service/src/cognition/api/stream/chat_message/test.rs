use crate::cognition::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, authorized_request, test_api_context,
};
use crate::cognition::api::stream::chat_message::CHAT_READ_ONLY_MESSAGE;
use axum::http::StatusCode;
use http_body_util::BodyExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use tower::ServiceExt;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_send_is_refused_before_admission_or_storage(pool: sqlx::PgPool) {
    let chat_id = uuid::Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, $2, 'Old chat')"#,
        chat_id,
        ADMISSION_TEST_USER
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut state = (*test_api_context(pool.clone()).await).clone();
    let admission = TestAdmission::rejecting(ai_billing::AiAdmissionError::Unavailable);
    state.ai_admission = admission.clone();
    let router = crate::cognition::api::stream::router().with_state(state);

    // An owned chat, a chat that does not exist, and no chat at all.
    for chat_id in [
        serde_json::json!(chat_id),
        serde_json::json!(uuid::Uuid::now_v7().to_string()),
        serde_json::Value::Null,
    ] {
        let response = router
            .clone()
            .oneshot(authorized_request(
                "/chat/message",
                serde_json::json!({
                    "content": "hello",
                    "chat_id": chat_id,
                    "model": chat::domain::models::FREE_MODEL,
                }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::GONE);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "chat_read_only");
        assert_eq!(body["error"], CHAT_READ_ONLY_MESSAGE);
    }

    assert!(admission.calls.lock().unwrap().is_empty());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"Chat\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"ChatMessage\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}
