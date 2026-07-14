use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
    middleware::{self, Next},
    response::Response,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationServiceHandle, PreauthorizedContext,
    testing::{FakeMacroAuthorizationService, bearer_request, test_user_context},
};
use opensearch_client::OpensearchClient;
use readonly_pool::ReadOnlyPool;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use super::{context::SearchHandlerState, router};

const TEST_TOKEN: &str = "search-test-token";
const TEST_USER_ID: &str = "macro|search-test@example.com";
const SEARCH_ROUTES: [&str; 3] = ["/", "/simple", "/channel"];

fn test_state(authorization: FakeMacroAuthorizationService) -> SearchHandlerState {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/search-router-test")
        .expect("test database URL should be valid");
    let entity_access_service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    let opensearch_client = OpensearchClient::new(
        "http://localhost:9200".to_string(),
        "test-user".to_string(),
        "test-password".to_string(),
    )
    .expect("test OpenSearch URL should be valid");

    SearchHandlerState {
        db: ReadOnlyPool(pool),
        opensearch_client: Arc::new(opensearch_client),
        entity_access_service: Arc::new(entity_access_service),
        macro_authorization_service: MacroAuthorizationServiceHandle::new(authorization),
    }
}

fn malformed_json_request(path: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{"))
        .expect("test request should be valid")
}

async fn insert_preauthorized_context(mut request: Request<Body>, next: Next) -> Response {
    request
        .extensions_mut()
        .insert(PreauthorizedContext::new(test_user_context(TEST_USER_ID)));
    next.run(request).await
}

#[tokio::test]
async fn search_routes_authorize_bearer_credentials() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));
    let app = router().with_state(test_state(authorization.clone()));

    for path in SEARCH_ROUTES {
        let request = bearer_request(malformed_json_request(path), TEST_TOKEN);
        let response = app
            .clone()
            .oneshot(request)
            .await
            .expect("router call failed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "route {path}");
    }

    assert_eq!(authorization.calls(), vec![TEST_TOKEN; SEARCH_ROUTES.len()]);
}

#[tokio::test]
async fn search_routes_accept_preauthorized_context() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials);
    let app = router()
        .with_state(test_state(authorization.clone()))
        .layer(middleware::from_fn(insert_preauthorized_context));

    for path in SEARCH_ROUTES {
        let response = app
            .clone()
            .oneshot(malformed_json_request(path))
            .await
            .expect("router call failed");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "route {path}");
    }

    assert!(authorization.calls().is_empty());
}
