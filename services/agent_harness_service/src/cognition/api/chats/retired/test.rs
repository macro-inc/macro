use crate::cognition::api::context::test::{
    ADMISSION_TEST_USER, authorized_request, test_api_context,
};
use crate::cognition::api::stream::chat_message::CHAT_READ_ONLY_MESSAGE;
use axum::http::StatusCode;
use http_body_util::BodyExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use tower::ServiceExt;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_is_refused_as_read_only(pool: sqlx::PgPool) {
    let state = (*test_api_context(pool.clone()).await).clone();
    let router = crate::cognition::api::chats::router(state.clone()).with_state(state);

    let response = router
        .oneshot(authorized_request(
            "/",
            serde_json::json!({ "name": "New chat", "model": chat::domain::models::FREE_MODEL }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::GONE);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["code"], "chat_read_only");
    assert_eq!(body["error"], CHAT_READ_ONLY_MESSAGE);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"Chat\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn copy_is_refused_as_read_only(pool: sqlx::PgPool) {
    let chat_id = uuid::Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, $2, 'Old chat')"#,
        chat_id,
        ADMISSION_TEST_USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let state = (*test_api_context(pool.clone()).await).clone();
    let router = crate::cognition::api::chats::router(state.clone()).with_state(state);

    let response = router
        .oneshot(authorized_request(
            &format!("/{chat_id}/copy"),
            serde_json::json!({}),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::GONE);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["code"], "chat_read_only");
    assert_eq!(body["error"], CHAT_READ_ONLY_MESSAGE);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"Chat\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
}
