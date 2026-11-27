use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::FromRef;
use axum::http::{Request, StatusCode};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, MacroAuthJwtValidator,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
    NoUserApiKeyAuthorizer,
};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt as _;

use super::existing_users;
use crate::api::context::AuthorizationService;

const KEY: &str = "test-internal-key";

/// What the route takes: a database it never reaches here, and the internal
/// key it checks.
#[derive(Clone, FromRef)]
struct ExistingUsersState {
    db: PgPool,
    authorization_state: MacroAuthorizationState<AuthorizationService>,
}

fn api() -> Router {
    let db = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .expect("lazy pool");
    let authorization = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
        InternalAuthConfig {
            api_key: KEY.to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    existing_users().with_state(ExistingUsersState {
        db,
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization)),
    })
}

async fn send(method: &str) -> StatusCode {
    api()
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/get_existing_users")
                .header(INTERNAL_API_KEY_HEADER, KEY)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"user_ids": ["not a user id"]}"#))
                .expect("request"),
        )
        .await
        .expect("response")
        .status()
}

/// `AuthServiceClient::get_existing_users` sends a POST: it reaches the
/// handler, which refuses an id that is not a user id before it reads the
/// database.
#[tokio::test]
async fn a_post_reaches_the_existing_users_handler() {
    assert_eq!(send("POST").await, StatusCode::BAD_REQUEST);
    assert_eq!(send("GET").await, StatusCode::METHOD_NOT_ALLOWED);
}
