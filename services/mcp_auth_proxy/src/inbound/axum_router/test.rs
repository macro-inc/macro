//! Drives the reported attack and the legitimate flow over the real router, so
//! the checks are exercised through the same HTTP surface an attacker uses.

use std::time::Duration;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::{health, mcp_router, mount_at_root_and_prefix, oauth_router};
use crate::domain::browser_binding::BrowserBinding;
use crate::domain::ports::UpstreamGrantError;
use crate::test_support::{
    ATTACKER_CODE_VERIFIER, ATTACKER_REDIRECT_URI, CHATGPT_RESOURCE, EMAIL_ADDRESS, EMAIL_CODE,
    FakeOAuthProvider, GATEWAY_REDIRECT_URI, Harness, LOOPBACK_REDIRECT_URI, SSO_EMAIL_ADDRESS,
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
    let cache_control = header_text(header::CACHE_CONTROL);
    let retry_after = header_text(header::RETRY_AFTER);
    let bytes = axum::body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .expect("body should be readable");

    Response {
        status,
        location,
        referrer_policy,
        cache_control,
        retry_after,
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
             &state=client-state&code_challenge={code_challenge}&code_challenge_method=S256\
             &sign_in=google"
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

/// A sign-in method named on the authorize request survives the consent form.
#[tokio::test]
async fn approving_keeps_the_requested_sign_in_method() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;

    let mut authorize = authorize_request(&client_id, GATEWAY_REDIRECT_URI, VICTIM_CODE_VERIFIER);
    *authorize.uri_mut() = authorize
        .uri()
        .to_string()
        .replace("sign_in=google", "sign_in=login")
        .parse()
        .expect("uri should parse");
    let page = send(&harness, authorize).await;
    assert!(
        page.body
            .contains(r#"<input type="hidden" name="sign_in" value="login" />"#),
        "{}",
        page.body
    );
    let cookie = cookie_pair(&page.set_cookie.expect("authorize sets the binding cookie"));

    let (parts, body) = consent_submission(
        &client_id,
        GATEWAY_REDIRECT_URI,
        &consent_token(&page.body),
        "approve",
        Some(&cookie),
        "same-origin",
    )
    .into_parts();
    let form = axum::body::to_bytes(body, 64 * 1024)
        .await
        .expect("form should read");
    let form = format!("{}&sign_in=login", String::from_utf8_lossy(&form));
    let approved = send(&harness, Request::from_parts(parts, Body::from(form))).await;

    assert_eq!(approved.status, StatusCode::SEE_OTHER);
    assert!(
        approved
            .location
            .as_deref()
            .is_some_and(|location| location.starts_with("https://upstream.example/login")),
        "unexpected redirect: {:?}",
        approved.location
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
async fn authorize_explains_how_to_reconnect_an_unregister_client() {
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

/// An authorize request as a client first sends it, before the user has picked
/// how to sign in, with `extra` appended.
fn unchosen_authorize_uri(client_id: &str, redirect_uri: &str, extra: &str) -> String {
    format!(
        "/authorize?response_type=code&client_id={client_id}&redirect_uri={}\
         &state=client-state&code_challenge={}&code_challenge_method=S256{extra}",
        urlencoding::encode(redirect_uri),
        code_challenge_for(VICTIM_CODE_VERIFIER),
    )
}

fn get_page(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().method("GET").uri(uri);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request.body(Body::empty()).expect("request should build")
}

fn post_form(uri: &str, cookie: &str, form: String) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(header::COOKIE, cookie)
        .body(Body::from(form))
        .expect("request should build")
}

/// Every client's users pick how to sign in, whichever method their account
/// uses, and each choice leads to its own sign-in.
#[tokio::test]
async fn every_client_gets_the_sign_in_choice() {
    for redirect_uri in [
        LOOPBACK_REDIRECT_URI,
        TRUSTED_REDIRECT_URI,
        GATEWAY_REDIRECT_URI,
    ] {
        let harness = Harness::new();
        let client_id = register_client(&harness, redirect_uri).await;

        let choice = send(
            &harness,
            get_page(&unchosen_authorize_uri(&client_id, redirect_uri, ""), None),
        )
        .await;

        assert_eq!(choice.status, StatusCode::OK);
        assert!(
            !harness.inflight.has_pending(),
            "the chooser stores nothing"
        );
        for method in ["google", "email", "login"] {
            assert!(
                choice
                    .body
                    .contains(&format!(r#"name="sign_in" value="{method}""#)),
                "{}",
                choice.body
            );
        }
        assert!(
            choice.body.contains(&format!(r#"value="{client_id}""#)),
            "{}",
            choice.body
        );
    }
}

/// Whatever the query holds is escaped before it reaches the page.
#[tokio::test]
async fn the_sign_in_choice_escapes_the_query() {
    let response = super::sign_in_choice(Some("state=%22%3E%3Cscript%3E&a=1"), false);
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
}

/// A browser partway through an email sign-in: the cookie that started it, and
/// the session and token its forms carry.
struct EmailSignIn {
    harness: Harness,
    client_id: String,
    cookie: String,
    session: String,
    form_token: String,
}

impl EmailSignIn {
    async fn start(redirect_uri: &str) -> Self {
        let harness = Harness::new();
        let client_id = register_client(&harness, redirect_uri).await;
        let authorize = send(
            &harness,
            get_page(
                &unchosen_authorize_uri(&client_id, redirect_uri, "&sign_in=email"),
                None,
            ),
        )
        .await;
        assert_eq!(authorize.status, StatusCode::TEMPORARY_REDIRECT);
        let session = harness.inflight.only_pending_session_id();
        assert_eq!(
            authorize.location.as_deref(),
            Some(format!("email-sign-in?session={session}").as_str()),
        );
        let cookie = cookie_pair(
            &authorize
                .set_cookie
                .expect("the flow sets its binding cookie"),
        );
        let secret = cookie
            .split_once('=')
            .expect("cookie has a name and value")
            .1;
        let form_token = BrowserBinding::parse(secret)
            .expect("cookie holds a binding")
            .form_token();

        Self {
            harness,
            client_id,
            cookie,
            session,
            form_token,
        }
    }

    fn form(&self, email: &str, code: Option<&str>) -> String {
        let mut form = format!(
            "session={}&form_token={}&email={}",
            self.session,
            self.form_token,
            urlencoding::encode(email),
        );
        if let Some(code) = code {
            form.push_str(&format!("&code={code}"));
        }
        form
    }

    async fn submit(&self, email: &str, code: Option<&str>) -> Response {
        send(
            &self.harness,
            post_form("/email-sign-in", &self.cookie, self.form(email, code)),
        )
        .await
    }
}

/// The whole email flow over HTTP: the page, a mistyped code that costs
/// nothing, then a code that delivers a broker code the client can redeem.
#[tokio::test]
async fn email_sign_in_delivers_a_code_the_client_can_redeem() {
    let flow = EmailSignIn::start(LOOPBACK_REDIRECT_URI).await;

    let page = send(
        &flow.harness,
        get_page(
            &format!("/email-sign-in?session={}", flow.session),
            Some(&flow.cookie),
        ),
    )
    .await;
    assert_eq!(page.status, StatusCode::OK);
    assert!(page.csp.is_some());

    let sent = flow.submit(EMAIL_ADDRESS, None).await;
    assert_eq!(sent.status, StatusCode::OK);
    assert_eq!(flow.harness.email_codes.requested(), [EMAIL_ADDRESS]);

    let wrong = flow.submit(EMAIL_ADDRESS, Some("000000")).await;
    assert_eq!(wrong.status, StatusCode::OK);
    assert!(
        flow.harness.inflight.has_pending(),
        "a mistyped code must not end the sign-in"
    );

    let signed_in = flow.submit(EMAIL_ADDRESS, Some(EMAIL_CODE)).await;
    assert_eq!(signed_in.status, StatusCode::SEE_OTHER);
    assert!(!flow.harness.inflight.has_pending());
    let location = signed_in.location.expect("redirect has a location");
    assert!(location.starts_with(LOOPBACK_REDIRECT_URI), "{location}");
    let code = query_param(&location, "code").expect("redirect carries a code");

    let token = send(
        &flow.harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&client_id={}&redirect_uri={}\
             &code_verifier={VICTIM_CODE_VERIFIER}",
            flow.client_id,
            urlencoding::encode(LOOPBACK_REDIRECT_URI),
        )),
    )
    .await;
    assert_eq!(token.status, StatusCode::OK, "{}", token.body);
    assert_eq!(token.json()["access_token"], UPSTREAM_ACCESS_TOKEN);
    assert_eq!(token.json()["refresh_token"], UPSTREAM_REFRESH_TOKEN);
}

/// An address on a single sign-on domain goes to its provider, on the same
/// session, so the upstream callback still finishes the flow.
#[tokio::test]
async fn email_sign_in_sends_a_single_sign_on_address_to_its_provider() {
    let flow = EmailSignIn::start(LOOPBACK_REDIRECT_URI).await;

    let redirect = flow.submit(SSO_EMAIL_ADDRESS, None).await;

    assert_eq!(redirect.status, StatusCode::SEE_OTHER);
    let location = redirect.location.expect("redirect has a location");
    assert!(
        location.starts_with("https://upstream.example/sso"),
        "{location}"
    );
    assert!(flow.harness.inflight.has_pending());
}

/// Someone else's sign-in link does nothing in a browser that did not start
/// it, whether the form is shown or submitted.
#[tokio::test]
async fn email_sign_in_refuses_a_browser_that_did_not_start_it() {
    let flow = EmailSignIn::start(LOOPBACK_REDIRECT_URI).await;
    let other = BrowserBinding::generate();
    let other_cookie = format!("__Host-macro_mcp_oauth={}", other.as_str());

    let page = send(
        &flow.harness,
        get_page(
            &format!("/email-sign-in?session={}", flow.session),
            Some(&other_cookie),
        ),
    )
    .await;
    assert_eq!(page.status, StatusCode::BAD_REQUEST);

    // The other browser's own valid token gets it no further.
    let submitted = send(
        &flow.harness,
        post_form(
            "/email-sign-in",
            &other_cookie,
            format!(
                "session={}&form_token={}&email={EMAIL_ADDRESS}&code={EMAIL_CODE}",
                flow.session,
                other.form_token(),
            ),
        ),
    )
    .await;
    assert_eq!(submitted.status, StatusCode::BAD_REQUEST);
    assert!(flow.harness.email_codes.requested().is_empty());
    assert!(flow.harness.inflight.has_pending());
    assert!(!flow.harness.inflight.holds_any_issued_code());
}

/// A form posted from another site is refused even with the right cookie.
#[tokio::test]
async fn email_sign_in_refuses_a_cross_site_post() {
    let flow = EmailSignIn::start(LOOPBACK_REDIRECT_URI).await;
    let mut request = post_form(
        "/email-sign-in",
        &flow.cookie,
        flow.form(EMAIL_ADDRESS, None),
    );
    request.headers_mut().insert(
        "sec-fetch-site",
        "cross-site".parse().expect("header value"),
    );

    let response = send(&flow.harness, request).await;

    assert_eq!(response.status, StatusCode::FORBIDDEN);
    assert!(flow.harness.email_codes.requested().is_empty());
}

/// Only a loopback client's users are offered the link, since a browser-based
/// client has no listener on another machine to reach.
#[tokio::test]
async fn only_loopback_clients_are_offered_manual_delivery() {
    for (redirect_uri, offered) in [
        (LOOPBACK_REDIRECT_URI, true),
        (TRUSTED_REDIRECT_URI, false),
        (GATEWAY_REDIRECT_URI, false),
    ] {
        let harness = Harness::new();
        let client_id = register_client(&harness, redirect_uri).await;

        let choice = send(
            &harness,
            get_page(&unchosen_authorize_uri(&client_id, redirect_uri, ""), None),
        )
        .await;

        assert_eq!(
            choice.body.contains(r#"name="delivery""#),
            offered,
            "{redirect_uri}"
        );
    }
}

/// A browser on another machine than the client: the user approves carrying
/// the code, signs in, and is shown the callback URL instead of a redirect to a
/// loopback address that is not theirs. The client can redeem what it carries.
#[tokio::test]
async fn manual_delivery_shows_the_callback_url_after_consent() {
    let harness = Harness::new();
    let client_id = register_client(&harness, LOOPBACK_REDIRECT_URI).await;

    let consent = send(
        &harness,
        get_page(
            &unchosen_authorize_uri(
                &client_id,
                LOOPBACK_REDIRECT_URI,
                "&sign_in=google&delivery=manual",
            ),
            None,
        ),
    )
    .await;
    assert_eq!(consent.status, StatusCode::OK);
    assert!(
        !harness.inflight.has_pending(),
        "nothing starts until the user approves"
    );
    assert!(
        consent
            .body
            .contains(r#"<input type="hidden" name="delivery" value="manual" />"#),
        "{}",
        consent.body
    );
    let cookie = cookie_pair(
        &consent
            .set_cookie
            .expect("the flow sets its binding cookie"),
    );
    let binding = BrowserBinding::parse(cookie.split_once('=').expect("cookie value").1)
        .expect("cookie holds a binding");

    let approved = send(
        &harness,
        post_form(
            "/authorize",
            &cookie,
            format!(
                "response_type=code&client_id={client_id}&redirect_uri={}&state=client-state\
                 &code_challenge={}&code_challenge_method=S256&sign_in=google&delivery=manual\
                 &consent_token={}&decision=approve",
                urlencoding::encode(LOOPBACK_REDIRECT_URI),
                code_challenge_for(VICTIM_CODE_VERIFIER),
                binding.form_token(),
            ),
        ),
    )
    .await;
    assert_eq!(approved.status, StatusCode::SEE_OTHER);

    let session_id = harness.inflight.only_pending_session_id();
    let page = send(&harness, callback_request(&session_id, Some(&cookie))).await;

    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.location, None, "there is no redirect to follow");
    assert!(page.csp.is_some());
    let page_text = page.body.replace("&#38;", "&");
    let shown = page_text
        .split("curl '")
        .nth(1)
        .and_then(|command| command.split('\'').next())
        .expect("the page shows a curl command");
    assert!(shown.starts_with(LOOPBACK_REDIRECT_URI), "{shown}");
    let code = query_param(shown, "code").expect("the command carries a code");
    assert!(harness.inflight.holds_issued_code(&code), "{code}");
}

/// Manual delivery is refused where it makes no sense or is not safe to show:
/// on an `https` client, and on a loopback URI that could break out of the
/// quotes of the command the page tells the user to run.
#[tokio::test]
async fn manual_delivery_is_refused_outside_clean_loopback_uris() {
    for redirect_uri in [
        TRUSTED_REDIRECT_URI,
        "http://127.0.0.1:51000/a';touch${IFS}x;'",
    ] {
        let harness = Harness::new();
        let client_id = register_client(&harness, redirect_uri).await;

        let refused = send(
            &harness,
            get_page(
                &unchosen_authorize_uri(
                    &client_id,
                    redirect_uri,
                    "&sign_in=google&delivery=manual",
                ),
                None,
            ),
        )
        .await;

        assert_eq!(refused.status, StatusCode::BAD_REQUEST, "{redirect_uri}");
        assert!(!harness.inflight.has_pending());

        let choice = send(
            &harness,
            get_page(&unchosen_authorize_uri(&client_id, redirect_uri, ""), None),
        )
        .await;
        assert!(
            !choice.body.contains(r#"name="delivery""#),
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

    let no_grant_type = send(&harness, token_request("client_id=some-client")).await;
    assert_eq!(no_grant_type.status, StatusCode::BAD_REQUEST);
    assert_eq!(no_grant_type.json()["error"], "invalid_request");
    assert_eq!(no_grant_type.cache_control.as_deref(), Some("no-store"));
}

/// ChatGPT's flow: it names the ChatGPT MCP server as the resource at both
/// endpoints and receives a Macro API token labelled with its name.
#[tokio::test]
async fn a_chatgpt_resource_flow_receives_a_macro_api_token() {
    let harness = Harness::new();
    let client_id = register_client(&harness, TRUSTED_REDIRECT_URI).await;
    let resource = urlencoding::encode(CHATGPT_RESOURCE).into_owned();

    let authorize = send(
        &harness,
        Request::builder()
            .method("GET")
            .uri(format!(
                "/authorize?response_type=code&client_id={client_id}&redirect_uri={}\
                 &state=client-state&code_challenge={}&code_challenge_method=S256\
                 &sign_in=google&resource={resource}",
                urlencoding::encode(TRUSTED_REDIRECT_URI),
                code_challenge_for(VICTIM_CODE_VERIFIER),
            ))
            .body(Body::empty())
            .expect("request should build"),
    )
    .await;
    assert_eq!(authorize.status, StatusCode::TEMPORARY_REDIRECT);
    let cookie = cookie_pair(
        &authorize
            .set_cookie
            .expect("authorize sets the binding cookie"),
    );
    let session_id = harness.inflight.only_pending_session_id();
    let callback = send(&harness, callback_request(&session_id, Some(&cookie))).await;
    let code = query_param(
        &callback.location.expect("callback redirects to the client"),
        "code",
    )
    .expect("redirect carries a code");

    let exchange = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={}&client_id={client_id}&resource={resource}",
            urlencoding::encode(TRUSTED_REDIRECT_URI)
        )),
    )
    .await;
    assert_eq!(exchange.status, StatusCode::OK);
    let tokens = exchange.json();
    let expires_in = tokens["expires_in"]
        .as_u64()
        .expect("expires_in is a number");
    assert_eq!(
        tokens["access_token"].as_str(),
        Some(
            format!("macro-api-token for upstream-access-token via test-client for {expires_in}s")
                .as_str()
        )
    );
}

/// An unrecognized resource is today's harness flow: the FusionAuth token.
#[tokio::test]
async fn an_unrecognized_resource_receives_the_upstream_access_token() {
    let harness = Harness::new();
    let client_id = register_client(&harness, TRUSTED_REDIRECT_URI).await;
    let resource = urlencoding::encode("https://mcp-server.macro.com").into_owned();

    let authorize = send(
        &harness,
        Request::builder()
            .method("GET")
            .uri(format!(
                "/authorize?response_type=code&client_id={client_id}&redirect_uri={}\
                 &state=client-state&code_challenge={}&code_challenge_method=S256\
                 &sign_in=google&resource={resource}",
                urlencoding::encode(TRUSTED_REDIRECT_URI),
                code_challenge_for(VICTIM_CODE_VERIFIER),
            ))
            .body(Body::empty())
            .expect("request should build"),
    )
    .await;
    assert_eq!(authorize.status, StatusCode::TEMPORARY_REDIRECT);
    let cookie = cookie_pair(
        &authorize
            .set_cookie
            .expect("authorize sets the binding cookie"),
    );
    let session_id = harness.inflight.only_pending_session_id();
    let callback = send(&harness, callback_request(&session_id, Some(&cookie))).await;
    let code = query_param(
        &callback.location.expect("callback redirects to the client"),
        "code",
    )
    .expect("redirect carries a code");

    let exchange = send(
        &harness,
        token_request(&format!(
            "grant_type=authorization_code&code={code}&code_verifier={VICTIM_CODE_VERIFIER}\
             &redirect_uri={}&client_id={client_id}&resource={resource}",
            urlencoding::encode(TRUSTED_REDIRECT_URI)
        )),
    )
    .await;
    assert_eq!(exchange.status, StatusCode::OK);
    assert_eq!(
        exchange.json()["access_token"].as_str(),
        Some(UPSTREAM_ACCESS_TOKEN)
    );
}

/// The consent form re-posts the authorize request, resource included.
#[tokio::test]
async fn the_consent_form_carries_the_resource() {
    let harness = Harness::new();
    let client_id = register_client(&harness, GATEWAY_REDIRECT_URI).await;

    let page = send(
        &harness,
        Request::builder()
            .method("GET")
            .uri(format!(
                "/authorize?response_type=code&client_id={client_id}&redirect_uri={}\
                 &state=client-state&code_challenge={}&code_challenge_method=S256\
                 &sign_in=google&resource={}",
                urlencoding::encode(GATEWAY_REDIRECT_URI),
                code_challenge_for(VICTIM_CODE_VERIFIER),
                urlencoding::encode(CHATGPT_RESOURCE),
            ))
            .body(Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(page.status, StatusCode::OK);
    assert!(page.body.contains(r#"name="resource""#), "{}", page.body);
    assert!(page.body.contains("mcp-chatgpt.macro.com"), "{}", page.body);
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
    let cookie = cookie_pair(
        authorize
            .set_cookie
            .as_deref()
            .expect("authorize sets the binding cookie"),
    );

    let session_id = harness.inflight.only_pending_session_id();
    send(&harness, callback_request(&session_id, Some(&cookie))).await
}

#[tokio::test]
async fn callback_separates_a_refused_code_from_an_upstream_fault() {
    let refused = callback_with_failing_code_exchange(|| UpstreamGrantError::InvalidGrant {
        detail: "invalid_request (auth_code_not_found)".to_owned(),
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
