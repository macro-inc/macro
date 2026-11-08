use axum::http::request::Builder;
use macro_authorization::{BOT_FOR_MACRO_USER_ID_HEADER, BOT_SCOPE_HEADER, BOT_TOKEN_HEADER};
use serde_json::{Value, json};

use super::*;

const ACTING_USER_ID: &str = "macro|acting@example.com";

fn create_router(non_user_owners: NonUserOwners) -> (Router, MockService) {
    let service = MockService::default();
    let router = chat_create_router(ChatRouterState::new(
        service.clone(),
        MockAccessService,
        authorization_state(),
        permissions_service(),
        non_user_owners,
    ));
    (router, service)
}

fn mock_create_router() -> Router {
    chat_create_router(ChatRouterState::new(
        MockService::default(),
        MockAccessService,
        authorization_state(),
        permissions_service(),
        NonUserOwners::Disabled,
    ))
    .layer(axum::middleware::map_request(attach_bearer))
}

fn create_request() -> Builder {
    Request::builder()
        .method("POST")
        .uri("/")
        .header(header::CONTENT_TYPE, "application/json")
}

fn with_jwt(builder: Builder) -> Builder {
    builder.header(header::AUTHORIZATION, "Bearer valid")
}

fn with_user_bot(builder: Builder) -> Builder {
    builder
        .header(BOT_TOKEN_HEADER, BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, "user")
        .header(BOT_FOR_MACRO_USER_ID_HEADER, ACTING_USER_ID)
}

fn with_team_bot(builder: Builder) -> Builder {
    builder
        .header(BOT_TOKEN_HEADER, BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, "team")
}

fn with_user_bot_without_acting_user(builder: Builder) -> Builder {
    builder
        .header(BOT_TOKEN_HEADER, BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, "user")
}

async fn send(router: Router, builder: Builder) -> (StatusCode, Value) {
    let request = builder
        .body(Body::from(json!({ "name": "My Chat" }).to_string()))
        .expect("request should build");
    let response = router
        .oneshot(request)
        .await
        .expect("router should respond");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body should be readable")
        .to_bytes();
    (
        status,
        serde_json::from_slice(&body).expect("body should be JSON"),
    )
}

fn user_owner(user_id: &str) -> Owner {
    Owner::User(
        MacroUserIdStr::try_from(user_id.to_string()).expect("test user id should be valid"),
    )
}

#[tokio::test]
async fn create_chat_returns_id() {
    let req = Request::builder()
        .method("POST")
        .uri("/")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "My Chat"}"#))
        .unwrap();

    let res = mock_create_router().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let response: StringIDResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(response.id, "test-chat-id");
}

#[tokio::test]
async fn create_chat_records_user_owner() {
    let (router, service) = create_router(NonUserOwners::Disabled);

    let response = send(router, with_jwt(create_request())).await;

    assert_eq!(response, (StatusCode::OK, json!({ "id": "test-chat-id" })));
    assert_eq!(
        service.created_owners(),
        vec![user_owner("macro|test@example.com")]
    );
}

#[tokio::test]
async fn create_chat_by_bot_acting_for_user_records_that_user() {
    let (router, service) = create_router(NonUserOwners::Disabled);

    let response = send(router, with_user_bot(create_request())).await;

    assert_eq!(response, (StatusCode::OK, json!({ "id": "test-chat-id" })));
    assert_eq!(service.created_owners(), vec![user_owner(ACTING_USER_ID)]);
}

#[tokio::test]
async fn create_chat_by_team_bot_records_bot_owner_when_enabled() {
    let (router, service) = create_router(NonUserOwners::Enabled);

    let response = send(router, with_team_bot(create_request())).await;

    assert_eq!(response, (StatusCode::OK, json!({ "id": "test-chat-id" })));
    assert_eq!(service.created_owners(), vec![Owner::Bot(BotId::TEST_A)]);
}

#[tokio::test]
async fn create_chat_by_team_bot_is_forbidden_when_disabled() {
    let (router, service) = create_router(NonUserOwners::Disabled);

    let response = send(router, with_team_bot(create_request())).await;

    assert_eq!(
        response,
        (StatusCode::FORBIDDEN, json!({ "message": "forbidden" }))
    );
    assert_eq!(service.created_owners(), Vec::<Owner>::new());
}

#[tokio::test]
async fn create_chat_by_user_bot_without_acting_user_is_forbidden() {
    let (router, service) = create_router(NonUserOwners::Enabled);

    let response = send(router, with_user_bot_without_acting_user(create_request())).await;

    assert_eq!(
        response,
        (StatusCode::FORBIDDEN, json!({ "message": "forbidden" }))
    );
    assert_eq!(service.created_owners(), Vec::<Owner>::new());
}
