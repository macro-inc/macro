//! Drives the reported attack and the legitimate flow over the real router, so
//! the checks are exercised through the same HTTP surface an attacker uses.

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::{health, mcp_router, mount_at_root_and_prefix, oauth_router};
use crate::domain::browser_binding::BrowserBinding;
use crate::test_support::{
    ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, GATEWAY_REDIRECT_URI, Harness,
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
    set_cookie: Option<String>,
    csp: Option<String>,
    x_frame_options: Option<String>,
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
    let header_text = |name: header::HeaderName| {
        response
            .headers()
            .get(name)
            .map(|value| value.to_str().expect("header is text").to_owned())
    };
    let location = header_text(header::LOCATION);
    let referrer_policy = header_text(header::REFERRER_POLICY);
    let set_cookie = header_text(header::SET_COOKIE);
    let csp = header_text(header::CONTENT_SECURITY_POLICY);
    let x_frame_options = header_text(header::X_FRAME_OPTIONS);
    let bytes = axum::body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .expect("body should be readable");

    Response {
        status,
        location,
        referrer_policy,
        set_cookie,
        csp,
        x_frame_options,
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

fn callback_request(session_id: &str, cookie: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().method("GET").uri(format!(
        "/oauth/callback?code=upstream-code&state={session_id}"
    ));
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request.body(Body::empty()).expect("request should build")
}

/// The `name=value` pair a browser sends back for a `Set-Cookie` header.
fn cookie_pair(set_cookie: &str) -> String {
    set_cookie
        .split(';')
        .next()
        .expect("Set-Cookie has a name=value pair")
        .to_owned()
}

/// Reads the anti-forgery token out of a rendered consent page.
fn consent_token(page: &str) -> String {
    let marker = r#"name="consent_token" value=""#;
    let start = page.find(marker).expect("page carries a consent token") + marker.len();
    let length = page[start..].find('"').expect("token value is quoted");
    page[start..start + length].to_owned()
}

fn consent_submission(
    client_id: &str,
    redirect_uri: &str,
    token: &str,
    decision: &str,
    cookie: Option<&str>,
    fetch_site: &str,
) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri("/authorize")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header("sec-fetch-site", fetch_site);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request
        .body(Body::from(format!(
            "response_type=code&client_id={client_id}&redirect_uri={}&state=client-state\
             &code_challenge={}&code_challenge_method=S256&consent_token={token}\
             &decision={decision}",
            urlencoding::encode(redirect_uri),
            code_challenge_for(VICTIM_CODE_VERIFIER),
        )))
        .expect("request should build")
}

async fn register_client(harness: &Harness, redirect_uri: &str) -> String {
    let registration = send(harness, register_request(redirect_uri)).await;
    assert_eq!(registration.status, StatusCode::OK, "{redirect_uri}");
    registration.json()["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned()
}

/// A client on a host outside the trusted list gets a consent screen, not a
/// sign-in, and the screen cannot be framed or cached.
#[tokio::test]
async fn authorize_for_an_unlisted_host_shows_the_consent_screen() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;

    let page = send(
        &harness,
        authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;

    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.location, None);
    assert!(page.body.contains("gateway.example"));
    assert_eq!(page.x_frame_options.as_deref(), Some("DENY"));
    assert!(
        page.csp
            .as_deref()
            .is_some_and(|csp| csp.contains("frame-ancestors 'none'")),
        "unexpected CSP: {:?}",
        page.csp
    );
    let set_cookie = page.set_cookie.expect("authorize sets the binding cookie");
    assert!(set_cookie.starts_with("__Host-macro_mcp_oauth="));
    for attribute in ["Secure", "HttpOnly", "SameSite=Lax", "Path=/"] {
        assert!(
            set_cookie.contains(attribute),
            "{set_cookie} lacks {attribute}"
        );
    }
    assert!(!harness.inflight.has_pending());
}

/// The client name is self-reported, so markup in it must render as text.
#[tokio::test]
async fn consent_screen_escapes_the_client_name() {
    let harness = Harness::new();
    let registration = send(
        &harness,
        Request::builder()
            .method("POST")
            .uri("/register")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(format!(
                r#"{{"client_name":"<script>alert(1)</script>","redirect_uris":["{GATEWAY_REDIRECT_URI}"]}}"#
            )))
            .expect("request should build"),
    )
    .await;
    let client_id = registration.json()["client_id"]
        .as_str()
        .expect("registration returns a client_id")
        .to_owned();

    let page = send(
        &harness,
        authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;

    assert!(!page.body.contains("<script>"));
    assert!(page.body.contains("&#60;script&#62;") || page.body.contains("&lt;script&gt;"));
}

/// Approving on the consent screen, in the browser that was shown it, signs
/// the user in and delivers the code to the approved host.
#[tokio::test]
async fn approved_client_on_an_unlisted_host_completes_the_flow() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;

    let page = send(
        &harness,
        authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    let cookie = cookie_pair(&page.set_cookie.expect("authorize sets the binding cookie"));
    let token = consent_token(&page.body);

    let approved = send(
        &harness,
        consent_submission(
            &client_id,
            GATEWAY_REDIRECT_URI,
            &token,
            "approve",
            Some(&cookie),
            "same-origin",
        ),
    )
    .await;
    assert_eq!(approved.status, StatusCode::SEE_OTHER);
    assert_eq!(approved.referrer_policy.as_deref(), Some("no-referrer"));
    assert!(
        approved
            .location
            .as_deref()
            .is_some_and(|location| location.starts_with("https://upstream.example/authorize")),
        "unexpected redirect: {:?}",
        approved.location
    );

    let session_id = harness.inflight.only_pending_session_id();
    let callback = send(&harness, callback_request(&session_id, Some(&cookie))).await;
    assert_eq!(callback.status, StatusCode::TEMPORARY_REDIRECT);
    let client_redirect = callback.location.expect("callback redirects to the client");
    assert!(
        client_redirect.starts_with(&format!("{GATEWAY_REDIRECT_URI}?code=")),
        "unexpected redirect: {client_redirect}"
    );
}

/// No other page can approve on the user's behalf: the post must carry the
/// binding cookie, the token derived from it, and come from this origin.
#[tokio::test]
async fn a_forged_consent_submission_is_refused() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;
    let page = send(
        &harness,
        authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    let cookie = cookie_pair(&page.set_cookie.expect("authorize sets the binding cookie"));
    let token = consent_token(&page.body);
    let other_browser = format!(
        "__Host-macro_mcp_oauth={}",
        BrowserBinding::generate().as_str()
    );

    let forgeries = [
        ("no cookie", None, token.as_str(), "same-origin"),
        (
            "another browser's cookie",
            Some(other_browser.as_str()),
            token.as_str(),
            "same-origin",
        ),
        (
            "wrong token",
            Some(cookie.as_str()),
            "forged-token",
            "same-origin",
        ),
        (
            "cross-site post",
            Some(cookie.as_str()),
            token.as_str(),
            "cross-site",
        ),
    ];
    for (case, cookie, token, fetch_site) in forgeries {
        let response = send(
            &harness,
            consent_submission(
                &client_id,
                GATEWAY_REDIRECT_URI,
                token,
                "approve",
                cookie,
                fetch_site,
            ),
        )
        .await;

        assert_eq!(response.status, StatusCode::FORBIDDEN, "{case}");
        assert_eq!(response.location, None, "{case}");
        assert!(!harness.inflight.has_pending(), "{case}");
    }
}

/// Cancelling sends the browser nowhere, so the broker cannot be used to
/// redirect to a host the user just refused.
#[tokio::test]
async fn declining_consent_redirects_nowhere() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;
    let page = send(
        &harness,
        authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    let cookie = cookie_pair(&page.set_cookie.expect("authorize sets the binding cookie"));

    let declined = send(
        &harness,
        consent_submission(
            &client_id,
            GATEWAY_REDIRECT_URI,
            &consent_token(&page.body),
            "deny",
            Some(&cookie),
            "same-origin",
        ),
    )
    .await;

    assert_eq!(declined.status, StatusCode::OK);
    assert_eq!(declined.location, None);
    assert!(!harness.inflight.has_pending());
}

/// An attacker who approves their own client cannot hand the resulting
/// sign-in to a victim: the callback lands in the victim's browser, without
/// the attacker's binding cookie, and no code is issued.
#[tokio::test]
async fn a_sign_in_started_in_another_browser_issues_no_code() {
    let harness = Harness::new();
    let client_id = register_client(&harness, ATTACKER_REDIRECT_URI).await;
    let page = send(
        &harness,
        authorize_request(&client_id, ATTACKER_REDIRECT_URI, VICTIM_CODE_VERIFIER),
    )
    .await;
    let attacker_cookie = cookie_pair(&page.set_cookie.expect("authorize sets the binding cookie"));
    let approved = send(
        &harness,
        consent_submission(
            &client_id,
            ATTACKER_REDIRECT_URI,
            &consent_token(&page.body),
            "approve",
            Some(&attacker_cookie),
            "same-origin",
        ),
    )
    .await;
    assert_eq!(approved.status, StatusCode::SEE_OTHER);
    let session_id = harness.inflight.only_pending_session_id();
    let victim_cookie = format!(
        "__Host-macro_mcp_oauth={}",
        BrowserBinding::generate().as_str()
    );

    for cookie in [None, Some(victim_cookie.as_str())] {
        let callback = send(&harness, callback_request(&session_id, cookie)).await;

        assert_eq!(callback.status, StatusCode::BAD_REQUEST);
        assert_eq!(callback.location, None);
    }
    assert!(!harness.inflight.holds_any_issued_code());
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
    let upstream = authorize
        .location
        .clone()
        .expect("authorize redirects upstream");
    assert!(
        upstream.starts_with("https://upstream.example/authorize"),
        "unexpected upstream redirect: {upstream}"
    );

    let cookie = cookie_pair(
        &authorize
            .set_cookie
            .expect("authorize sets the binding cookie"),
    );
    let session_id = harness.inflight.only_pending_session_id();
    let callback = send(&harness, callback_request(&session_id, Some(&cookie))).await;
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
    assert_eq!(refresh.body, "refresh token is not bound to a client");
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
