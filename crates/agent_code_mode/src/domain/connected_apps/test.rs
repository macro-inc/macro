use super::*;
use crate::domain::ExecutionRecord;
use ai_toolset::actor::ToolActor;
use entity_access::domain::models::EntityType;
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;

struct Store(Mutex<Option<ExecutionRecord>>);

#[async_trait]
impl ExecutionStore for Store {
    async fn create(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!("connected apps never create executions")
    }

    async fn save(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!("connected apps never save executions")
    }

    async fn get(
        &self,
        _: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .clone()
            .filter(|record| record.execution_id == execution)
            .ok_or(CodeModeError::NotFound)
    }
}

struct Turns(Option<macro_uuid::Uuid>);

#[async_trait]
impl ExecutionTurns for Turns {
    async fn active(&self, _: AgentSessionId) -> Result<Option<macro_uuid::Uuid>, CodeModeError> {
        Ok(self.0)
    }
}

/// Records every use it is handed and answers one fixed app. Its session is
/// owned by owner@example.com and prompted by asker@example.com.
#[derive(Default)]
struct Apps(Mutex<Vec<(AgentSessionId, String)>>);

#[async_trait]
impl ConnectedAppTools for Apps {
    async fn accounts(&self, _: AgentSessionId) -> Result<SessionAccounts, CodeModeError> {
        Ok(SessionAccounts {
            owner: MacroUserIdStr::parse_from_str("macro|owner@example.com")
                .unwrap()
                .into_owned(),
            requester: Some(
                MacroUserIdStr::parse_from_str("macro|asker@example.com")
                    .unwrap()
                    .into_owned(),
            ),
        })
    }

    async fn apps(&self, usage: &ConnectedAppUse) -> Result<Vec<ConnectedApp>, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((usage.session, usage.user.to_string()));
        Ok(vec![
            ConnectedApp {
                kind: ConnectedAppKind::App,
                key: "slack".into(),
                name: "Slack".into(),
            },
            ConnectedApp {
                kind: ConnectedAppKind::Custom,
                key: "0123456789abcdef".into(),
                name: "Internal wiki".into(),
            },
        ])
    }

    async fn tools(
        &self,
        _: &ConnectedAppUse,
        app: &ConnectedAppRef,
    ) -> Result<Vec<ConnectedTool>, CodeModeError> {
        if app.key != "slack" {
            return Err(CodeModeError::Unavailable);
        }
        Ok(vec![
            ConnectedTool {
                name: "list_channels".into(),
                description: Some("List Slack channels".into()),
                input_schema: serde_json::json!({"type": "object"}),
            },
            ConnectedTool {
                name: "send_message".into(),
                description: Some("Send a message to a Slack channel".into()),
                input_schema: serde_json::json!({"type": "object"}),
            },
        ])
    }

    async fn call(
        &self,
        usage: &ConnectedAppUse,
        app: &ConnectedAppRef,
        call: CallConnectedTool,
    ) -> Result<ConnectedToolResult, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((usage.session, usage.user.to_string()));
        Ok(ConnectedToolResult {
            is_error: false,
            content: vec![serde_json::json!({
                "type": "text",
                "text": format!("{} {} {}", app.key, call.tool, call.arguments["channel"]),
            })],
            structured_content: None,
        })
    }

    async fn discover(
        &self,
        _: &ConnectedAppUse,
        _: DiscoveryRequest,
    ) -> Result<DiscoverConnectorsResponse, CodeModeError> {
        unreachable!("these tests never discover")
    }

    async fn add_server(
        &self,
        _: &ConnectedAppUse,
        _: ConnectMcpServer,
    ) -> Result<ConnectMcpServerResponse, CodeModeError> {
        unreachable!("these tests never add servers")
    }
}

#[tokio::test]
async fn a_running_execution_of_the_active_turn_calls_as_its_approved_account() {
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(7));
    let execution = ExecutionId::mint();
    let caller = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let apps = Arc::new(Apps::default());
    let service = ConnectedAppService::new(
        Arc::new(Store(Mutex::new(Some(ExecutionRecord {
            execution_id: execution,
            acting_as: Some(ToolActor::Owner),
            turn_id: Some(macro_uuid::Uuid::from_u128(1)),
            source: "export async function main() {}".into(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
            activity: Vec::new(),
            activity_truncated: false,
        })))),
        Arc::new(Turns(Some(macro_uuid::Uuid::from_u128(1)))),
        apps.clone(),
    );
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        caller.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );

    let result = service
        .call(
            &access,
            &caller,
            execution,
            ConnectedAppRef {
                kind: ConnectedAppKind::App,
                key: "slack".into(),
            },
            CallConnectedTool {
                tool: "send_message".into(),
                arguments: serde_json::json!({"channel": "general"})
                    .as_object()
                    .unwrap()
                    .clone(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        result.content,
        vec![serde_json::json!({"type": "text", "text": "slack send_message \"general\""})]
    );
    assert_eq!(
        *apps.0.lock().unwrap(),
        vec![(session, "macro|owner@example.com".to_owned())]
    );
}

#[tokio::test]
async fn a_finished_execution_or_an_ended_turn_reaches_no_app() {
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(7));
    let execution = ExecutionId::mint();
    let caller = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        caller.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );
    let record = ExecutionRecord {
        execution_id: execution,
        acting_as: Some(ToolActor::Requester),
        turn_id: Some(macro_uuid::Uuid::from_u128(1)),
        source: "export async function main() {}".into(),
        status: ExecutionStatus::Succeeded,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
    };
    let apps = Arc::new(Apps::default());

    let finished = ConnectedAppService::new(
        Arc::new(Store(Mutex::new(Some(record.clone())))),
        Arc::new(Turns(Some(macro_uuid::Uuid::from_u128(1)))),
        apps.clone(),
    )
    .apps(&access, &caller, execution)
    .await;
    let ended = ConnectedAppService::new(
        Arc::new(Store(Mutex::new(Some(ExecutionRecord {
            status: ExecutionStatus::Running,
            ..record
        })))),
        Arc::new(Turns(Some(macro_uuid::Uuid::from_u128(2)))),
        apps.clone(),
    )
    .apps(&access, &caller, execution)
    .await;

    assert!(matches!(finished, Err(CodeModeError::Forbidden)));
    assert!(matches!(ended, Err(CodeModeError::Forbidden)));
    assert!(apps.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_caller_holding_another_account_than_the_execution_spends_nothing() {
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(7));
    let execution = ExecutionId::mint();
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let apps = Arc::new(Apps::default());
    let service = ConnectedAppService::new(
        Arc::new(Store(Mutex::new(Some(ExecutionRecord {
            execution_id: execution,
            acting_as: Some(ToolActor::Requester),
            turn_id: Some(macro_uuid::Uuid::from_u128(1)),
            source: "export async function main() {}".into(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
            activity: Vec::new(),
            activity_truncated: false,
        })))),
        Arc::new(Turns(Some(macro_uuid::Uuid::from_u128(1)))),
        apps.clone(),
    );
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        owner.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );

    let refused = service.apps(&access, &owner, execution).await;

    assert!(matches!(refused, Err(CodeModeError::Forbidden)));
    assert!(apps.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_search_ranks_tools_across_apps_and_reports_apps_it_could_not_read() {
    let session = AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(7));
    let execution = ExecutionId::mint();
    let caller = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let service = ConnectedAppService::new(
        Arc::new(Store(Mutex::new(Some(ExecutionRecord {
            execution_id: execution,
            acting_as: Some(ToolActor::Owner),
            turn_id: Some(macro_uuid::Uuid::from_u128(1)),
            source: "export async function main() {}".into(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
            activity: Vec::new(),
            activity_truncated: false,
        })))),
        Arc::new(Turns(Some(macro_uuid::Uuid::from_u128(1)))),
        Arc::new(Apps::default()),
    );
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        caller.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );

    let found = service
        .search_tools(&access, &caller, execution, "send slack message")
        .await
        .unwrap();

    assert_eq!(
        found
            .matches
            .iter()
            .map(|found| found.tool.name.as_str())
            .collect::<Vec<_>>(),
        vec!["send_message", "list_channels"]
    );
    assert_eq!(found.matches[0].app.key, "slack");
    assert_eq!(
        found
            .unsearched
            .iter()
            .map(|app| app.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Internal wiki"]
    );
}
