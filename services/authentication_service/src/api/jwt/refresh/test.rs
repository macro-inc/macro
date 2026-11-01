use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header::AUTHORIZATION},
    routing::post,
};
use fusionauth::FusionAuthClient;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use macro_auth::{constant::MACRO_REFRESH_TOKEN_HEADER, middleware::decode_jwt::JwtValidationArgs};
use model::response::UserTokensResponse;
use tower::{ServiceBuilder, ServiceExt};
use tower_cookies::CookieManagerLayer;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::handler;
use crate::api::middleware::extract_tokens;

const REFRESH_TOKEN: &str = "refresh-token";
const TEN_MINUTES: u64 = 600;
const TWO_HOURS: u64 = 7200;

#[derive(Clone, FromRef)]
struct RefreshState {
    auth_client: Arc<FusionAuthClient>,
    jwt: JwtValidationArgs,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// What FusionAuth issues for `JwtValidationArgs::new_testing()` when the JWT populate lambda
/// fails.
fn claims_without_macro_claims(issued_at: u64) -> serde_json::Value {
    serde_json::json!({
        "aud": "", "exp": issued_at + 3600, "iat": issued_at, "iss": "", "sub": "fusion-user",
        "tid": "tenant", "applicationId": "", "roles": [],
    })
}

fn claims_with_macro_claims(issued_at: u64) -> serde_json::Value {
    let mut claims = claims_without_macro_claims(issued_at);
    claims["email"] = "user@example.com".into();
    claims["fusion_user_id"] = "fusion-user".into();
    claims["macro_user_id"] = "macro|user@example.com".into();
    claims
}

fn sign(secret: &[u8], claims: &serde_json::Value) -> String {
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("fusionauth-key".into());
    encode(&header, claims, &EncodingKey::from_secret(secret)).unwrap()
}

fn refreshed() -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(serde_json::json!({
        "token": "new-access-token",
        "refreshToken": "new-refresh-token",
        "refreshTokenId": "refresh-token-id",
    }))
}

/// FusionAuth's `/api/jwt/refresh`, which must be called exactly `calls` times.
async fn fusionauth(response: ResponseTemplate, calls: u64) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/jwt/refresh"))
        .respond_with(response)
        .expect(calls)
        .mount(&server)
        .await;
    server
}

async fn post_refresh(fusionauth: &MockServer, access_token: &str) -> (StatusCode, String) {
    let auth_client = FusionAuthClient::new(
        "api-key".into(),
        "client-id".into(),
        "client-secret".into(),
        fusionauth.uri(),
        "http://localhost/oauth/redirect".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );
    let response = Router::new()
        .route(
            "/jwt/refresh",
            post(handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(extract_tokens::handler))
                    .layer(CookieManagerLayer::new()),
            ),
        )
        .with_state(RefreshState {
            auth_client: Arc::new(auth_client),
            jwt: JwtValidationArgs::new_testing(),
        })
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/jwt/refresh")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header(MACRO_REFRESH_TOKEN_HEADER, REFRESH_TOKEN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn token_without_macro_claims_is_refreshed() {
    let fusionauth = fusionauth(refreshed(), 3).await;
    let issued_ats = [now() - 45, now() - TEN_MINUTES, now() - TWO_HOURS];

    for issued_at in issued_ats {
        let access_token = sign(b"", &claims_without_macro_claims(issued_at));
        let (status, body) = post_refresh(&fusionauth, &access_token).await;

        assert_eq!(status, StatusCode::OK, "issued at {issued_at}");
        let tokens: UserTokensResponse = serde_json::from_str(&body).unwrap();
        assert_eq!(tokens.access_token, "new-access-token");
        assert_eq!(tokens.refresh_token, "new-refresh-token");
    }
}

#[tokio::test]
async fn token_without_macro_claims_is_not_refreshed_within_the_cooldown() {
    let fusionauth = fusionauth(refreshed(), 0).await;
    // The last one was issued by a FusionAuth whose clock is ahead of ours.
    let issued_ats = [now(), now() - 15, now() + 60];

    for issued_at in issued_ats {
        let access_token = sign(b"", &claims_without_macro_claims(issued_at));

        assert_eq!(
            post_refresh(&fusionauth, &access_token).await,
            (
                StatusCode::TOO_MANY_REQUESTS,
                "access token without macro claims was issued too recently to refresh".into()
            ),
            "issued at {issued_at}"
        );
    }
}

#[tokio::test]
async fn token_not_issued_for_this_application_is_rejected_without_calling_fusionauth() {
    let fusionauth = fusionauth(refreshed(), 0).await;
    let issued_at = now() - TEN_MINUTES;
    let mut other_audience = claims_without_macro_claims(issued_at);
    other_audience["aud"] = "other-app".into();
    let mut other_issuer = claims_without_macro_claims(issued_at);
    other_issuer["iss"] = "other.issuer.test".into();
    let cases = [
        (
            "signed with another secret",
            sign(b"other-secret", &claims_without_macro_claims(issued_at)),
        ),
        (
            "signed with another secret within the cooldown",
            sign(b"other-secret", &claims_without_macro_claims(now())),
        ),
        (
            "signed with another secret with the macro claims",
            sign(b"other-secret", &claims_with_macro_claims(issued_at)),
        ),
        ("another audience", sign(b"", &other_audience)),
        ("another issuer", sign(b"", &other_issuer)),
        ("not a JWT", "not-a-jwt".into()),
    ];

    for (case, access_token) in cases {
        assert_eq!(
            post_refresh(&fusionauth, &access_token).await,
            (StatusCode::UNAUTHORIZED, "unauthorized".into()),
            "{case}"
        );
    }
}

#[tokio::test]
async fn valid_token_is_returned_without_calling_fusionauth() {
    let fusionauth = fusionauth(refreshed(), 0).await;
    let access_token = sign(b"", &claims_with_macro_claims(now() - TEN_MINUTES));

    let (status, body) = post_refresh(&fusionauth, &access_token).await;

    assert_eq!(status, StatusCode::OK);
    let tokens: UserTokensResponse = serde_json::from_str(&body).unwrap();
    assert_eq!(tokens.access_token, access_token);
    assert_eq!(tokens.refresh_token, REFRESH_TOKEN);
}

#[tokio::test]
async fn expired_token_is_refreshed() {
    let fusionauth = fusionauth(refreshed(), 1).await;
    let access_token = sign(b"", &claims_with_macro_claims(now() - TWO_HOURS));

    let (status, body) = post_refresh(&fusionauth, &access_token).await;

    assert_eq!(status, StatusCode::OK);
    let tokens: UserTokensResponse = serde_json::from_str(&body).unwrap();
    assert_eq!(tokens.access_token, "new-access-token");
}

#[tokio::test]
async fn fusionauth_failures_on_refreshing_a_token_without_macro_claims_are_reported() {
    let access_token = sign(b"", &claims_without_macro_claims(now() - TEN_MINUTES));
    let refresh_token_rejected = fusionauth(
        ResponseTemplate::new(400)
            .set_body_string("The refresh token was not found or has expired."),
        1,
    )
    .await;
    let unavailable = fusionauth(ResponseTemplate::new(500), 1).await;

    assert_eq!(
        post_refresh(&refresh_token_rejected, &access_token).await,
        (StatusCode::BAD_REQUEST, "invalid refresh token".into())
    );
    assert_eq!(
        post_refresh(&unavailable, &access_token).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal server error".into()
        )
    );
}
