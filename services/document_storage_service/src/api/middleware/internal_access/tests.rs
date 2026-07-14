use axum::body::Body;
use axum::extract::FromRef;
use axum::http::header;
use axum::routing::get;
use axum::{Extension, Router};
use http_body_util::BodyExt;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationExtractor, MacroAuthorizationServiceHandle,
    PreauthorizedContext,
    testing::{FakeMacroAuthorizationService, test_user_context},
};
use tower::ServiceExt;

use super::*;

const TEST_AUTH_KEY: &str = "my-secret-value";
const INTERNAL_USER_ID: &str = "macro|internal-user@example.com";
const TOKEN_USER_ID: &str = "macro|token-user@example.com";

#[derive(Clone, FromRef)]
struct TestState {
    auth_key: DocumentStorageServiceAuthKey,
    authorization: MacroAuthorizationServiceHandle,
}

fn make_app() -> Router {
    Router::new().route("/", get(async || "hello world")).layer(
        axum::middleware::from_fn_with_state(
            DocumentStorageServiceAuthKey::Comptime(TEST_AUTH_KEY),
            handler,
        ),
    )
}

fn make_authorized_app(authorization: FakeMacroAuthorizationService) -> Router {
    let state = TestState {
        auth_key: DocumentStorageServiceAuthKey::Comptime(TEST_AUTH_KEY),
        authorization: MacroAuthorizationServiceHandle::new(authorization),
    };
    let app: Router<TestState> = Router::new()
        .route("/marker", get(marker_handler))
        .route("/identity", get(identity_handler))
        .route("/legacy-identity", get(legacy_identity_handler))
        .route("/internal-user", get(internal_user_handler));

    app.layer(axum::middleware::from_fn_with_state(state.clone(), handler))
        .with_state(state)
}

async fn marker_handler(Extension(_marker): Extension<PreauthorizedContext>) {}

async fn identity_handler(identity: MacroAuthorizationExtractor) -> String {
    identity.user_context.user_id
}

async fn legacy_identity_handler(req: Request) -> StatusCode {
    if req.extensions().get::<UserContext>().is_some() {
        StatusCode::INTERNAL_SERVER_ERROR
    } else {
        StatusCode::OK
    }
}

async fn internal_user_handler(Extension(internal_user): Extension<InternalUser>) -> StatusCode {
    if matches!(internal_user.access_level, AccessLevel::Owner) {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

async fn response_text(response: Response) -> String {
    let body = response
        .into_body()
        .collect()
        .await
        .expect("response body should be readable")
        .to_bytes();
    String::from_utf8(body.into()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn it_catches_missing_header() {
    let res = make_app()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    // we didn't provide the header value
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(text, InternalAccessErr::MissingHeader.to_string());
}

#[tokio::test]
async fn it_catches_non_ascii() {
    let header = "🦀🦀🦀🦀🦀🦀🦀🦀";
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert!(text.contains("Failed to parse"))
}

#[tokio::test]
async fn it_fails_with_invalid_header() {
    let header = "wrong_header";
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(
        text,
        InternalAccessErr::InvalidHeaderValue(header.to_string()).to_string()
    );
}

#[tokio::test]
async fn it_works_with_correct_header() {
    let header = TEST_AUTH_KEY;
    let res = make_app()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.into()).unwrap();
    assert_eq!(text, "hello world");
}

#[tokio::test]
async fn it_inserts_a_preauthorized_marker() {
    let app = make_authorized_app(FakeMacroAuthorizationService::default());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/marker")
                .header(
                    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                    TEST_AUTH_KEY,
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn it_does_not_insert_a_bare_user_context() {
    let app = make_authorized_app(FakeMacroAuthorizationService::default());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/legacy-identity")
                .header(
                    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                    TEST_AUTH_KEY,
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn it_propagates_marker_identity_to_authorization_extractors() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials);
    let app = make_authorized_app(authorization.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/identity")
                .header(
                    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                    TEST_AUTH_KEY,
                )
                .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, INTERNAL_USER_ID)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_text(response).await, INTERNAL_USER_ID);
    assert!(authorization.calls().is_empty());
}

#[tokio::test]
async fn marker_identity_takes_precedence_over_bearer_credentials() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TOKEN_USER_ID));
    let app = make_authorized_app(authorization.clone());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/identity")
                .header(
                    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                    TEST_AUTH_KEY,
                )
                .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, INTERNAL_USER_ID)
                .header(header::AUTHORIZATION, "Bearer valid-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_text(response).await, INTERNAL_USER_ID);
    assert!(authorization.calls().is_empty());
}

#[tokio::test]
async fn it_preserves_the_internal_user_marker() {
    let app = make_authorized_app(FakeMacroAuthorizationService::default());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/internal-user")
                .header(
                    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                    TEST_AUTH_KEY,
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
