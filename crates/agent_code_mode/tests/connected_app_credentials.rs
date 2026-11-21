//! Connected-app admission uses the credential's verified invocation, not owner access alone.
use agent_code_mode::domain::connected_apps::*;
use agent_code_mode::domain::{
    CodeModeError, ExecutionId, ExecutionRecord, ExecutionStore, ExecutionTurns,
};
use agent_correlation::context::{Attribution, scope_attribution};
use agent_correlation::scope::SessionScope;
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::inbound::toolset::{ConnectMcpServer, ConnectMcpServerResponse};
use pipedream_mcp::domain::service::discovery::DiscoveryRequest;
use pipedream_mcp::inbound::toolset::DiscoverConnectorsResponse;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;

struct Records(Vec<(AgentSessionId, ExecutionRecord)>);
#[async_trait]
impl ExecutionStore for Records {
    async fn create(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!()
    }
    async fn save(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!()
    }
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.0
            .iter()
            .find(|(s, r)| *s == session && r.execution_id == execution)
            .map(|(_, r)| r.clone())
            .ok_or(CodeModeError::NotFound)
    }
}
struct Turns;
#[async_trait]
impl ExecutionTurns for Turns {
    async fn active(&self, session: AgentSessionId) -> Result<Option<Uuid>, CodeModeError> {
        Ok(match session.as_uuid().as_u128() {
            201 => Some(Uuid::from_u128(401)),
            202 => Some(Uuid::from_u128(402)),
            _ => None,
        })
    }
}
#[derive(Default)]
struct Apps {
    admissions: AtomicUsize,
    effects: AtomicUsize,
}
#[async_trait]
impl ConnectedAppTools for Apps {
    async fn accounts(&self, _: AgentSessionId) -> Result<SessionAccounts, CodeModeError> {
        self.admissions.fetch_add(1, Ordering::SeqCst);
        Ok(SessionAccounts {
            owner: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            requester: None,
        })
    }
    async fn apps(&self, _: &ConnectedAppUse) -> Result<Vec<ConnectedApp>, CodeModeError> {
        self.effects.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
    async fn tools(
        &self,
        _: &ConnectedAppUse,
        _: &ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError> {
        self.effects.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
    async fn call(
        &self,
        _: &ConnectedAppUse,
        _: &ConnectedAppRef,
        _: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError> {
        self.effects.fetch_add(1, Ordering::SeqCst);
        Ok(ConnectedToolResult {
            is_error: false,
            content: vec![json!({"type":"text", "text":"called the owned execution's app"})],
            structured_content: None,
        })
    }
    async fn discover(
        &self,
        _: &ConnectedAppUse,
        _: DiscoveryRequest,
    ) -> Result<DiscoverConnectorsResponse, CodeModeError> {
        self.effects.fetch_add(1, Ordering::SeqCst);
        Err(CodeModeError::Unavailable)
    }
    async fn add_server(
        &self,
        _: &ConnectedAppUse,
        _: ConnectMcpServer,
    ) -> Result<ConnectMcpServerResponse, CodeModeError> {
        self.effects.fetch_add(1, Ordering::SeqCst);
        Err(CodeModeError::Unavailable)
    }
}

/// Both sessions belong to the same person and have live, approved owner executions.
/// The JSON is the existing journal representation, including the issued binding.
struct Fixture {
    service: ConnectedAppService,
    apps: Arc<Apps>,
    owner: MacroUserIdStr<'static>,
    access: EntityAccessReceipt<EditAccessLevel>,
    execution: ExecutionId,
}
impl Fixture {
    fn new(bound: bool) -> Self {
        let mut records = Vec::new();
        for (session, execution, correlation, turn) in [(201, 101, 301, 401), (202, 102, 302, 402)]
        {
            let mut journal = json!({
                "executionId": Uuid::from_u128(execution), "actingAs":"owner", "turnId":Uuid::from_u128(turn),
                "credentialCorrelationId": Uuid::from_u128(correlation),
                "source":"export async function main() {}", "status":"running", "result":null, "error":null,
                "calls":[], "activity":[], "activityTruncated":false,
            });
            if !bound {
                journal
                    .as_object_mut()
                    .unwrap()
                    .remove("credentialCorrelationId");
            }
            records.push((
                AgentSessionId::new_from_uuid(Uuid::from_u128(session)),
                serde_json::from_value(journal).unwrap(),
            ));
        }
        let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
        let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
            owner.clone(),
            &Uuid::from_u128(202).to_string(),
            EntityType::AgentSession,
        );
        let apps = Arc::new(Apps::default());
        Self {
            service: ConnectedAppService::new(
                Arc::new(Records(records)),
                Arc::new(Turns),
                apps.clone(),
            ),
            apps,
            owner,
            access,
            execution: ExecutionId::from_uuid(Uuid::from_u128(102)),
        }
    }
}

#[tokio::test]
async fn every_connected_app_entry_refuses_a_credential_for_someone_elses_execution() {
    let fixture = Fixture::new(true);
    let mut failures = Vec::new();
    for (label, attribution) in [
        (
            "another live session",
            Attribution {
                correlation_id: Some(Uuid::from_u128(301)),
                session_id: Some(Uuid::from_u128(201)),
                ..Default::default()
            },
        ),
        (
            "another execution in this session",
            Attribution {
                correlation_id: Some(Uuid::from_u128(303)),
                session_id: Some(Uuid::from_u128(202)),
                ..Default::default()
            },
        ),
        (
            "a routine borrowing another live session",
            Attribution {
                correlation_id: Some(Uuid::from_u128(301)),
                session_id: Some(Uuid::from_u128(201)),
                routine_id: Some(Uuid::from_u128(501)),
                ..Default::default()
            },
        ),
        (
            "public MCP borrowing a journaled execution",
            Attribution {
                correlation_id: Some(Uuid::from_u128(999)),
                session_id: Some(Uuid::from_u128(202)),
                ..Default::default()
            },
        ),
        ("an uncorrelated account credential", Attribution::default()),
        (
            "a channel mention's NoSend credential",
            Attribution {
                scope: Some(SessionScope::NoSend),
                ..Default::default()
            },
        ),
        (
            "a scoped matching credential",
            Attribution {
                correlation_id: Some(Uuid::from_u128(302)),
                session_id: Some(Uuid::from_u128(202)),
                scope: Some(SessionScope::Generation),
                ..Default::default()
            },
        ),
    ] {
        let results = scope_attribution(attribution, async {
            let app = ConnectedAppRef {
                kind: ConnectedAppKind::App,
                key: "fixture".into(),
            };
            vec![
                (
                    "apps",
                    fixture
                        .service
                        .apps(&fixture.access, &fixture.owner, fixture.execution)
                        .await
                        .map(|_| ()),
                ),
                (
                    "tools",
                    fixture
                        .service
                        .tools(
                            &fixture.access,
                            &fixture.owner,
                            fixture.execution,
                            app.clone(),
                        )
                        .await
                        .map(|_| ()),
                ),
                (
                    "call",
                    fixture
                        .service
                        .call(
                            &fixture.access,
                            &fixture.owner,
                            fixture.execution,
                            app,
                            CallConnectedTool {
                                tool: "send_message".into(),
                                arguments: serde_json::Map::new(),
                            },
                        )
                        .await
                        .map(|_| ()),
                ),
                (
                    "discover",
                    fixture
                        .service
                        .discover(
                            &fixture.access,
                            &fixture.owner,
                            fixture.execution,
                            DiscoveryRequest::Search {
                                query: "fixture".into(),
                            },
                        )
                        .await
                        .map(|_| ()),
                ),
                (
                    "add_server",
                    fixture
                        .service
                        .add_server(
                            &fixture.access,
                            &fixture.owner,
                            fixture.execution,
                            ConnectMcpServer {
                                url: "https://example.com/mcp".into(),
                                server_name: "Fixture".into(),
                            },
                        )
                        .await
                        .map(|_| ()),
                ),
                (
                    "search_tools",
                    fixture
                        .service
                        .search_tools(
                            &fixture.access,
                            &fixture.owner,
                            fixture.execution,
                            "fixture",
                        )
                        .await
                        .map(|_| ()),
                ),
            ]
        })
        .await;
        for (operation, result) in results {
            if !matches!(result, Err(CodeModeError::Forbidden)) {
                failures.push(format!("{label}: {operation} -> {result:?}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(fixture.apps.admissions.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_matching_own_execution_still_calls_its_connected_app() {
    let fixture = Fixture::new(true);
    // An ordinary run, a routine's own run and a public-MCP run use the same
    // issued binding. Provenance is not a blanket refusal.
    for routine_id in [None, Some(Uuid::from_u128(501)), None] {
        let attribution = Attribution {
            correlation_id: Some(Uuid::from_u128(302)),
            session_id: Some(Uuid::from_u128(202)),
            routine_id,
            ..Default::default()
        };
        let result = scope_attribution(
            attribution,
            fixture.service.call(
                &fixture.access,
                &fixture.owner,
                fixture.execution,
                ConnectedAppRef {
                    kind: ConnectedAppKind::App,
                    key: "fixture".into(),
                },
                CallConnectedTool {
                    tool: "read_owned_data".into(),
                    arguments: serde_json::Map::new(),
                },
            ),
        )
        .await
        .unwrap();
        assert!(!result.is_error);
    }
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 3);
}

#[path = "connected_app_credentials/signed_http.rs"]
mod signed_http;

#[path = "connected_app_credentials/issuance.rs"]
mod issuance;
