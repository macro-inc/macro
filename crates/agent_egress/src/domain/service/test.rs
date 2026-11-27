use super::*;
use crate::domain::model::{
    AgentSessionId, BearerToken, CONNECT_TOOL_NAME, CustomMcpServerKey, GitEndpoint, GitService,
    McpDestination, McpServerListing, McpServerSlug, ProxyBody, RepoSlug, SessionGrant,
    UpstreamCall, UpstreamCredential,
};
use bot_id::BotId;
use connectors::{ConnectorId, Selection};
use http::header::{AUTHORIZATION, HeaderMap, HeaderName, HeaderValue};
use http::{Method, StatusCode};
use http_body_util::{BodyExt, Empty, Full};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;
use url::Url;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").expect("a valid user id")
}

fn empty_body() -> ProxyBody {
    Empty::new().map_err(|never| match never {}).boxed_unsync()
}

fn header_map(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in pairs {
        headers.append(
            HeaderName::from_bytes(name.as_bytes()).expect("header name"),
            HeaderValue::from_str(value).expect("header value"),
        );
    }
    headers
}

fn names(headers: &HeaderMap) -> Vec<&str> {
    headers.keys().map(HeaderName::as_str).collect()
}

fn session_repo() -> RepoSlug {
    RepoSlug::parse("macro", "wolf").expect("slug")
}

/// Verifies whatever token it is given, unless built to refuse.
struct StubSessions(Result<SessionGrant, ()>);

impl StubSessions {
    fn granting() -> Self {
        Self::granting_with(Vec::new())
    }

    /// A grant whose session was opened by an agent that listed `servers`.
    fn granting_with(servers: Vec<McpServerListing>) -> Self {
        Self(Ok(SessionGrant {
            session: AgentSessionId::new(),
            owner: owner(),
            agent: BotId::TEST_A,
            repo: Some(session_repo()),
            selection: selection_of(&servers),
            mcp_servers: servers,
            prompter: None,
        }))
    }

    fn refusing() -> Self {
        Self(Err(()))
    }
}

impl SessionAuthority for StubSessions {
    async fn authorize(&self, _token: &SessionToken) -> Result<SessionGrant, EgressError> {
        self.0
            .clone()
            .map_err(|()| EgressError::Unauthenticated("unknown session token"))
    }

    async fn authorize_session(
        &self,
        _session: AgentSessionId,
    ) -> Result<SessionGrant, EgressError> {
        self.0
            .clone()
            .map_err(|()| EgressError::Unauthenticated("unknown session"))
    }
}

/// What an agent that listed `servers` may reach; an agent that listed
/// none was given everything.
fn selection_of(servers: &[McpServerListing]) -> Selection {
    if servers.is_empty() {
        return Selection::All;
    }
    Selection::Apps(
        servers
            .iter()
            .map(|listing| ConnectorId::parse(listing.slug.as_str()).expect("an app slug"))
            .collect(),
    )
}

/// How the spy answers a slug it is asked about.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Knowledge {
    /// The owner holds an enabled grant.
    Connected,
    /// The agent may reach it, but the owner cannot use it yet.
    Unconnected,
    /// The owner cannot use it yet, but its upstream addresses them anyway.
    Addressable,
    /// Connected once; the grant has since died, with the owner's name for
    /// the server, the way the connectors adapter reports one.
    Disconnected,
    /// The session's agent was not given it.
    OutOfScope,
    /// A server the owner added without an account: connected, dialed bare.
    Anonymous,
    /// Nothing to address at all.
    Unknown,
}

/// Records who it was asked about, and answers with a fixed upstream.
struct SpyCredentials {
    asked: Mutex<Vec<(String, String)>>,
    /// The selection each resolution was scoped to.
    selections: Mutex<Vec<Selection>>,
    /// The agent each resolution was attributed to.
    agents: Mutex<Vec<BotId>>,
    /// Each 401 reported, by whose connection and where it went.
    unauthorized: Mutex<Vec<(String, McpDestination)>>,
    known: Knowledge,
    url: String,
    scope: HeaderMap,
}

impl SpyCredentials {
    fn knowing() -> Self {
        Self::at("https://mcp.example.com/mcp")
    }

    /// A server whose stored URL is whatever the owner typed in.
    fn at(url: &str) -> Self {
        Self {
            asked: Mutex::default(),
            selections: Mutex::default(),
            agents: Mutex::default(),
            unauthorized: Mutex::default(),
            known: Knowledge::Connected,
            url: url.to_owned(),
            scope: HeaderMap::new(),
        }
    }

    /// An app the session may reach that the owner cannot use yet.
    fn unconnected() -> Self {
        Self {
            known: Knowledge::Unconnected,
            ..Self::knowing()
        }
    }

    /// An app the owner has not connected whose upstream still addresses
    /// them, as Pipedream does.
    fn addressable() -> Self {
        Self {
            known: Knowledge::Addressable,
            ..Self::knowing()
        }
    }

    /// A destination outside what the session's agent was given.
    fn out_of_scope() -> Self {
        Self {
            known: Knowledge::OutOfScope,
            ..Self::knowing()
        }
    }

    /// A resolution that scopes its credential with extra headers, the way
    /// the Pipedream adapter does.
    fn scoped(scope: &[(&str, &str)]) -> Self {
        let mut headers = HeaderMap::new();
        for (name, value) in scope {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes()).expect("a header name"),
                HeaderValue::from_str(value).expect("a header value"),
            );
        }
        Self {
            scope: headers,
            ..Self::knowing()
        }
    }

    /// A custom server whose grant has died.
    fn disconnected() -> Self {
        Self {
            known: Knowledge::Disconnected,
            ..Self::at(WIKI)
        }
    }

    /// A custom server the owner added without connecting an account.
    fn anonymous() -> Self {
        Self {
            known: Knowledge::Anonymous,
            ..Self::at(WIKI)
        }
    }

    fn empty() -> Self {
        Self {
            asked: Mutex::default(),
            selections: Mutex::default(),
            agents: Mutex::default(),
            unauthorized: Mutex::default(),
            known: Knowledge::Unknown,
            url: String::new(),
            scope: HeaderMap::new(),
        }
    }
}

/// The URL of the owner's one custom server in these tests.
const WIKI: &str = "https://wiki.example.com/mcp";

impl McpCredentials for SpyCredentials {
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        agent: BotId,
        _session: uuid::Uuid,
        selection: &Selection,
        destination: &McpDestination,
    ) -> Result<McpResolution, EgressError> {
        self.agents.lock().expect("lock").push(agent);
        self.selections
            .lock()
            .expect("lock")
            .push(selection.clone());
        let slug = match destination {
            McpDestination::Connected(slug) => slug.clone(),
            McpDestination::Preview => unreachable!("preview must never resolve owner credentials"),
            McpDestination::Macro => McpServerSlug::parse("macro").expect("slug"),
            // Recorded under a fixed name: the key is a digest, and the
            // tests only care that the custom destination was resolved.
            McpDestination::Custom(_) => McpServerSlug::parse("custom").expect("slug"),
        };
        self.asked
            .lock()
            .expect("lock")
            .push((owner.to_string(), slug.to_string()));

        match self.known {
            Knowledge::Unknown => return Err(EgressError::UnknownServer(slug.clone())),
            Knowledge::OutOfScope => return Err(EgressError::OutOfScope),
            Knowledge::Unconnected => return Ok(McpResolution::NotConnected),
            Knowledge::Disconnected => {
                return Ok(McpResolution::Disconnected {
                    name: "Team wiki".to_owned(),
                });
            }
            Knowledge::Connected | Knowledge::Anonymous | Knowledge::Addressable => {}
        }

        let url = Url::parse(&self.url).expect("url");
        if self.known == Knowledge::Anonymous {
            return Ok(McpResolution::Connected(UpstreamCall::anonymous(url)?));
        }
        let call = UpstreamCall::bearer(url, BearerToken::new("upstream-token"))?
            .scoped_by(self.scope.clone());
        if self.known == Knowledge::Addressable {
            return Ok(McpResolution::Unconnected(call));
        }
        Ok(McpResolution::Connected(call))
    }

    async fn unauthorized(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<Option<String>, EgressError> {
        self.unauthorized
            .lock()
            .expect("lock")
            .push((owner.to_string(), destination.clone()));
        // The owner's name for a custom server; an app is named by the grant.
        Ok(matches!(destination, McpDestination::Custom(_)).then(|| "Team wiki".to_owned()))
    }
}

/// Records which repository it was asked to mint for.
struct SpyGithubTokens {
    asked: Mutex<Vec<(String, String)>>,
    url: String,
}

impl Default for SpyGithubTokens {
    fn default() -> Self {
        Self::at("https://github.com/macro/wolf.git/")
    }
}

impl SpyGithubTokens {
    /// A minting adapter that answers with whatever base it was built with,
    /// including one it has no business answering with.
    fn at(url: &str) -> Self {
        Self {
            asked: Mutex::default(),
            url: url.to_owned(),
        }
    }
}

impl GithubTokens for SpyGithubTokens {
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        repo: &RepoSlug,
    ) -> Result<UpstreamCall, EgressError> {
        self.asked
            .lock()
            .expect("lock")
            .push((owner.to_string(), repo.to_string()));

        UpstreamCall::basic(
            Url::parse(&self.url).expect("url"),
            "x-access-token",
            "ghs-installation-token",
        )
    }
}

/// Records the request it was handed, and answers with a fixed response.
struct SpyForwarder {
    seen: Mutex<Option<http::request::Parts>>,
    status: StatusCode,
    response_headers: HeaderMap,
}

impl SpyForwarder {
    fn answering(response_headers: &[(&str, &str)]) -> Self {
        Self {
            seen: Mutex::default(),
            status: StatusCode::ACCEPTED,
            response_headers: header_map(response_headers),
        }
    }

    /// An upstream answering every request with `status`.
    fn answering_with(status: StatusCode) -> Self {
        Self {
            status,
            ..Self::answering(&[])
        }
    }

    fn was_called(&self) -> bool {
        self.seen.lock().expect("lock").is_some()
    }

    fn forwarded<T>(&self, read: impl Fn(&http::request::Parts) -> T) -> T {
        read(
            self.seen
                .lock()
                .expect("lock")
                .as_ref()
                .expect("forwarder was called"),
        )
    }
}

impl Forwarder for SpyForwarder {
    async fn forward(&self, request: ProxyRequest) -> Result<ProxyResponse, EgressError> {
        let (parts, _body) = request.into_parts();
        *self.seen.lock().expect("lock") = Some(parts);

        let mut response = http::Response::new(empty_body());
        *response.status_mut() = self.status;
        *response.headers_mut() = self.response_headers.clone();
        Ok(response)
    }
}

fn request(method: Method, header_pairs: &[(&str, &str)]) -> ProxyRequest {
    let mut request = http::Request::new(empty_body());
    *request.method_mut() = method;
    *request.headers_mut() = header_map(header_pairs);
    request
}

fn json_request(body: &str) -> ProxyRequest {
    let mut request = http::Request::new(
        Full::new(bytes::Bytes::from(body.to_owned()))
            .map_err(|never| match never {})
            .boxed_unsync(),
    );
    *request.method_mut() = Method::POST;
    request
}

fn listing(slug: &str, name: &str) -> McpServerListing {
    McpServerListing {
        slug: McpServerSlug::parse(slug).expect("slug"),
        name: name.to_owned(),
    }
}

fn selected(listings: &[(&str, &str)]) -> Vec<McpServerListing> {
    listings
        .iter()
        .map(|(slug, name)| listing(slug, name))
        .collect()
}

async fn body_json(response: ProxyResponse) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("json body")
}

/// The selected app list is a permission: the service scopes resolution to
/// the agent's selection, and a destination outside it is refused with
/// nothing forwarded, though the owner may have it connected.
#[tokio::test]
async fn a_destination_outside_the_agents_selection_is_refused() {
    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("linear", "Linear")])),
        SpyCredentials::out_of_scope(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::OutOfScope), "{error:?}");
    assert!(!service.forward.was_called());
    assert_eq!(
        *service.credentials.selections.lock().expect("lock"),
        [Selection::Apps(vec![
            ConnectorId::parse("linear").expect("slug")
        ])]
    );
}

/// An agent given everything resolves with nothing narrowed.
#[tokio::test]
async fn an_agent_given_everything_resolves_unscoped() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .expect("forwarded");

    assert_eq!(
        *service.credentials.selections.lock().expect("lock"),
        [Selection::All]
    );
}

/// With no name from the agent, the refusal calls the app by its slug made
/// readable, so the person sees "Google Sheets" rather than "google_sheets".
#[tokio::test]
async fn an_unlisted_unconnected_app_is_named_from_its_slug() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::unconnected(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );
    let sheets = EgressTarget::McpServer(McpDestination::Connected(
        McpServerSlug::parse("google_sheets").expect("slug"),
    ));

    let response = service
        .proxy(
            &SessionToken::new("token"),
            sheets,
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#),
        )
        .await
        .expect("answered");

    let body = body_json(response).await;
    let text = body["result"]["content"][0]["text"]
        .as_str()
        .expect("a text content block");
    assert!(text.contains("Google Sheets is not connected"), "{text}");
    assert!(
        text.contains(
            r#"<m-connect-app>{"appSlug":"google_sheets","name":"Google Sheets"}</m-connect-app>"#
        ),
        "{text}"
    );
}

/// A listed app the owner has connected proxies exactly like before.
#[tokio::test]
async fn a_listed_connected_app_is_forwarded() {
    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#),
        )
        .await
        .expect("proxied");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(service.forward.was_called());
}

/// A `tools/call` to an app the owner has not connected is answered by the
/// proxy as the tool's own result, under the name the agent gave the app: the
/// model reads that the app is not connected and how to get it connected,
/// and nothing reaches the upstream.
#[tokio::test]
async fn a_tools_call_to_an_unconnected_app_is_answered_locally() {
    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
        SpyCredentials::unconnected(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(
                r#"{"jsonrpc":"2.0","id":"call-7","method":"tools/call","params":{"name":"list_monitors","arguments":{"secret":"do-not-echo"}}}"#,
            ),
        )
        .await
        .expect("answered");

    assert!(!service.forward.was_called());
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[http::header::CONTENT_TYPE],
        "application/json"
    );
    let body = body_json(response).await;
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], "call-7");
    assert_eq!(body["result"]["isError"], true);
    let text = body["result"]["content"][0]["text"]
        .as_str()
        .expect("a text content block");
    assert!(text.contains("Datadog is not connected"), "{text}");
    assert!(
        text.contains(r#"<m-connect-app>{"appSlug":"datadog","name":"Datadog"}</m-connect-app>"#),
        "{text}"
    );
    assert!(
        text.contains("let you know once they have connected Datadog"),
        "{text}"
    );
    assert!(!text.contains("do-not-echo"), "{text}");
    assert!(!text.contains("list_monitors"), "{text}");
}

/// An app the owner cannot use has no upstream to reach, so the proxy
/// answers its client itself: the handshake completes, the listing offers
/// the one tool that says how to connect, notifications are accepted, and
/// the event stream and session teardown are refused. Nothing is forwarded.
#[tokio::test]
async fn the_handshake_and_listing_of_an_unconnected_app_are_answered_locally() {
    for (method, body, status) in [
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#),
            StatusCode::OK,
        ),
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#),
            StatusCode::OK,
        ),
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
            StatusCode::ACCEPTED,
        ),
        (Method::GET, None, StatusCode::METHOD_NOT_ALLOWED),
        (Method::DELETE, None, StatusCode::METHOD_NOT_ALLOWED),
    ] {
        let service = EgressServiceImpl::new(
            StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
            SpyCredentials::unconnected(),
            SpyGithubTokens::default(),
            SpyForwarder::answering(&[]),
        );
        let request = match body {
            Some(body) => json_request(body),
            None => request(method.clone(), &[]),
        };

        let response = service
            .proxy(&SessionToken::new("token"), datadog(), request)
            .await
            .expect("answered");

        assert_eq!(response.status(), status, "{method} {body:?}");
        assert!(!service.forward.was_called(), "{method} {body:?}");
        if status == StatusCode::OK {
            let answer = body_json(response).await;
            assert!(answer.get("error").is_none(), "{answer}");
            if body.is_some_and(|body| body.contains("tools/list")) {
                assert_eq!(answer["result"]["tools"][0]["name"], CONNECT_TOOL_NAME);
                let description = answer["result"]["tools"][0]["description"]
                    .as_str()
                    .expect("a description");
                assert!(
                    description.contains("Datadog is not connected"),
                    "{description}"
                );
            }
        }
    }
}

/// An app the owner has not connected whose upstream addresses them anyway
/// (Pipedream) behaves as on a connected one until a tool runs: the
/// handshake, the listing, notifications, the event stream and teardown are
/// forwarded with the owner's credential, so the session sees the app's
/// real tools. Only a `tools/call` is answered here, with how to connect.
#[tokio::test]
async fn an_addressable_unconnected_app_forwards_everything_but_a_tool_call() {
    for (method, body) in [
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#),
        ),
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#),
        ),
        (
            Method::POST,
            Some(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
        ),
        (Method::GET, None),
        (Method::DELETE, None),
    ] {
        let service = EgressServiceImpl::new(
            StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
            SpyCredentials::addressable(),
            SpyGithubTokens::default(),
            SpyForwarder::answering(&[]),
        );
        let request = match body {
            Some(body) => json_request(body),
            None => request(method.clone(), &[]),
        };

        service
            .proxy(&SessionToken::new("token"), datadog(), request)
            .await
            .expect("forwarded");

        assert!(service.forward.was_called(), "{method} {body:?}");
        assert_eq!(
            service
                .forward
                .forwarded(|parts| parts.headers[AUTHORIZATION].clone()),
            "Bearer upstream-token",
            "{method} {body:?}"
        );
    }

    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
        SpyCredentials::addressable(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(
                r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_monitors","arguments":{}}}"#,
            ),
        )
        .await
        .expect("answered");

    assert!(!service.forward.was_called());
    let body = body_json(response).await;
    assert_eq!(body["id"], 7);
    assert_eq!(body["result"]["isError"], true);
    let text = body["result"]["content"][0]["text"].as_str().expect("text");
    assert!(
        text.contains(r#"<m-connect-app>{"appSlug":"datadog","name":"Datadog"}</m-connect-app>"#),
        "{text}"
    );
}

/// A session that listed the connect tool before the owner connected the
/// app keeps that listing; calling it once the app is connected is answered
/// here, since the app's server has no such tool. Its real tools go through.
#[tokio::test]
async fn the_connect_tool_called_after_connecting_is_answered_locally() {
    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(&format!(
                r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"{CONNECT_TOOL_NAME}","arguments":{{}}}}}}"#
            )),
        )
        .await
        .expect("answered");

    assert!(!service.forward.was_called());
    let body = body_json(response).await;
    assert_eq!(body["id"], 3);
    let text = body["result"]["content"][0]["text"].as_str().expect("text");
    assert!(text.contains("Datadog is connected now"), "{text}");

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(
                r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_monitors","arguments":{}}}"#,
            ),
        )
        .await
        .expect("forwarded");
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(service.forward.was_called());
}

/// The one path that reads a request body is bounded.
#[tokio::test]
async fn an_oversized_request_to_an_unconnected_app_is_refused() {
    let service = EgressServiceImpl::new(
        StubSessions::granting_with(selected(&[("datadog", "Datadog")])),
        SpyCredentials::unconnected(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );
    let huge = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"pad":"{}"}}}}"#,
        "x".repeat(crate::domain::model::MAX_MCP_REQUEST_BYTES)
    );

    let error = service
        .proxy(&SessionToken::new("token"), datadog(), json_request(&huge))
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::RequestTooLarge));
    assert!(!service.forward.was_called());
}

fn datadog() -> EgressTarget {
    EgressTarget::McpServer(McpDestination::Connected(
        McpServerSlug::parse("datadog").expect("slug"),
    ))
}

fn wiki() -> EgressTarget {
    EgressTarget::McpServer(McpDestination::Custom(CustomMcpServerKey::for_url(WIKI)))
}

/// A custom server with a live grant proxies like a connected app: the
/// owner's bearer is stamped on in place of the session token.
#[tokio::test]
async fn a_connected_custom_server_is_forwarded_with_the_owners_bearer() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::at(WIKI),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("session-token"),
            wiki(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#),
        )
        .await
        .expect("proxied");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        *service.credentials.asked.lock().expect("lock"),
        [(owner().to_string(), "custom".to_owned())]
    );
    service.forward.forwarded(|parts| {
        assert_eq!(parts.uri.to_string(), WIKI);
        assert_eq!(
            parts
                .headers
                .get_all(AUTHORIZATION)
                .iter()
                .collect::<Vec<_>>(),
            ["Bearer upstream-token"]
        );
    });
}

/// A custom server the owner added without connecting an account is dialed
/// bare - and bare means bare: the session token is stripped and nothing is
/// stamped in its place.
#[tokio::test]
async fn an_anonymous_custom_server_is_forwarded_without_any_authorization() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::anonymous(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("session-token"),
            wiki(),
            request(
                Method::POST,
                &[
                    ("authorization", "Bearer session-token"),
                    ("mcp-session-id", "s1"),
                ],
            ),
        )
        .await
        .expect("proxied");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    service.forward.forwarded(|parts| {
        assert_eq!(parts.uri.to_string(), WIKI);
        assert!(parts.headers.get(AUTHORIZATION).is_none());
        assert_eq!(parts.headers["mcp-session-id"], "s1");
    });
}

/// A `tools/call` to a custom server whose grant has died is answered by the
/// proxy under the owner's own name for the server, telling the model how
/// to get it reconnected; nothing reaches the upstream, and there is no
/// connect chip, since that chip opens the Pipedream catalog.
#[tokio::test]
async fn a_tools_call_to_a_disconnected_custom_server_is_answered_locally() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::disconnected(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            wiki(),
            json_request(
                r#"{"jsonrpc":"2.0","id":"call-9","method":"tools/call","params":{"name":"search","arguments":{"secret":"do-not-echo"}}}"#,
            ),
        )
        .await
        .expect("answered");

    assert!(!service.forward.was_called());
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["id"], "call-9");
    assert_eq!(body["result"]["isError"], true);
    let text = body["result"]["content"][0]["text"]
        .as_str()
        .expect("a text content block");
    assert!(text.contains("Team wiki is a custom MCP server"), "{text}");
    assert!(text.contains("Sign in"), "{text}");
    assert!(!text.contains("m-connect-app"), "{text}");
    assert!(!text.contains("do-not-echo"), "{text}");
}

/// A disconnected custom server is answered locally too: its listing offers
/// the tool whose answer says how to reconnect, and nothing is forwarded.
#[tokio::test]
async fn the_listing_of_a_disconnected_custom_server_is_answered_locally() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::disconnected(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            wiki(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .expect("answered");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(!service.forward.was_called());
    let body = body_json(response).await;
    assert_eq!(body["result"]["tools"][0]["name"], CONNECT_TOOL_NAME);
}

/// The resolver's refusal of a key that names none of the owner's servers
/// passes through, and nothing is forwarded.
#[tokio::test]
async fn an_unknown_custom_server_is_refused() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::empty(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            wiki(),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::UnknownServer(_)));
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn addresses_the_request_at_the_resolved_upstream_and_passes_the_status_back() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        service.forward.forwarded(|parts| parts.uri.to_string()),
        "https://mcp.example.com/mcp"
    );
}

/// The whole point of the service: the sandbox's credential for us must not
/// reach a third-party server, which would let that server spend this
/// session's egress. What arrives upstream is the owner's credential, and
/// only that.
#[tokio::test]
async fn replaces_the_sandboxs_token_with_the_owners() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("session-token"),
            datadog(),
            request(
                Method::POST,
                &[
                    ("authorization", "Bearer session-token"),
                    ("mcp-session-id", "abc123"),
                ],
            ),
        )
        .await
        .expect("proxied");

    let stamped = service.forward.forwarded(|parts| {
        parts
            .headers
            .get_all(AUTHORIZATION)
            .iter()
            .map(|value| value.to_str().expect("ascii").to_owned())
            .collect::<Vec<_>>()
    });

    assert_eq!(stamped, ["Bearer upstream-token"], "exactly one credential");
    assert_eq!(
        service.forward.forwarded(|parts| names(&parts.headers)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>()),
        ["mcp-session-id", "authorization"]
    );
}

/// Pipedream reads *whose* connected account to spend off
/// `x-pd-external-user-id`, so those headers are part of the credential: the
/// stamped values must come from resolution, and a sandbox that sends its own
/// must not be able to act as anybody else.
#[tokio::test]
async fn stamps_the_resolved_scope_over_whatever_the_sandbox_claimed() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::scoped(&[
            ("x-pd-external-user-id", "the-owner"),
            ("x-pd-app-slug", "datadog"),
        ]),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("session-token"),
            datadog(),
            request(
                Method::POST,
                &[
                    ("authorization", "Bearer session-token"),
                    // The sandbox claiming to be somebody else, and a scoping
                    // header resolution never stamps at all.
                    ("x-pd-external-user-id", "somebody-else"),
                    ("x-pd-tool-mode", "full-config"),
                ],
            ),
        )
        .await
        .expect("proxied");

    // Sorted, because a `HeaderMap` decides its own iteration order.
    let mut scope = service.forward.forwarded(|parts| {
        parts
            .headers
            .iter()
            .filter(|(name, _)| name.as_str().starts_with("x-pd-"))
            .map(|(name, value)| {
                (
                    name.as_str().to_owned(),
                    value.to_str().expect("ascii").to_owned(),
                )
            })
            .collect::<Vec<_>>()
    });
    scope.sort();

    assert_eq!(
        scope,
        [
            ("x-pd-app-slug".to_owned(), "datadog".to_owned()),
            ("x-pd-external-user-id".to_owned(), "the-owner".to_owned()),
        ],
        "exactly the resolved scope, nothing the sandbox sent"
    );
}

#[tokio::test]
async fn strips_hop_by_hop_headers_from_the_response() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[
            ("mcp-session-id", "abc123"),
            ("set-cookie", "upstream=1"),
            ("transfer-encoding", "chunked"),
        ]),
    );

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(names(response.headers()), ["mcp-session-id"]);
}

/// Egress is open to every session owner, not only Macro staff: an outside
/// owner's call resolves against their own connections and goes through.
#[tokio::test]
async fn a_session_owned_outside_macro_is_proxied_with_its_owners_credentials() {
    let visitor = MacroUserIdStr::try_from_email("visitor@example.com").expect("a valid user id");
    let service = EgressServiceImpl::new(
        StubSessions(Ok(SessionGrant {
            session: AgentSessionId::new(),
            owner: visitor.clone(),
            agent: BotId::TEST_A,
            repo: None,
            mcp_servers: Vec::new(),
            selection: Selection::All,
            prompter: None,
        })),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(
        service
            .credentials
            .asked
            .lock()
            .expect("lock")
            .iter()
            .map(|(owner, _)| owner.clone())
            .collect::<Vec<_>>(),
        [visitor.to_string()]
    );
    assert!(service.forward.was_called());
}

/// Resolution reads the owner's connected servers, so an unverified token
/// must not get that far - otherwise a bad token is still an oracle for which
/// servers somebody has connected.
#[tokio::test]
async fn an_unverified_token_never_reaches_credential_resolution() {
    let service = EgressServiceImpl::new(
        StubSessions::refusing(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("forged"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::Unauthenticated(_)));
    assert!(service.credentials.asked.lock().expect("lock").is_empty());
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn resolves_only_against_the_session_owner() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(
        *service.credentials.asked.lock().expect("lock"),
        vec![(owner().to_string(), "datadog".to_owned())]
    );
}

#[tokio::test]
async fn an_unknown_server_is_refused_before_anything_is_forwarded() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::empty(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::UnknownServer(slug) if slug.as_str() == "datadog"));
    assert!(!service.forward.was_called());
}

/// A verb outside the allowlist is refused before the token is even looked
/// at, so an unsupported method cannot be used to probe anything.
#[tokio::test]
async fn a_disallowed_method_is_refused_up_front() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::PUT, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::MethodNotAllowed(method) if method == Method::PUT));
    assert!(service.credentials.asked.lock().expect("lock").is_empty());
    assert!(!service.forward.was_called());
}

fn git(endpoint: GitEndpoint) -> EgressTarget {
    EgressTarget::GitHubGit { endpoint }
}

/// The endpoint comes from the allowlist and is appended to whatever the
/// credential adapter addressed, so no adapter can widen the reachable set.
#[tokio::test]
async fn addresses_a_git_request_at_the_repositorys_endpoint() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("token"),
            git(GitEndpoint::InfoRefs {
                service: GitService::UploadPack,
            }),
            request(Method::GET, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(
        service.forward.forwarded(|parts| parts.uri.to_string()),
        "https://github.com/macro/wolf.git/info/refs?service=git-upload-pack"
    );
}

/// git talks to us through a credential helper, so the session token arrives
/// as a Basic password. It must still be replaced, not accompanied - and the
/// replacement is the installation token, also as a Basic password.
#[tokio::test]
async fn replaces_the_sandboxs_basic_credential_on_a_git_request() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("session-token"),
            git(GitEndpoint::UploadPack),
            request(
                Method::POST,
                &[("authorization", "Basic bWFjcm86c2Vzc2lvbi10b2tlbg==")],
            ),
        )
        .await
        .expect("proxied");

    let stamped = service.forward.forwarded(|parts| {
        parts
            .headers
            .get_all(AUTHORIZATION)
            .iter()
            .map(|value| value.to_str().expect("ascii").to_owned())
            .collect::<Vec<_>>()
    });

    assert_eq!(
        stamped,
        [UpstreamCredential::Basic {
            username: "x-access-token".to_owned(),
            secret: "ghs-installation-token".to_owned(),
        }
        .header_value()
        .expect("header value")
        .expect("a credential to stamp")
        .to_str()
        .expect("ascii")],
        "exactly one credential",
    );
}

#[tokio::test]
async fn an_unverified_token_never_reaches_git_token_minting() {
    let service = EgressServiceImpl::new(
        StubSessions::refusing(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("forged"),
            git(GitEndpoint::UploadPack),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::Unauthenticated(_)));
    assert!(service.tokens.asked.lock().expect("lock").is_empty());
    assert!(!service.forward.was_called());
}

/// The sandbox has no way to name a repository - the git route has no place
/// to put one - so what gets minted is always the grant's.
#[tokio::test]
async fn mints_for_the_grants_repository_and_owner() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    service
        .proxy(
            &SessionToken::new("token"),
            git(GitEndpoint::UploadPack),
            request(Method::POST, &[]),
        )
        .await
        .expect("proxied");

    assert_eq!(
        *service.tokens.asked.lock().expect("lock"),
        vec![(owner().to_string(), "macro/wolf".to_owned())]
    );
    assert!(service.credentials.asked.lock().expect("lock").is_empty());
}

/// `mcp_servers.url` is typed in by a person. A cleartext one would put the
/// owner's OAuth token on the wire for anyone on the path, so it never gets
/// stamped at all.
#[tokio::test]
async fn a_cleartext_mcp_server_never_receives_the_owners_token() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::at("http://mcp.example.com/mcp"),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::InsecureUpstream(_)));
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn a_cleartext_git_base_is_refused_too() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::at("http://github.com/macro/wolf.git/"),
        SpyForwarder::answering(&[]),
    );

    let error = service
        .proxy(
            &SessionToken::new("token"),
            git(GitEndpoint::UploadPack),
            request(Method::POST, &[]),
        )
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::InsecureUpstream(_)));
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn a_session_without_a_repository_can_use_mcp_but_cannot_mint_git_credentials() {
    let service = EgressServiceImpl::new(
        StubSessions(Ok(SessionGrant {
            session: AgentSessionId::new(),
            owner: owner(),
            agent: BotId::TEST_A,
            repo: None,
            mcp_servers: Vec::new(),
            selection: Selection::All,
            prompter: None,
        })),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );
    for target in [EgressTarget::McpServer(McpDestination::Macro), datadog()] {
        service
            .proxy(
                &SessionToken::new("token"),
                target,
                request(Method::POST, &[]),
            )
            .await
            .expect("MCP does not require a repository");
    }
    let error = service
        .proxy(
            &SessionToken::new("token"),
            git(GitEndpoint::InfoRefs {
                service: GitService::UploadPack,
            }),
            request(Method::GET, &[]),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        EgressError::Unauthenticated("the session has no repository for git access")
    ));
    assert!(service.tokens.asked.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn preview_uses_only_the_authenticated_session_token_at_a_fixed_destination() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    )
    .with_preview_mcp(
        "https://preview-control.example/mcp".parse().unwrap(),
        false,
    )
    .unwrap();
    service
        .proxy(
            &SessionToken::new("session-token"),
            EgressTarget::McpServer(McpDestination::Preview),
            request(Method::POST, &[("authorization", "Bearer attacker-token")]),
        )
        .await
        .unwrap();
    assert_eq!(
        service.forward.forwarded(|parts| parts.uri.to_string()),
        "https://preview-control.example/mcp"
    );
    assert_eq!(
        service
            .forward
            .forwarded(|parts| parts.headers[AUTHORIZATION].to_str().unwrap().to_owned()),
        "Bearer session-token"
    );
    assert!(service.credentials.asked.lock().unwrap().is_empty());
}

fn asker() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@macro.com").expect("a valid user id")
}

/// A grant whose running turn `prompter` prompted.
fn prompted_by(prompter: Option<MacroUserIdStr<'static>>) -> StubSessions {
    let StubSessions(Ok(mut grant)) =
        StubSessions::granting_with(selected(&[("datadog", "Datadog")]))
    else {
        unreachable!("granting grants");
    };
    grant.prompter = Some(crate::domain::model::TurnPrompter {
        kind: agent_session::domain::model::PrompterKind::User,
        action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
        user: prompter,
        client: None,
    });
    StubSessions(Ok(grant))
}

/// Records what it was asked to hold or withdraw, and answers a hold with a
/// marker status so a test can tell the hold answered.
#[derive(Default)]
struct RecordingApprovals {
    held: Mutex<
        Vec<(
            String,
            String,
            crate::domain::approval::ToolsCall,
            http::request::Parts,
        )>,
    >,
    withdrawn: Mutex<Vec<serde_json::Value>>,
    held_in_process: Mutex<Vec<crate::domain::approval::InProcessCall>>,
    /// How an in-process hold is answered; nobody answering expires it.
    answer: Mutex<Option<agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus>>,
}

impl OwnerApprovals for RecordingApprovals {
    async fn hold(&self, call: HeldCall) -> Result<ProxyResponse, EgressError> {
        let (parts, _body) = call.request.into_parts();
        self.held
            .lock()
            .unwrap()
            .push((call.server_slug, call.server_name, call.call, parts));
        let mut response = http::Response::new(empty_body());
        *response.status_mut() = StatusCode::IM_USED;
        Ok(response)
    }

    async fn withdraw(
        &self,
        _session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> Result<(), EgressError> {
        self.withdrawn.lock().unwrap().push(request_id.clone());
        Ok(())
    }

    async fn hold_in_process(
        &self,
        call: crate::domain::approval::InProcessCall,
    ) -> Result<agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus, EgressError>
    {
        self.held_in_process.lock().unwrap().push(call);
        Ok(self
            .answer
            .lock()
            .unwrap()
            .unwrap_or(agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus::Expired))
    }
}

const TOOLS_CALL: &str = r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"q":"x"}}}"#;

fn gated(
    sessions: StubSessions,
    credentials: SpyCredentials,
) -> EgressServiceImpl<
    StubSessions,
    SpyCredentials,
    SpyGithubTokens,
    SpyForwarder,
    RecordingApprovals,
> {
    EgressServiceImpl::new(
        sessions,
        credentials,
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    )
    .with_owner_approvals(RecordingApprovals::default())
}

/// The owner's own turn spends their access without asking anyone.
#[tokio::test]
async fn a_tool_call_in_a_turn_the_owner_prompted_goes_straight_through() {
    let service = gated(prompted_by(Some(owner())), SpyCredentials::knowing());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("proxied");
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(service.forward.was_called());
    assert!(service.approvals.held.lock().unwrap().is_empty());
}

/// A program prompting for the owner acts with their access: its turn's
/// calls run as the owner's own do, with nothing held.
#[tokio::test]
async fn a_tool_call_in_a_turn_a_program_prompted_for_the_owner_goes_straight_through() {
    let StubSessions(Ok(mut grant)) = prompted_by(Some(owner())) else {
        unreachable!("granting grants");
    };
    if let Some(prompter) = grant.prompter.as_mut() {
        prompter.kind = agent_session::domain::model::PrompterKind::Program;
    }
    let service = gated(StubSessions(Ok(grant)), SpyCredentials::knowing());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("proxied");
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(service.forward.was_called());
    assert!(service.approvals.held.lock().unwrap().is_empty());
}

/// Somebody else's turn holds the call, already addressed and stamped with
/// the owner's credential, and nothing reaches the upstream yet.
#[tokio::test]
async fn a_tool_call_in_a_turn_somebody_else_prompted_is_held_for_the_owner() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("held");
    assert_eq!(response.status(), StatusCode::IM_USED, "the hold answered");
    assert!(!service.forward.was_called());

    let held = service.approvals.held.lock().unwrap();
    let [(slug, name, call, parts)] = held.as_slice() else {
        panic!("one call was held");
    };
    assert_eq!((slug.as_str(), name.as_str()), ("datadog", "Datadog"));
    assert_eq!(call.name, "search");
    assert_eq!(call.id, serde_json::json!(9));
    assert_eq!(parts.uri, "https://mcp.example.com/mcp");
    assert!(
        parts.headers.contains_key(AUTHORIZATION),
        "stamped before holding, so approval only has to send it"
    );
}

/// A bot acting on nobody's behalf is not the owner either.
#[tokio::test]
async fn a_tool_call_in_a_turn_a_bot_prompted_is_held_too() {
    let service = gated(prompted_by(None), SpyCredentials::knowing());
    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("held");
    assert_eq!(service.approvals.held.lock().unwrap().len(), 1);
}

/// Macro's own server is gated like any connected app, under its own name.
#[tokio::test]
async fn a_tool_call_to_macros_own_server_is_held_under_its_name() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing());
    service
        .proxy(
            &SessionToken::new("token"),
            EgressTarget::McpServer(McpDestination::Macro),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("held");
    let held = service.approvals.held.lock().unwrap();
    assert_eq!((held[0].0.as_str(), held[0].1.as_str()), ("macro", "Macro"));
}

fn google_drive() -> EgressTarget {
    EgressTarget::McpServer(McpDestination::Connected(
        McpServerSlug::parse("google_drive").expect("slug"),
    ))
}

/// A change to the owner's Drive waits for them even in their own turn.
#[tokio::test]
async fn a_drive_write_in_the_owners_own_turn_is_held_for_them() {
    let service = gated(prompted_by(Some(owner())), SpyCredentials::knowing());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            google_drive(),
            json_request(
                r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"trash_file","arguments":{"fileId":"f"}}}"#,
            ),
        )
        .await
        .expect("held");
    assert_eq!(response.status(), StatusCode::IM_USED, "the hold answered");
    assert!(!service.forward.was_called());
    let held = service.approvals.held.lock().unwrap();
    let [(slug, name, call, _)] = held.as_slice() else {
        panic!("one call was held");
    };
    assert_eq!(
        (slug.as_str(), name.as_str(), call.name.as_str()),
        ("google_drive", "Google Drive", "trash_file")
    );
}

/// Reading the owner's Drive in their own turn asks nobody.
#[tokio::test]
async fn a_drive_read_in_the_owners_own_turn_goes_straight_through() {
    let service = gated(prompted_by(Some(owner())), SpyCredentials::knowing());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            google_drive(),
            json_request(
                r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"search_files","arguments":{"query":"x"}}}"#,
            ),
        )
        .await
        .expect("proxied");
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(service.forward.was_called());
    assert!(service.approvals.held.lock().unwrap().is_empty());
}

/// Only `tools/call` runs anything; the handshake and listing still flow so
/// the agent sees its tools.
#[tokio::test]
async fn listing_tools_in_a_gated_turn_is_not_held() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing());
    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .expect("proxied");
    assert!(service.forward.was_called());
    assert!(service.approvals.held.lock().unwrap().is_empty());
}

/// The agent giving up on a held request reaches the hold, and the
/// notification still goes upstream.
#[tokio::test]
async fn a_cancelled_request_is_withdrawn_from_the_hold_and_forwarded() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing());
    service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(
                r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":9}}"#,
            ),
        )
        .await
        .expect("proxied");
    assert_eq!(
        *service.approvals.withdrawn.lock().unwrap(),
        [serde_json::json!(9)]
    );
    assert!(service.forward.was_called());
}

/// Nothing would run for an app the owner has not connected, so nobody is
/// asked: the not-connected answer comes back as before.
#[tokio::test]
async fn an_unconnected_app_in_a_gated_turn_is_answered_without_asking() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::unconnected());
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("answered");
    let body = body_json(response).await;
    assert_eq!(body["result"]["isError"], true);
    assert!(service.approvals.held.lock().unwrap().is_empty());
    assert!(!service.forward.was_called());
}

/// A proxy built without approvals fails closed.
#[tokio::test]
async fn without_approvals_a_gated_tool_call_is_refused() {
    let service = EgressServiceImpl::new(
        prompted_by(Some(asker())),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    );
    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(TOOLS_CALL),
        )
        .await
        .expect("answered");
    let body = body_json(response).await;
    assert_eq!(body["id"], 9);
    assert_eq!(body["result"]["isError"], true);
    assert!(!service.forward.was_called());
}

/// Looking something up on the public web spends nobody's access, so even a
/// turn somebody else prompted searches without asking.
#[tokio::test]
async fn a_public_web_search_in_a_gated_turn_goes_straight_through() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing());
    service
        .proxy(
            &SessionToken::new("token"),
            EgressTarget::McpServer(McpDestination::Macro),
            json_request(
                r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"WebSearch","arguments":{"input":"rust"}}}"#,
            ),
        )
        .await
        .expect("proxied");
    assert!(service.forward.was_called());
    assert!(service.approvals.held.lock().unwrap().is_empty());
}

mod actor;
mod sign_in;
mod telemetry;
