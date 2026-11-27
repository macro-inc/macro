use super::*;

#[test]
fn an_upstream_failure_is_an_unreachable_connected_app() {
    let error = egress_error(EgressError::Upstream(rootcause::report!(
        "Transport channel closed"
    )));

    assert!(matches!(error, CodeModeError::ConnectedAppUnreachable));
}

#[test]
fn an_upstream_rate_limit_is_a_rate_limited_connected_app() {
    let error = egress_error(EgressError::RateLimited {
        retry_after: Some(std::time::Duration::from_secs(1)),
    });

    assert!(matches!(
        error,
        CodeModeError::ConnectedAppRateLimited {
            retry_after: Some(_)
        }
    ));
}

#[test]
fn a_sign_in_request_is_not_an_unreachable_connected_app() {
    let error = egress_error(EgressError::SignInRequired);

    assert!(matches!(error, CodeModeError::Invalid(_)), "{error:?}");
}

use agent_egress::domain::model::McpServerListing;
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use bots::domain::models::{AgentMcpServer, AgentMcpServers};
use connectors::fake::{FakeConnection, FakeConnectors};

fn owner() -> MacroUserIdStr<'static> {
    // `test_agent_session`'s owner.
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

/// The egress service as code mode sees it: the session's grant, naming
/// the apps its agent listed, and an upstream that lists no tools.
struct Egress {
    grant: SessionGrant,
}

impl SessionMcpExchange for Egress {
    async fn session_grant(&self, _session: AgentSessionId) -> Result<SessionGrant, EgressError> {
        Ok(self.grant.clone())
    }

    async fn exchange_as(
        &self,
        _grant: &SessionGrant,
        _user: &MacroUserIdStr<'static>,
        _destination: &McpDestination,
        _request: Value,
    ) -> Result<Value, EgressError> {
        Ok(json!({ "tools": [] }))
    }
}

/// The owner holds Linear through Pipedream, Figma natively at its overlay
/// address, a server added by URL, and a disabled Asana.
fn owner_connections() -> FakeConnectors {
    FakeConnectors::new()
        .with_overlay("figma", "https://mcp.figma.com/mcp")
        .with_connection(&owner(), FakeConnection::app("linear"))
        .with_connection(&owner(), FakeConnection::app("figma"))
        .with_connection(&owner(), FakeConnection::app("asana").disabled())
        .with_connection(
            &owner(),
            FakeConnection::server("https://mcp.example.com/mcp").named("Example"),
        )
}

/// Code mode over the real connectors and provisioner, for a session whose
/// agent was given `servers`.
fn code_mode(
    servers: AgentMcpServers,
) -> (
    SessionConnectedApps<Egress, connectors::Connectors, InMemoryAgentSessionRepo>,
    ConnectedAppUse,
) {
    let mut session = test_agent_session(AgentSessionId::new());
    session.mcp_servers = servers.clone();
    let sessions = InMemoryAgentSessionRepo::new();
    sessions.insert_session(session.clone());
    let listed = match &servers {
        AgentMcpServers::OwnerConnections => Vec::new(),
        AgentMcpServers::Selected { servers } => servers
            .iter()
            .filter_map(|server| {
                Some(McpServerListing {
                    slug: McpServerSlug::parse(&server.app_slug)?,
                    name: server.server_name.clone(),
                })
            })
            .collect(),
    };
    let grant = SessionGrant {
        session: session.id,
        owner: owner(),
        agent: session.bot_id,
        repo: None,
        mcp_servers: listed,
        selection: agent_egress::domain::model::agent_selection(&servers),
        prompter: None,
    };
    let apps = SessionConnectedApps {
        egress: Arc::new(Egress { grant }),
        provisioner: EgressProvisioner::new(
            Arc::new(owner_connections().build()),
            "https://egress.example",
        ),
        sessions,
        gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
        connector_tools: ai_tools::ToolConnectorToolContext::unwired(),
    };
    let usage = ConnectedAppUse {
        session: session.id,
        acting_as: ai_toolset::actor::ToolActor::Owner,
        user: owner(),
    };
    (apps, usage)
}

fn keys(apps: &[ConnectedApp]) -> Vec<(ConnectedAppKind, String)> {
    let mut keys: Vec<_> = apps.iter().map(|app| (app.kind, app.key.clone())).collect();
    keys.sort_by(|a, b| a.1.cmp(&b.1));
    keys
}

/// A program whose agent was given everything lists every usable
/// connection: apps, overlaid ones included, by slug, and the server added
/// by URL by its key; never the disabled app.
#[tokio::test]
async fn a_program_given_everything_lists_every_usable_connection() {
    let (code_mode, usage) = code_mode(AgentMcpServers::OwnerConnections);

    let apps = code_mode.apps(&usage).await.unwrap();

    let custom = CustomMcpServerKey::for_url("https://mcp.example.com/mcp");
    let mut expected = vec![
        (ConnectedAppKind::App, "figma".to_owned()),
        (ConnectedAppKind::App, "linear".to_owned()),
        (ConnectedAppKind::Custom, custom.as_str().to_owned()),
    ];
    expected.sort_by(|a, b| a.1.cmp(&b.1));
    assert_eq!(keys(&apps), expected);
}

/// A program whose agent was given apps lists exactly those, connected or
/// not, and reaches nothing else: an app it was not given is not found.
#[tokio::test]
async fn a_program_given_apps_reaches_exactly_those() {
    let (code_mode, usage) = code_mode(AgentMcpServers::Selected {
        servers: vec![
            AgentMcpServer {
                app_slug: "linear".to_owned(),
                server_name: "Linear".to_owned(),
            },
            AgentMcpServer {
                app_slug: "slack".to_owned(),
                server_name: "Slack".to_owned(),
            },
        ],
    });

    let apps = code_mode.apps(&usage).await.unwrap();
    assert_eq!(
        keys(&apps),
        vec![
            (ConnectedAppKind::App, "linear".to_owned()),
            (ConnectedAppKind::App, "slack".to_owned()),
        ]
    );
    assert!(apps.iter().any(|app| app.name == "Linear"));

    let figma = ConnectedAppRef {
        kind: ConnectedAppKind::App,
        key: "figma".to_owned(),
    };
    assert!(matches!(
        code_mode.tools(&usage, &figma).await,
        Err(CodeModeError::NotFound)
    ));
    let linear = ConnectedAppRef {
        kind: ConnectedAppKind::App,
        key: "linear".to_owned(),
    };
    assert!(code_mode.tools(&usage, &linear).await.unwrap().is_empty());
}

/// A program's refused `addServer` or `discover` is its own mistake (400);
/// a host whose connector services are missing or failing answers 5xx, as
/// before the tools served these calls.
#[tokio::test]
async fn connector_tool_outages_are_not_the_programs_mistake() {
    let (code_mode, usage) = code_mode(AgentMcpServers::OwnerConnections);

    let added = code_mode
        .add_server(
            &usage,
            ConnectMcpServer {
                url: "https://mcp.example.com/mcp".to_owned(),
                server_name: "Example".to_owned(),
            },
        )
        .await;
    let discovered = code_mode
        .discover(
            &usage,
            DiscoveryRequest::Inspect {
                app_slug: "linear".to_owned(),
            },
        )
        .await;

    assert!(matches!(added, Err(CodeModeError::Unavailable)));
    assert!(matches!(discovered, Err(CodeModeError::Unavailable)));
    assert!(matches!(
        connector_tool_error(ConnectorToolError::Refused("not https".to_owned())),
        CodeModeError::Invalid(message) if message == "not https"
    ));
}
