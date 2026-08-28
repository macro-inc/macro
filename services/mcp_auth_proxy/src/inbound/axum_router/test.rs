//! Drives the reported attack and the legitimate flow over the real router, so
//! the checks are exercised through the same HTTP surface an attacker uses.

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::oauth_router;
use crate::test_support::{
    ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, Harness, TRUSTED_REDIRECT_URI,
    UPSTREAM_ACCESS_TOKEN, VICTIM_CODE_VERIFIER, code_challenge_for, query_param,
};

const BODY_LIMIT: usize = 64 * 1024;

struct Response {
    status: StatusCode,
    location: Option<String>,
    body: String,
}

impl Response {
    fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).expect("response body should be JSON")
    }
}

async fn send(harness: &Harness, request: Request<Body>) -> Response {
    let response = oauth_router(harness.service.clone())
        .oneshot(request)
        .await
        .expect("router should respond");

    let status = response.status();
    let location = response
        .headers()
        .get(header::LOCATION)
        .map(|value| value.to_str().expect("Location is text").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .expect("body should be readable");

    Response {
        status,
        location,
        body: String::from_utf8(bytes.to_vec()).expect("body should be UTF-8"),
    }
}

fn register_request(redirect_uri: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/register")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(
            r#"{{"client_name":"test-client","redirect_uris":["{redirect_uri}"]}}"#
        )))
        .expect("request should build")
}

fn authorize_request(client_id: &str, redirect_uri: &str, code_verifier: &str) -> Request<Body> {
    let redirect_uri = urlencoding::encode(redirect_uri);
    let code_challenge = code_challenge_for(code_verifier);
    Request::builder()
        .method("GET")
        .uri(format!(
            "/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}\
             &state=client-state&code_challenge={code_challenge}&code_challenge_method=S256"
        ))
        .body(Body::empty())
        .expect("request should build")
}

fn token_request(form: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/token")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from(form.to_owned()))
        .expect("request should build")
}

fn callback_request(session_id: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(format!(
            "/oauth/callback?code=upstream-code&state={session_id}"
        ))
        .body(Body::empty())
        .expect("request should build")
}

/// The attack from the report, over HTTP: the attacker cannot register their
/// own callback, and cannot smuggle it onto an authorize request belonging to a
/// client that is registered. No code reaches them, so there is nothing to
/// exchange.
#[tokio::test]
async fn attacker_cannot_have_a_code_delivered_to_their_own_callback() {
    let harness = Harness::new();

    let registration = send(&harness, register_request(ATTACKER_REDIRECT_URI)).await;
    assert_eq!(registration.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        registration.body,
        "redirect_uri must be a loopback address or a trusted MCP client host"
    );

    let victim_registration = send(&harness, register_request(TRUSTED_REDIRECT_URI)).await;
    assert_eq!(victim_registration.status, StatusCode::CREATED);
    let client_id = victim_registration.json()["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned();

    let crafted = send(
        &harness,
        authorize_request(&client_id, ATTACKER_REDIRECT_URI, ATTACKER_CODE_VERIFIER),
    )
    .await;

    assert_eq!(crafted.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        crafted.location, None,
        "a rejected authorize request must not redirect anywhere"
    );
    assert!(
        !harness.inflight.has_pending(),
        "a rejected authorize request must not create handshake state"
    );
}

#[tokio::test]
async fn authorize_rejects_an_unregistered_client_id() {
    let harness = Harness::new();

    let response = send(
        &harness,
        authorize_request(
            "not-a-registered-client",
            TRUSTED_REDIRECT_URI,
            VICTIM_CODE_VERIFIER,
        ),
    )
    .await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.body, "unknown client_id");
}

/// The flow a real MCP client drives, from registration through to a bearer
/// token, so the added checks are shown not to break it.
#[tokio::test]
async fn registered_client_completes_the_whole_flow() {
    let harness = Harness::new();

    let registration = send(&harness, register_request(TRUSTED_REDIRECT_URI)).await;
    assert_eq!(registration.status, StatusCode::CREATED);
    let registration_body = registration.json();
    let client_id = registration_body["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned();
    assert_eq!(
        registration_body["redirect_uris"][0].as_str(),
        Some(TRUSTED_REDIRECT_URI)
    );

    let authorize = send(
        &harness,
        authorize_request(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    assert_eq!(authorize.status, StatusCode::TEMPORARY_REDIRECT);
    let upstream = authorize.location.expect("authorize redirects upstream");
    assert!(
        upstream.starts_with("https://upstream.example/authorize"),
        "unexpected upstream redirect: {upstream}"
    );

    let session_id = harness.inflight.only_pending_session_id();
    let callback = send(&harness, callback_request(&session_id)).await;
    assert_eq!(callback.status, StatusCode::TEMPORARY_REDIRECT);
    let client_redirect = callback.location.expect("callback redirects to the client");
    assert!(
        client_redirect.starts_with(TRUSTED_REDIRECT_URI),
        "code was delivered somewhere unexpected: {client_redirect}"
    );
    let code = query_param(&client_redirect, "code").expect("redirect carries a code");

    let exchange = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={}&client_id={client_id}",
            urlencoding::encode(TRUSTED_REDIRECT_URI)
        )),
    )
    .await;
    assert_eq!(exchange.status, StatusCode::OK);
    let tokens = exchange.json();
    assert_eq!(
        tokens["access_token"].as_str(),
        Some(UPSTREAM_ACCESS_TOKEN),
        "the legitimate client should receive the upstream access token"
    );
    assert_eq!(tokens["token_type"].as_str(), Some("Bearer"));
}

/// A code that reached one client is refused to any other, and the attempt
/// spends it, so a mismatched redemption cannot be retried.
#[tokio::test]
async fn token_endpoint_refuses_a_code_presented_by_another_client() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    let encoded_redirect_uri = urlencoding::encode(TRUSTED_REDIRECT_URI).into_owned();

    let stolen = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={ATTACKER_CODE_VERIFIER}\
             &redirect_uri={encoded_redirect_uri}&client_id=some-other-client"
        )),
    )
    .await;
    assert_eq!(stolen.status, StatusCode::BAD_REQUEST);
    assert_eq!(stolen.body, "grant was not issued to this client");

    let retried = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={encoded_redirect_uri}&client_id={client_id}"
        )),
    )
    .await;
    assert_eq!(retried.status, StatusCode::BAD_REQUEST);
    assert_eq!(retried.body, "invalid or expired code");
}
