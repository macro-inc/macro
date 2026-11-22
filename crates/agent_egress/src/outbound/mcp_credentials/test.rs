use super::*;
use crate::domain::model::EgressTarget;
use crate::domain::model::{
    AgentSessionId, McpServerSlug, ProxyBody, ProxyRequest, ProxyResponse, RepoSlug, SessionGrant,
    SessionToken, UpstreamCredential,
};
use crate::domain::ports::{Forwarder, GithubTokens, SessionAuthority};
use crate::domain::service::{EgressService, EgressServiceImpl};
use bot_id::BotId;
use connectors::fake::{FakeConnection, FakeConnectors};
use http::header::AUTHORIZATION;
use http::{Method, StatusCode};
use http_body_util::{BodyExt, Empty, Full};
use std::sync::Mutex;

const WIKI: &str = "https://wiki.example.com/mcp";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn app(slug: &str) -> McpDestination {
    McpDestination::Connected(McpServerSlug::parse(slug).expect("a valid slug"))
}

fn wiki() -> McpDestination {
    McpDestination::Custom(CustomMcpServerKey::for_url(WIKI))
}

fn apps(slugs: &[&str]) -> Selection {
    Selection::Apps(
        slugs
            .iter()
            .map(|slug| ConnectorId::parse(slug).expect("a valid slug"))
            .collect(),
    )
}

/// The owner holds Linear and the wiki server, and Datadog is in the
/// catalog but not connected.
fn connectors() -> FakeConnectors {
    FakeConnectors::new()
        .with_catalog_app("datadog")
        .with_connection(&owner(), FakeConnection::app("linear").named("Linear"))
        .with_connection(&owner(), FakeConnection::server(WIKI).named("Team wiki"))
}

fn credentials(
    fake: &FakeConnectors,
) -> ConnectorsMcpCredentials<connectors::domain::service::Connectors> {
    ConnectorsMcpCredentials::new(Arc::new(fake.build()))
}

async fn resolve(
    fake: &FakeConnectors,
    selection: &Selection,
    destination: &McpDestination,
) -> Result<McpResolution, EgressError> {
    credentials(fake)
        .resolve(
            &owner(),
            BotId::TEST_A,
            uuid::Uuid::nil(),
            selection,
            destination,
        )
        .await
}

fn bearer(call: &UpstreamCall) -> Option<String> {
    match call.authorization() {
        UpstreamCredential::Bearer(token) => Some(token.as_str().to_owned()),
        _ => None,
    }
}

/// An agent given everything reaches the owner's connected app with the
/// credential the connectors service hands out for it.
#[tokio::test]
async fn a_connected_app_resolves_to_its_upstream_for_an_agent_given_everything() {
    let McpResolution::Connected(call) = resolve(&connectors(), &Selection::All, &app("linear"))
        .await
        .expect("resolved")
    else {
        panic!("a connected app resolves as connected");
    };

    assert_eq!(call.url().host_str(), Some("upstream.fake.test"));
    assert_eq!(bearer(&call).as_deref(), Some("fake-token"));
}

/// A selected list lets the agent reach the apps on it.
#[tokio::test]
async fn a_selected_app_the_owner_connected_is_permitted() {
    let resolution = resolve(&connectors(), &apps(&["linear"]), &app("linear"))
        .await
        .expect("resolved");

    assert!(matches!(resolution, McpResolution::Connected(_)));
}

/// The selected list is a permission: a connected app the agent was not
/// given is refused, not resolved against the owner's connections.
#[tokio::test]
async fn a_connected_app_outside_the_agents_list_is_refused() {
    let error = resolve(&connectors(), &apps(&["datadog"]), &app("linear"))
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::OutOfScope), "{error:?}");
}

/// A listed app the owner cannot use yet is not refused: it resolves as not
/// connected, so the proxy answers with how to connect it. Never connected,
/// turned off and needing authorization again all read the same.
#[tokio::test]
async fn a_listed_app_the_owner_cannot_use_resolves_as_not_connected() {
    for fake in [
        connectors(),
        connectors().with_connection(&owner(), FakeConnection::app("datadog").disabled()),
        connectors().with_connection(&owner(), FakeConnection::app("datadog").needs_reauth()),
    ] {
        let resolution = resolve(&fake, &apps(&["datadog"]), &app("datadog"))
            .await
            .expect("resolved");

        assert!(
            matches!(resolution, McpResolution::NotConnected),
            "{resolution:?}"
        );
    }
}

/// `slack_v2` and `slack` are one app: either slug reaches the one
/// connection.
#[tokio::test]
async fn an_aliased_slug_reaches_the_apps_connection() {
    let fake = FakeConnectors::new().with_connection(&owner(), FakeConnection::app("slack"));

    let resolution = resolve(&fake, &apps(&["slack"]), &app("slack_v2"))
        .await
        .expect("resolved");

    assert!(matches!(resolution, McpResolution::Connected(_)));
}

/// A custom server is found by the key of its address, for an agent given
/// everything.
#[tokio::test]
async fn a_custom_server_resolves_by_its_key() {
    let McpResolution::Connected(call) = resolve(&connectors(), &Selection::All, &wiki())
        .await
        .expect("resolved")
    else {
        panic!("a usable server resolves as connected");
    };

    assert_eq!(bearer(&call).as_deref(), Some("fake-token"));
}

/// An agent with a selected app list reaches no server added by URL.
#[tokio::test]
async fn a_custom_server_is_refused_to_an_agent_with_a_selected_list() {
    let error = resolve(&connectors(), &apps(&["linear"]), &wiki())
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::OutOfScope), "{error:?}");
}

/// A key that names no usable server of the owner's has nowhere to go: one
/// never added, or one turned off.
#[tokio::test]
async fn a_custom_server_the_owner_cannot_use_is_unknown() {
    let turned_off =
        FakeConnectors::new().with_connection(&owner(), FakeConnection::server(WIKI).disabled());

    for fake in [FakeConnectors::new(), turned_off] {
        let error = resolve(&fake, &Selection::All, &wiki())
            .await
            .expect_err("refused");

        assert!(
            matches!(error, EgressError::UnknownCustomServer(_)),
            "{error:?}"
        );
    }
}

/// Macro's own server is layered on by `WithMacroMcp`; reaching here for it
/// is a wiring mistake, not a permission question.
#[tokio::test]
async fn macros_own_server_is_not_resolved_here() {
    let error = resolve(&connectors(), &Selection::All, &McpDestination::Macro)
        .await
        .expect_err("refused");

    assert!(matches!(error, EgressError::Internal(_)), "{error:?}");
}

// The egress proxy over the real connection services: what a sandbox's
// request reaches, end to end through the domain service.

/// Grants every token the session of an agent given `selection`.
struct Granting(Selection);

impl Granting {
    fn grant(&self) -> SessionGrant {
        SessionGrant {
            session: AgentSessionId::new(),
            owner: owner(),
            agent: BotId::TEST_A,
            repo: None,
            mcp_servers: Vec::new(),
            selection: self.0.clone(),
            prompter: None,
        }
    }
}

impl SessionAuthority for Granting {
    async fn authorize(&self, _token: &SessionToken) -> Result<SessionGrant, EgressError> {
        Ok(self.grant())
    }

    async fn authorize_session(
        &self,
        _session: AgentSessionId,
    ) -> Result<SessionGrant, EgressError> {
        Ok(self.grant())
    }
}

/// No git in these sessions.
struct NoGit;

impl GithubTokens for NoGit {
    async fn resolve(
        &self,
        _owner: &MacroUserIdStr<'static>,
        repo: &RepoSlug,
    ) -> Result<UpstreamCall, EgressError> {
        Err(EgressError::RepoUnavailable(repo.clone()))
    }
}

/// The request a [`Recording`] forwarder was handed, if any.
type Forwarded = Arc<Mutex<Option<http::request::Parts>>>;

/// Records the request it was handed and answers `202`.
struct Recording(Forwarded);

impl Forwarder for Recording {
    async fn forward(&self, request: ProxyRequest) -> Result<ProxyResponse, EgressError> {
        let (parts, _body) = request.into_parts();
        *self.0.lock().expect("lock") = Some(parts);
        let mut response = http::Response::new(empty());
        *response.status_mut() = StatusCode::ACCEPTED;
        Ok(response)
    }
}

fn empty() -> ProxyBody {
    Empty::new().map_err(|never| match never {}).boxed_unsync()
}

fn json(body: &str) -> ProxyRequest {
    let mut request = http::Request::new(
        Full::new(bytes::Bytes::from(body.to_owned()))
            .map_err(|never| match never {})
            .boxed_unsync(),
    );
    *request.method_mut() = Method::POST;
    request
}

async fn body_json(response: ProxyResponse) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("a JSON body")
}

type Proxy = EgressServiceImpl<
    Granting,
    ConnectorsMcpCredentials<connectors::domain::service::Connectors>,
    NoGit,
    Recording,
>;

fn proxy(selection: Selection) -> (Proxy, Forwarded) {
    let forwarded = Forwarded::default();
    let proxy = EgressServiceImpl::new(
        Granting(selection),
        credentials(&connectors()),
        NoGit,
        Recording(Arc::clone(&forwarded)),
    );
    (proxy, forwarded)
}

async fn send(
    proxy: &Proxy,
    destination: McpDestination,
    body: &str,
) -> Result<ProxyResponse, EgressError> {
    proxy
        .proxy(
            &SessionToken::new("session-token"),
            EgressTarget::McpServer(destination),
            json(body),
        )
        .await
}

const TOOLS_CALL: &str =
    r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"search","arguments":{}}}"#;

/// A sandbox reaches an app on its agent's list with the owner's
/// credential stamped in place of the session token.
#[tokio::test]
async fn a_sandbox_reaches_an_app_on_its_agents_list() {
    let (proxy, forwarded) = proxy(apps(&["linear"]));

    let response = send(&proxy, app("linear"), TOOLS_CALL)
        .await
        .expect("forwarded");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let forwarded = forwarded_parts(&forwarded);
    assert_eq!(forwarded.uri.host(), Some("upstream.fake.test"));
    assert_eq!(forwarded.headers[AUTHORIZATION], "Bearer fake-token");
}

/// A sandbox cannot reach an app outside its agent's list, though the owner
/// has it connected: nothing is forwarded.
#[tokio::test]
async fn a_sandbox_cannot_reach_an_app_outside_its_agents_list() {
    let (proxy, forwarded) = proxy(apps(&["datadog"]));

    for destination in [app("linear"), wiki()] {
        let error = send(&proxy, destination, TOOLS_CALL)
            .await
            .expect_err("refused");

        assert!(matches!(error, EgressError::OutOfScope), "{error:?}");
    }
    assert!(forwarded.lock().expect("lock").is_none());
}

/// An agent given everything still gets a connect prompt for an app the
/// owner has not connected (rule 7): the handshake completes, the listing
/// offers the one tool that says how to connect, and a call answers with the
/// connect chip. Nothing goes upstream.
#[tokio::test]
async fn an_unconnected_app_answers_with_a_connect_prompt() {
    let (proxy, forwarded) = proxy(Selection::All);

    let initialize = send(
        &proxy,
        app("datadog"),
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#,
    )
    .await
    .expect("answered");
    let initialize = body_json(initialize).await;
    assert_eq!(initialize["result"]["protocolVersion"], "2025-03-26");

    let listing = send(
        &proxy,
        app("datadog"),
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    )
    .await
    .expect("answered");
    let listing = body_json(listing).await;
    assert_eq!(listing["result"]["tools"][0]["name"], "connect");

    let call = send(&proxy, app("datadog"), TOOLS_CALL)
        .await
        .expect("answered");
    let call = body_json(call).await;
    assert_eq!(call["id"], 7);
    assert_eq!(call["result"]["isError"], true);
    let text = call["result"]["content"][0]["text"].as_str().expect("text");
    assert!(
        text.contains(r#"<m-connect-app>{"appSlug":"datadog","name":"Datadog"}</m-connect-app>"#),
        "{text}"
    );

    assert!(forwarded.lock().expect("lock").is_none());
}

fn forwarded_parts(forwarded: &Forwarded) -> http::request::Parts {
    forwarded
        .lock()
        .expect("lock")
        .clone()
        .expect("the request was forwarded")
}
