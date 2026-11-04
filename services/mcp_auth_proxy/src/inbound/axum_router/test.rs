//! Drives the reported attack and the legitimate flow over the real router, so
//! the checks are exercised through the same HTTP surface an attacker uses.

use std::time::Duration;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::{health, mcp_router, mount_at_root_and_prefix, oauth_router};
use crate::domain::ports::UpstreamGrantError;
use crate::test_support::{
    ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, FakeOAuthProvider, Harness,
    TRUSTED_REDIRECT_URI, UPSTREAM_ACCESS_TOKEN, UPSTREAM_REFRESH_TOKEN, VICTIM_CODE_VERIFIER,
    code_challenge_for, query_param,
};
use axum::{Router, routing::get};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;

const BODY_LIMIT: usize = 64 * 1024;

struct Response {
    status: StatusCode,
    location: Option<String>,
    referrer_policy: Option<String>,
    cache_control: Option<String>,
    retry_after: Option<String>,
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
    let referrer_policy = response
        .headers()
        .get(header::REFERRER_POLICY)
        .map(|value| value.to_str().expect("Referrer-Policy is text").to_owned());
    let cache_control = response
        .headers()
        .get(header::CACHE_CONTROL)
        .map(|value| value.to_str().expect("Cache-Control is text").to_owned());
    let retry_after = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().expect("Retry-After is text").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .expect("body should be readable");

    Response {
        status,
        location,
        referrer_policy,
        cache_control,
        retry_after,
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
    assert_eq!(victim_registration.status, StatusCode::OK);
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
async fn authorize_explains_how_to_reconnect_an_unregistered_client() {
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
    assert!(response.body.contains("remove the Macro MCP connection"));
    assert!(response.body.contains("add it again, and sign in to Macro"));
    assert_eq!(response.location, None);
    assert!(!harness.inflight.has_pending());
}

/// MCP Inspector on `http://127.0.0.1:6274` failed with FusionAuth's "Invalid
/// origin uri" because the browser forwarded the inspector's Referer through
/// this redirect. Every usable client, loopback on any port or a trusted HTTPS
/// host, reaches FusionAuth without its origin.
#[tokio::test]
async fn authorize_withholds_the_client_origin_from_the_identity_provider() {
    let harness = Harness::new();

    for redirect_uri in [
        "http://localhost:6274/oauth/callback",
        "http://127.0.0.1:6274/oauth/callback",
        "http://[::1]:6274/oauth/callback",
        TRUSTED_REDIRECT_URI,
    ] {
        let registration = send(&harness, register_request(redirect_uri)).await;
        assert_eq!(registration.status, StatusCode::OK, "{redirect_uri}");
        let client_id = registration.json()["client_id"]
            .as_str()
            .expect("registration returns a client_id")
            .to_owned();

        let authorize = send(
            &harness,
            authorize_request(&client_id, redirect_uri, VICTIM_CODE_VERIFIER),
        )
        .await;

        assert_eq!(
            authorize.status,
            StatusCode::TEMPORARY_REDIRECT,
            "{redirect_uri}"
        );
        assert_eq!(
            authorize.referrer_policy.as_deref(),
            Some("no-referrer"),
            "{redirect_uri}"
        );
    }
}

/// ChatGPT's reviewers sign in with a password, so its users pick; the choice
/// carries the whole request, escaped, and only then does the flow start.
#[tokio::test]
async fn authorize_offers_chatgpt_a_sign_in_choice() {
    let harness = Harness::new();
    let redirect_uri = "https://chatgpt.com/connector/oauth/abc";
    let registration = send(&harness, register_request(redirect_uri)).await;
    assert_eq!(registration.status, StatusCode::OK);
    let client_id = registration.json()["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned();

    let choice = send(
        &harness,
        authorize_request(&client_id, redirect_uri, VICTIM_CODE_VERIFIER),
    )
    .await;
    assert_eq!(choice.status, StatusCode::OK);
    let page = choice.body;
    assert!(page.contains("&amp;sign_in=google"), "{page}");
    assert!(page.contains("&amp;sign_in=login"), "{page}");
    assert!(page.contains(&format!("client_id={client_id}")), "{page}");

    let code_challenge = code_challenge_for(VICTIM_CODE_VERIFIER);
    let chosen = |choice: &str| {
        Request::builder()
            .method("GET")
            .uri(format!(
                "/authorize?response_type=code&client_id={client_id}\
                 &redirect_uri={}&state=x&code_challenge={code_challenge}\
                 &code_challenge_method=S256&sign_in={choice}",
                urlencoding::encode(redirect_uri),
            ))
            .body(Body::empty())
            .expect("request should build")
    };
    let login = send(&harness, chosen("login")).await;
    assert_eq!(login.status, StatusCode::TEMPORARY_REDIRECT);
    let location = login.location.expect("redirect has a location");
    assert!(
        location.starts_with("https://upstream.example/login"),
        "{location}"
    );
    let google = send(&harness, chosen("google")).await;
    let location = google.location.expect("redirect has a location");
    assert!(
        location.starts_with("https://upstream.example/authorize"),
        "{location}"
    );
}

/// Whatever the query holds is re-encoded before it reaches the page.
#[tokio::test]
async fn the_sign_in_choice_escapes_the_query() {
    let response = super::sign_in_choice(Some("state=%22%3E%3Cscript%3E&a=1".to_owned()));
    let csp = response.headers()[axum::http::header::CONTENT_SECURITY_POLICY]
        .to_str()
        .expect("the policy is ascii")
        .to_owned();
    assert!(csp.contains("default-src 'none'"), "{csp}");
    let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("page should read");
    let page = String::from_utf8(body.to_vec()).expect("page is utf-8");
    assert!(!page.contains("<script"), "{page}");
    assert!(page.contains("state=%22%3E%3Cscript%3E&amp;a=1"), "{page}");
}

/// Loopback hosts are interchangeable for the policy but not for the
/// registration: a client registered on `localhost` cannot have its code sent
/// to `127.0.0.1`.
#[tokio::test]
async fn authorize_refuses_a_loopback_redirect_the_client_did_not_register() {
    let harness = Harness::new();

    let registration = send(
        &harness,
        register_request("http://localhost:6274/oauth/callback"),
    )
    .await;
    assert_eq!(registration.status, StatusCode::OK);
    let client_id = registration.json()["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned();

    let authorize = send(
        &harness,
        authorize_request(
            &client_id,
            "http://127.0.0.1:6274/oauth/callback",
            VICTIM_CODE_VERIFIER,
        ),
    )
    .await;

    assert_eq!(authorize.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        authorize.body,
        "redirect_uri was not registered for this client"
    );
    assert_eq!(authorize.location, None);
    assert!(!harness.inflight.has_pending());
}

/// The flow a real MCP client drives, from registration through to a bearer
/// token, so the added checks are shown not to break it.
#[tokio::test]
async fn registered_client_completes_the_whole_flow() {
    let harness = Harness::new();

    let registration = send(&harness, register_request(TRUSTED_REDIRECT_URI)).await;
    assert_eq!(registration.status, StatusCode::OK);
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
    assert_eq!(stolen.json()["error"], "invalid_grant");
    assert_eq!(
        stolen.json()["error_description"],
        "grant was not issued to this client"
    );

    let retried = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={encoded_redirect_uri}&client_id={client_id}"
        )),
    )
    .await;
    assert_eq!(retried.status, StatusCode::BAD_REQUEST);
    assert_eq!(retried.json()["error"], "invalid_grant");
    assert_eq!(
        retried.json()["error_description"],
        "invalid or expired code"
    );
}

fn revoke_request(form: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/revoke")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from(form.to_owned()))
        .expect("request should build")
}

/// The disconnect flow over HTTP: another client is refused with an RFC 6749
/// error body, the owner revokes, the revoked token no longer refreshes, and
/// revoking again still succeeds.
#[tokio::test]
async fn client_disconnects_by_revoking_its_refresh_token() {
    let harness = Harness::new();
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
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
    assert!(
        exchange.json()["expires_in"].is_u64(),
        "expires_in must always be present"
    );

    let anonymous = send(
        &harness,
        revoke_request(&format!("token={UPSTREAM_REFRESH_TOKEN}")),
    )
    .await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    assert_eq!(anonymous.json()["error"], "invalid_client");

    let other_client = send(
        &harness,
        revoke_request(&format!(
            "token={UPSTREAM_REFRESH_TOKEN}&token_type_hint=refresh_token&client_id=some-other-client"
        )),
    )
    .await;
    assert_eq!(other_client.status, StatusCode::BAD_REQUEST);
    assert_eq!(other_client.json()["error"], "invalid_grant");

    for _ in 0..2 {
        let revoked = send(
            &harness,
            revoke_request(&format!(
                "token={UPSTREAM_REFRESH_TOKEN}&token_type_hint=refresh_token&client_id={client_id}"
            )),
        )
        .await;
        assert_eq!(revoked.status, StatusCode::OK);
        assert_eq!(revoked.body, "");
    }

    let refresh = send(
        &harness,
        token_request(&format!(
            "grant_type=refresh_token&refresh_token={UPSTREAM_REFRESH_TOKEN}&client_id={client_id}"
        )),
    )
    .await;
    assert_eq!(refresh.status, StatusCode::BAD_REQUEST);
    assert_eq!(refresh.json()["error"], "invalid_grant");
    assert_eq!(
        refresh.json()["error_description"],
        "refresh token is not bound to a client"
    );
}

/// Takes a fresh client through the whole flow and presents its refresh token
/// to `/token`, so the upstream refresh grant decides the answer.
async fn refresh_over_http(harness: &Harness) -> Response {
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let code = harness
        .complete_flow_to_code(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER)
        .await;
    let exchange = send(
        harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={}&client_id={client_id}",
            urlencoding::encode(TRUSTED_REDIRECT_URI)
        )),
    )
    .await;
    assert_eq!(exchange.status, StatusCode::OK);

    send(
        harness,
        token_request(&format!(
            "grant_type=refresh_token&refresh_token={UPSTREAM_REFRESH_TOKEN}&client_id={client_id}"
        )),
    )
    .await
}

/// A refresh token the upstream no longer holds is the client's problem, not
/// an outage: it gets `invalid_grant`, which tells it to authorize again
/// instead of retrying.
#[tokio::test]
async fn token_endpoint_answers_an_upstream_refused_refresh_with_invalid_grant() {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_refresh(|| {
        UpstreamGrantError::InvalidGrant {
            detail: "invalid_grant (refresh_token_not_found)".to_owned(),
        }
    }));

    let refresh = refresh_over_http(&harness).await;

    assert_eq!(refresh.status, StatusCode::BAD_REQUEST);
    assert_eq!(refresh.json()["error"], "invalid_grant");
    assert_eq!(
        refresh.json()["error_description"],
        "refresh token is no longer valid; authorize again"
    );
    assert_eq!(refresh.cache_control.as_deref(), Some("no-store"));
    assert!(
        !refresh.body.contains("refresh_token_not_found"),
        "upstream detail is logged, not returned"
    );
}

#[tokio::test]
async fn token_endpoint_answers_an_upstream_outage_with_temporarily_unavailable() {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_refresh(|| {
        UpstreamGrantError::Unavailable {
            retry_after: Some(Duration::from_secs(30)),
        }
    }));

    let refresh = refresh_over_http(&harness).await;

    assert_eq!(refresh.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(refresh.json()["error"], "temporarily_unavailable");
    assert_eq!(refresh.retry_after.as_deref(), Some("30"));
}

#[tokio::test]
async fn token_endpoint_answers_an_unknown_upstream_failure_with_server_error() {
    let harness = Harness::with_provider(
        FakeOAuthProvider::new()
            .failing_refresh(|| UpstreamGrantError::Failed(anyhow::anyhow!("unexpected 500"))),
    );

    let refresh = refresh_over_http(&harness).await;

    assert_eq!(refresh.status, StatusCode::BAD_GATEWAY);
    assert_eq!(refresh.json()["error"], "server_error");
    assert_eq!(refresh.retry_after, None);
    assert!(
        !refresh.body.contains("unexpected 500"),
        "upstream detail is logged, not returned"
    );
}

#[tokio::test]
async fn token_endpoint_names_missing_parameters_as_invalid_request() {
    let harness = Harness::new();

    let missing_code = send(
        &harness,
        token_request("grant_type=authorization_code&client_id=some-client"),
    )
    .await;
    assert_eq!(missing_code.status, StatusCode::BAD_REQUEST);
    assert_eq!(missing_code.json()["error"], "invalid_request");

    let unsupported = send(&harness, token_request("grant_type=password")).await;
    assert_eq!(unsupported.status, StatusCode::BAD_REQUEST);
    assert_eq!(unsupported.json()["error"], "unsupported_grant_type");
}

async fn callback_with_failing_code_exchange(failure: fn() -> UpstreamGrantError) -> Response {
    let harness = Harness::with_provider(FakeOAuthProvider::new().failing_code_exchange(failure));
    let client_id = harness.register(&[TRUSTED_REDIRECT_URI]).await;
    let authorize = send(
        &harness,
        authorize_request(&client_id, TRUSTED_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    assert_eq!(authorize.status, StatusCode::TEMPORARY_REDIRECT);

    let session_id = harness.inflight.only_pending_session_id();
    send(&harness, callback_request(&session_id)).await
}

#[tokio::test]
async fn callback_separates_a_refused_code_from_an_upstream_fault() {
    let refused = callback_with_failing_code_exchange(|| UpstreamGrantError::InvalidGrant {
        detail: "invalid_grant (auth_code_not_found)".to_owned(),
    })
    .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
    assert_eq!(refused.location, None);

    let unavailable = callback_with_failing_code_exchange(|| UpstreamGrantError::Unavailable {
        retry_after: None,
    })
    .await;
    assert_eq!(unavailable.status, StatusCode::SERVICE_UNAVAILABLE);

    let failed = callback_with_failing_code_exchange(|| {
        UpstreamGrantError::Failed(anyhow::anyhow!("unexpected 500"))
    })
    .await;
    assert_eq!(failed.status, StatusCode::BAD_GATEWAY);
}

async fn ok() -> &'static str {
    "ok"
}

fn sample_app() -> Router {
    mount_at_root_and_prefix(
        Router::new()
            .route("/health", get(ok))
            .route("/oauth/callback", get(ok))
            .route("/.well-known/oauth-protected-resource", get(ok))
            .route("/.well-known/oauth-protected-resource/mcp", get(ok))
            .route("/mcp", get(ok)),
    )
}

async fn get_status(app: Router, path: &str) -> StatusCode {
    app.oneshot(
        Request::builder()
            .uri(path)
            .method("GET")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

fn built_router() -> Router {
    mcp_router(
        Harness::new().service,
        JwtValidationArgs::new_testing(),
        Router::new().route("/", get(ok)),
    )
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/mcp/health"] {
        let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn existing_paths_stay_and_are_also_served_under_the_prefix() {
    for path in [
        "/health",
        "/mcp/health",
        "/oauth/callback",
        "/mcp/oauth/callback",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
        "/mcp/.well-known/oauth-protected-resource/mcp",
        "/mcp",
        "/mcp/mcp",
    ] {
        assert_eq!(
            get_status(sample_app(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn mcp_router_builds_without_overlapping_routes() {
    let app = built_router();
    for path in [
        "/health",
        "/mcp/health",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
        "/mcp/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/mcp/.well-known/oauth-authorization-server",
    ] {
        assert_eq!(
            get_status(app.clone(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn mounted_mcp_preserves_process_readiness_and_bearer_protection() {
    let app = super::mounted_mcp_router(
        Harness::new().service,
        JwtValidationArgs::new_testing(),
        Router::new().route("/", get(ok)),
    )
    .merge(Router::new().route("/health", get(|| async { StatusCode::SERVICE_UNAVAILABLE })));

    for (path, expected) in [
        ("/health", StatusCode::SERVICE_UNAVAILABLE),
        ("/mcp/.well-known/oauth-protected-resource", StatusCode::OK),
        (
            "/mcp/.well-known/oauth-authorization-server",
            StatusCode::OK,
        ),
        ("/mcp", StatusCode::UNAUTHORIZED),
        ("/mcp/mcp", StatusCode::UNAUTHORIZED),
    ] {
        assert_eq!(get_status(app.clone(), path).await, expected, "{path}");
    }
}
