use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::extract::FromRef;
use axum::http::Request;
use axum::http::StatusCode;
use axum::routing::get;
use http_body_util::BodyExt;
use macro_auth::headers::{AccessTokenCookieExtractor, AccessTokenExtractor};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::util::ServiceExt;

use super::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// These must match the empty values from JwtValidationArgs::new_testing()
const TEST_SECRET: &str = "";
const TEST_AUDIENCE: &str = "";
const TEST_ISSUER: &str = "";

fn test_args() -> JwtValidationArgs {
    JwtValidationArgs::new_testing()
}

fn create_access_token(
    audience: &str,
    issuer: &str,
    email: &str,
    secret: &str,
    exp: usize,
) -> String {
    let claims = serde_json::json!({
        "aud": audience,
        "exp": exp,
        "iss": issuer,
        "tid": "tenant_id",
        "email": email,
        "fusion_user_id": "fusion_testing",
        "macro_user_id": format!("macro|{email}"),
        "macro_organization_id": 1,
    });

    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
    header.kid = Some("fromFusionauth".to_string());
    jsonwebtoken::encode(
        &header,
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_ref()),
    )
    .unwrap()
}

fn valid_token() -> String {
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3600;
    create_access_token(
        TEST_AUDIENCE,
        TEST_ISSUER,
        "user@test.com",
        TEST_SECRET,
        exp,
    )
}

fn expired_token() -> String {
    create_access_token(
        TEST_AUDIENCE,
        TEST_ISSUER,
        "user@test.com",
        TEST_SECRET,
        1000,
    )
}

fn no_params() -> Params {
    Params {
        macro_api_token: None,
    }
}

/// Wrap a raw token string in an AccessTokenExtractor via the Cookie variant.
fn extractor_from_token(token: &str) -> Result<AccessTokenExtractor, StatusCode> {
    Ok(AccessTokenExtractor::Cookie(AccessTokenCookieExtractor(
        cookie::Cookie::new("token", token.to_string()),
    )))
}

fn no_extractor() -> Result<AccessTokenExtractor, StatusCode> {
    Err(StatusCode::UNAUTHORIZED)
}

/// Confirm that axum's `Query<Params>` (which uses `serde_urlencoded`) decodes
/// percent-encoded values the same way the old `url::form_urlencoded::parse` did.
#[test]
fn query_extractor_decodes_percent_encoded_token() {
    let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
    let encoded = format!("macro-api-token={}", urlencoding::encode(token));

    let params: Params = serde_urlencoded::from_str(&encoded).unwrap();
    assert_eq!(params.macro_api_token.as_deref(), Some(token));
}

/// The old code collected into a `HashMap<String, String>` via
/// `url::form_urlencoded::parse`. Confirm `serde_urlencoded` produces the same
/// result for a realistic JWT value that contains dots (which are not special in
/// percent-encoding but are worth checking).
#[test]
fn query_extractor_matches_form_urlencoded_parse() {
    let token = "header.payload.signature";
    let query = format!("macro-api-token={token}&other=value");

    // Old approach
    let old: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    // New approach
    let new: Params = serde_urlencoded::from_str(&query).unwrap();

    assert_eq!(
        old.get("macro-api-token").unwrap(),
        new.macro_api_token.as_ref().unwrap()
    );
}

/// Percent-encoded special characters (e.g. `%2B` for `+`) must be decoded.
#[test]
fn query_extractor_decodes_special_characters() {
    let query = "macro-api-token=a%2Bb%3Dc";

    let old: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    let new: Params = serde_urlencoded::from_str(query).unwrap();

    assert_eq!(old.get("macro-api-token").unwrap(), "a+b=c");
    assert_eq!(new.macro_api_token.as_deref(), Some("a+b=c"));
}

// ---------------------------------------------------------------------------
// DecodedJwt::new tests
// ---------------------------------------------------------------------------

#[test]
fn no_token_and_no_query_param_returns_no_token() {
    let args = test_args();
    let result = DecodedJwt::new(no_extractor(), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::NoToken)));
}

#[test]
fn invalid_token_in_header_returns_invalid() {
    let args = test_args();
    let result = DecodedJwt::new(extractor_from_token("not.a.valid.jwt"), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::Invalid(_))));
}

#[test]
fn expired_token_returns_expired() {
    let args = test_args();
    let token = expired_token();
    let result = DecodedJwt::new(extractor_from_token(&token), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::Expired)));
}

#[test]
fn valid_token_in_header_returns_decoded_jwt() {
    let args = test_args();
    let token = valid_token();
    let jwt = DecodedJwt::new(extractor_from_token(&token), no_params(), &args).unwrap();

    assert_eq!(jwt.user_context.user_id, "macro|user@test.com");
    assert_eq!(jwt.user_context.organization_id, Some(1));
    assert!(jwt.jwt_context.is_some());
    assert_eq!(jwt.jwt_context.unwrap().audience, TEST_AUDIENCE);
    assert_eq!(jwt.macro_user_id.as_ref(), "macro|user@test.com");
}

#[test]
fn valid_token_via_query_param_returns_decoded_jwt() {
    let args = test_args();
    let token = valid_token();
    let params = Params {
        macro_api_token: Some(token),
    };
    // Even with no header extractor, query param should work
    let jwt = DecodedJwt::new(no_extractor(), params, &args).unwrap();

    assert_eq!(jwt.user_context.user_id, "macro|user@test.com");
}

#[test]
fn query_param_takes_precedence_over_header() {
    let args = test_args();
    let good_token = valid_token();
    let params = Params {
        macro_api_token: Some(good_token),
    };
    // Header has garbage, but query param has a valid token — query wins
    let jwt = DecodedJwt::new(extractor_from_token("garbage"), params, &args).unwrap();

    assert_eq!(jwt.user_context.user_id, "macro|user@test.com");
}

#[test]
fn wrong_secret_returns_invalid() {
    let args = test_args();
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3600;
    let token = create_access_token(
        TEST_AUDIENCE,
        TEST_ISSUER,
        "user@test.com",
        "wrong_key",
        exp,
    );
    let result = DecodedJwt::new(extractor_from_token(&token), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::Invalid(_))));
}

#[test]
fn wrong_audience_returns_invalid() {
    let args = test_args();
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3600;
    let token = create_access_token(
        "wrong_audience",
        TEST_ISSUER,
        "user@test.com",
        TEST_SECRET,
        exp,
    );
    let result = DecodedJwt::new(extractor_from_token(&token), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::Invalid(_))));
}

#[test]
fn wrong_issuer_returns_invalid() {
    let args = test_args();
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3600;
    let token = create_access_token(
        TEST_AUDIENCE,
        "wrong.issuer.com",
        "user@test.com",
        TEST_SECRET,
        exp,
    );
    let result = DecodedJwt::new(extractor_from_token(&token), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::Invalid(_))));
}

#[test]
fn invalid_macro_user_id_in_token_returns_invalid_user_id() {
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3600;

    // Build a token whose macro_user_id lacks the required "macro|" prefix
    let claims = serde_json::json!({
        "aud": TEST_AUDIENCE,
        "exp": exp,
        "iss": TEST_ISSUER,
        "tid": "tenant_id",
        "email": "user@test.com",
        "fusion_user_id": "fusion_testing",
        "macro_user_id": "no_pipe_prefix",
    });

    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
    header.kid = Some("fromFusionauth".to_string());
    let token = jsonwebtoken::encode(
        &header,
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_ref()),
    )
    .unwrap();

    let args = test_args();
    let result = DecodedJwt::new(extractor_from_token(&token), no_params(), &args);
    assert!(matches!(result, Err(DecodeJwtError::InvalidUserId(_))));
}

// ---------------------------------------------------------------------------
// Router integration tests — exercises FromRequestParts via real HTTP
// ---------------------------------------------------------------------------

/// State that satisfies `JwtValidationArgs: FromRef<S>` for the DecodedJwt extractor.
#[derive(Clone)]
struct TestState {
    jwt_args: JwtValidationArgs,
}

impl FromRef<TestState> for JwtValidationArgs {
    fn from_ref(state: &TestState) -> Self {
        state.jwt_args.clone()
    }
}

/// A handler that requires DecodedJwt and returns the extracted user id.
async fn echo_user(jwt: DecodedJwt) -> String {
    jwt.user_context.user_id
}

fn test_router() -> Router {
    let state = TestState {
        jwt_args: test_args(),
    };
    Router::new()
        .route("/protected", get(echo_user))
        .with_state(state)
}

async fn response_status(router: &Router, req: Request<axum::body::Body>) -> StatusCode {
    router.clone().oneshot(req).await.unwrap().status()
}

async fn response_body(router: &Router, req: Request<axum::body::Body>) -> String {
    let resp = router.clone().oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8_lossy(&body).to_string()
}

/// The access token cookie name used in Production environment (the default).
const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";

#[tokio::test]
async fn router_no_token_returns_401() {
    let router = test_router();
    let req = Request::get("/protected")
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_invalid_bearer_returns_401() {
    let router = test_router();
    let req = Request::get("/protected")
        .header("authorization", "Bearer not.a.valid.jwt")
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_expired_bearer_returns_401() {
    let router = test_router();
    let token = expired_token();
    let req = Request::get("/protected")
        .header("authorization", format!("Bearer {token}"))
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_valid_bearer_returns_200() {
    let router = test_router();
    let token = valid_token();
    let req = Request::get("/protected")
        .header("authorization", format!("Bearer {token}"))
        .body(axum::body::Body::empty())
        .unwrap();
    let body = response_body(&router, req).await;
    assert_eq!(body, "macro|user@test.com");
}

#[tokio::test]
async fn router_valid_cookie_returns_200() {
    let router = test_router();
    let token = valid_token();
    let req = Request::get("/protected")
        .header("cookie", format!("{ACCESS_TOKEN_COOKIE}={token}"))
        .body(axum::body::Body::empty())
        .unwrap();
    let body = response_body(&router, req).await;
    assert_eq!(body, "macro|user@test.com");
}

#[tokio::test]
async fn router_invalid_cookie_returns_401() {
    let router = test_router();
    let req = Request::get("/protected")
        .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=garbage.token"))
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_valid_query_param_returns_200() {
    let router = test_router();
    let token = valid_token();
    let uri = format!("/protected?macro-api-token={token}");
    let req = Request::get(&uri).body(axum::body::Body::empty()).unwrap();
    let body = response_body(&router, req).await;
    assert_eq!(body, "macro|user@test.com");
}

#[tokio::test]
async fn router_invalid_query_param_returns_401() {
    let router = test_router();
    let req = Request::get("/protected?macro-api-token=garbage")
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_query_param_takes_precedence_over_bearer() {
    let router = test_router();
    let good_token = valid_token();
    let uri = format!("/protected?macro-api-token={good_token}");
    // Bearer header is garbage, but query param is valid — query wins
    let req = Request::get(&uri)
        .header("authorization", "Bearer garbage.token")
        .body(axum::body::Body::empty())
        .unwrap();
    let body = response_body(&router, req).await;
    assert_eq!(body, "macro|user@test.com");
}

#[tokio::test]
async fn router_bearer_takes_precedence_over_cookie() {
    let router = test_router();
    let token = valid_token();
    // Both Bearer header and cookie present — Bearer wins (Either::E1 in AccessTokenExtractor)
    let req = Request::get("/protected")
        .header("authorization", format!("Bearer {token}"))
        .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=garbage"))
        .body(axum::body::Body::empty())
        .unwrap();
    let body = response_body(&router, req).await;
    assert_eq!(body, "macro|user@test.com");
}

#[tokio::test]
async fn router_wrong_cookie_name_returns_401() {
    let router = test_router();
    let token = valid_token();
    // Cookie name doesn't match the expected access token cookie
    let req = Request::get("/protected")
        .header("cookie", format!("wrong-cookie-name={token}"))
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(
        response_status(&router, req).await,
        StatusCode::UNAUTHORIZED
    );
}
