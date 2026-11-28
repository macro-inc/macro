use super::*;
use agent_code_mode::domain::{
    CodeModeError, ExecutionId, ExecutionReceipt, ExecutionRecord, SessionCodeMode,
};
use agent_session::domain::model::AgentSession;
use ai_toolset::actor::ToolActor;
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use serde_json::json;

/// Records the role each execution was asked to run as, then refuses to run.
#[derive(Clone, Default)]
struct RecordingCodeMode {
    actors: Arc<std::sync::Mutex<Vec<ToolActor>>>,
}

#[async_trait]
impl SessionCodeMode for RecordingCodeMode {
    async fn execute(
        &self,
        _: &AgentSession,
        _: ExecutionId,
        acting_as: ToolActor,
        _: macro_uuid::Uuid,
        _: ExecuteRequest,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        self.actors.lock().unwrap().push(acting_as);
        Err(CodeModeError::Unavailable)
    }

    async fn read(
        &self,
        _: &EntityAccessReceipt<ViewAccessLevel>,
        _: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        Err(CodeModeError::NotFound)
    }
}

/// ExecuteCode advertises `acting_as` as the same plain enum native tools
/// get, with no per-variant `const` subschemas for a model to answer with
/// the session's `owner_id`. A person's id, the owner's included, is still
/// refused before anything runs, and the refusal names the roles without
/// repeating the id, withheld or not.
#[tokio::test]
async fn execute_code_takes_only_a_role_as_acting_as() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
        .await
        .unwrap();
    let tasks = FixedTasks::default();
    let code_mode = RecordingCodeMode::default();
    let app = router(
        Arc::new(repo.clone()),
        Vec::new(),
        InternalTools {
            service: Arc::new(SessionPullRequestService::new(
                repo.clone(),
                RecordingRealtime::new(),
                Arc::new(tasks.clone()),
            )),
            tasks: Arc::new(tasks),
            code_mode: Some(Arc::new(code_mode.clone())),
            cognition: None,
            reviews: Arc::new(OnceLock::new()),
            gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
            app_url: "https://macro.com".into(),
        },
    );

    let (_, listed) = rpc(app.clone(), Some("secret"), "tools/list", json!({})).await;
    let execute_code = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "ExecuteCode")
        .unwrap_or_else(|| panic!("ExecuteCode is listed: {listed}"));
    let schema = &execute_code["inputSchema"];
    assert_eq!(
        schema["properties"]["acting_as"],
        json!({
            "type": "string",
            "enum": ["requester", "owner"],
            "description": "Whose account authenticates every SDK operation in this execution: the role \"requester\" or \"owner\", never a person's id. Prefer requester.",
        })
    );
    assert!(
        schema["required"]
            .as_array()
            .unwrap()
            .contains(&json!("acting_as"))
    );
    assert!(
        schema
            .get("$defs")
            .is_none_or(|defs| defs.get("ToolActor").is_none()),
        "{schema}"
    );

    let call = |acting_as: serde_json::Value, withheld: bool| {
        let mut params = json!({
            "name": "ExecuteCode",
            "arguments": {
                "acting_as": acting_as,
                "turn_id": "00000000-0000-0000-0000-000000000003",
                "source": "export async function main() { return {data: 1}; }",
            },
        });
        if withheld {
            params["_meta"] = json!({ "macro.dev/withhold-content": true });
        }
        rpc(app.clone(), Some("secret"), "tools/call", params)
    };
    let owner = session.owner_id.as_user().unwrap().to_string();
    for refused in [
        json!(owner),
        json!(owner.trim_start_matches("macro|")),
        json!("macro|someone-else@example.com"),
        json!("Owner"),
        json!(""),
        json!(15551234567_u64),
        json!(null),
    ] {
        for withheld in [false, true] {
            let (_, response) = call(refused.clone(), withheld).await;
            assert_eq!(response["error"]["code"], -32602, "{refused}: {response}");
            let message = response["error"]["message"].as_str().unwrap();
            assert!(
                message.contains("expected requester or owner (a role, never a person id)"),
                "{refused}: {message}"
            );
            assert!(!message.contains("example.com"), "{refused}: {message}");
            assert!(!message.contains("1555"), "{refused}: {message}");
        }
    }
    assert!(code_mode.actors.lock().unwrap().is_empty());

    for (role, actor) in [
        ("requester", ToolActor::Requester),
        ("owner", ToolActor::Owner),
    ] {
        call(json!(role), false).await;
        assert_eq!(
            code_mode.actors.lock().unwrap().pop(),
            Some(actor),
            "{role} reaches code mode"
        );
    }
}
