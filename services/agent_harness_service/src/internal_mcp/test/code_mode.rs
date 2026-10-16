use super::*;
use agent_code_mode::{
    domain::{ExecutionId, ExecutionStore},
    outbound::postgres::PgExecutionStore,
};
use async_trait::async_trait;
use code_execution::{
    domain::{ExecutionService, Limits},
    outbound::deno::DenoRunner,
};
use serde_json::json;

struct NoAppEgress;

impl agent_egress::domain::service::EgressService for NoAppEgress {
    async fn proxy(
        &self,
        _: &SessionToken,
        _: agent_egress::domain::model::EgressTarget,
        _: agent_egress::domain::model::ProxyRequest,
    ) -> Result<agent_egress::domain::model::ProxyResponse, agent_egress::domain::error::EgressError>
    {
        panic!("internal tools must not be routed to a third-party app");
    }
}

struct Credentials;
#[async_trait]
impl agent_code_mode::domain::ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        _: &agent_code_mode::domain::ExecutionIdentity,
        _: &str,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<code_execution::domain::RunEnvironment, agent_code_mode::domain::CodeModeError>
    {
        Ok(code_execution::domain::RunEnvironment::default())
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "requires pinned Deno runtime"]
async fn authenticated_mcp_runs_javascript_and_persists_source_and_result(pool: sqlx::PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../../../crates/agent_code_mode/src/outbound/postgres/test/sessions.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql("UPDATE agent_session SET turn_state = 'running', turn_action_id = '00000000-0000-0000-0000-000000000003'").execute(&pool).await.unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let path = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(path.status.success(), "Deno 2.9.6 must be on PATH");
    let deno = DenoRunner::new(
        String::from_utf8(path.stdout).unwrap().trim().into(),
        scratch.path().to_owned(),
        128,
    )
    .await
    .unwrap();
    let runner = ExecutionService::new(Arc::new(deno), Limits::default()).unwrap();
    let store = Arc::new(PgExecutionStore::new(pool.clone()));
    let code_mode = Arc::new(agent_code_mode::domain::CodeModeService::new(
        Some(Arc::new(runner.clone())),
        Arc::new(Credentials),
        store.clone(),
        Arc::new(agent_code_mode::outbound::turns::SessionTurns(
            agent_session::outbound::postgres::PgAgentSessionRepo::new(
                pool.clone(),
                entity_registry_db_utils::OwnedEntityRegistrar::new(
                    entity_registry::OwnerGrantPolicy::new(
                        bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
                    ),
                ),
            ),
        )),
    ));
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(
        1,
    )));
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("session-secret").hash())
        .await
        .unwrap();
    let app = router(
        Arc::new(repo.clone()),
        Arc::new(SessionPullRequestService::new(
            repo.clone(),
            RecordingRealtime::new(),
            Arc::new(FixedTasks::default()),
        )),
        Arc::new(FixedTasks::default()),
        "localhost".into(),
        Some(code_mode.clone()),
        Arc::new(std::sync::OnceLock::new()),
    );
    assert_eq!(
        rpc(app.clone(), Some("wrong-session"), "tools/list", json!({}))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, listed) = rpc(app.clone(), Some("session-secret"), "tools/list", json!({})).await;
    let names: Vec<_> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"ExecuteCode") && names.contains(&"DescribeCodeTools"));
    let (_, docs) = rpc(
        app.clone(),
        Some("session-secret"),
        "tools/call",
        json!({"name": "DescribeCodeTools", "arguments": {"names": ["documents"], "topics": ["search"]}}),
    )
    .await;
    assert_eq!(
        docs["result"]["structuredContent"]["guides"][0]["topic"],
        "search"
    );
    let doc = &docs["result"]["structuredContent"]["tools"][0];
    assert_eq!(doc["name"], "documents");
    assert!(
        doc["documentation"]
            .as_str()
            .unwrap()
            .contains("Class: DocumentNamespace")
    );
    let (_, guides) = rpc(
        app.clone(),
        Some("session-secret"),
        "tools/call",
        json!({"name": "DescribeCodeTools", "arguments": {"topics": ["examples", "ai"]}}),
    )
    .await;
    let guides = &guides["result"]["structuredContent"];
    assert_eq!(guides["tools"], json!([]));
    assert_eq!(guides["guides"][0]["topic"], "examples");
    assert_eq!(
        guides["guides"][0]["markdown"],
        include_str!("../../../../../crates/agent_code_mode/SKILL.md")
    );
    assert!(
        guides["guides"][1]["markdown"]
            .as_str()
            .unwrap()
            .contains("macro.ai.decide")
    );
    let source = "export async function main() { const rows = await Promise.all(['first', 'second'].map(async value => value)); return {data:rows,reviews:[]}; }";
    let (_, response) = rpc(app.clone(), Some("session-secret"), "tools/call", json!({"name": "ExecuteCode", "arguments": {"execution_id": ExecutionId::mint(), "source": source}})).await;
    assert_ne!(response["result"]["isError"], true, "{response}");
    let receipt = &response["result"]["structuredContent"];
    assert_eq!(
        receipt["result"],
        json!({"data":["first", "second"],"reviews":[]}),
        "{response}"
    );
    assert!(receipt.get("calls").is_none());
    // Text-only MCP clients retain the receipt too (Claude's native transport).
    let text: serde_json::Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(&text, receipt);
    let execution =
        ExecutionId::from_uuid(receipt["executionId"].as_str().unwrap().parse().unwrap());
    let stored = store.get(session.id, execution).await.unwrap();
    assert!(stored.calls.is_empty());
    assert_eq!(stored.source, source);
    assert_eq!(
        stored.result,
        Some(json!({"data":["first","second"],"reviews":[]}))
    );
    // The default agent uses an in-process MCP client, not the HTTP listener.
    // Exercise its real connector and authenticated router as well as the wire.
    use agent_inmem::domain::mcp::McpToolConnector as _;
    let connector = agent_inmem::outbound::acp_mcp::AcpMcpConnector::new(
        agent_inmem::outbound::egress_mcp::EgressMcpClient::new(
            Arc::new(NoAppEgress),
            "http://localhost/agent-harness-egress",
        )
        .with_internal_mcp(crate::internal_mcp_handler(app.clone())),
    );
    let entry = |token| {
        agent_client_protocol::schema::v1::McpServerHttp::new(
            "macro_internal",
            "http://localhost/agent-harness-egress/mcp/internal",
        )
        .headers(vec![agent_client_protocol::schema::v1::HttpHeader::new(
            "Authorization",
            format!("Bearer {token}"),
        )])
    };
    assert!(
        connector
            .connect(vec![entry("wrong-session")])
            .await
            .is_none()
    );
    let remote = connector
        .connect(vec![entry("session-secret")])
        .await
        .expect("the default agent must discover internal code tools");
    let remote = ai_tools::DeferredToolSet::new(
        Arc::new(
            mcp_select::CombinedToolSet::new(Arc::new(AsyncToolCollection::<()>::new()), remote)
                .with_eager_mcp_tools(&[
                    "mcp__macro_internal__ExecuteCode",
                    "mcp__macro_internal__DescribeCodeTools",
                ]),
        ),
        Arc::from([]),
    );
    let schemas = remote.request_schemas().unwrap();
    for name in [
        "mcp__macro_internal__ExecuteCode",
        "mcp__macro_internal__DescribeCodeTools",
    ] {
        let schema = schemas.iter().find(|schema| schema.name == name).unwrap();
        assert!(!schema.description.is_empty());
        assert!(schema.schema.as_object().unwrap()["properties"].is_object());
        assert!(
            !remote
                .searchable_catalog()
                .iter()
                .any(|tool| tool.name == name)
        );
    }
    let docs = remote
        .try_tool_call(
            (),
            RequestContext::new(session.owner_user().unwrap().clone()),
            "mcp__macro_internal__DescribeCodeTools",
            &json!({"names": ["documents"]}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(docs["tools"][0]["name"], "documents");
    let response = remote
        .try_tool_call(
            (),
            RequestContext::new(session.owner_user().unwrap().clone()),
            "mcp__macro_internal__ExecuteCode",
            &json!({"execution_id": ExecutionId::mint(), "source": source}),
        )
        .await
        .unwrap()
        .unwrap();
    let receipt = response;
    assert_eq!(
        receipt["result"],
        json!({"data":["first", "second"],"reviews":[]})
    );
    let execution =
        ExecutionId::from_uuid(receipt["executionId"].as_str().unwrap().parse().unwrap());
    assert_eq!(
        store.get(session.id, execution).await.unwrap().calls.len(),
        0
    );
    let (_, failed) = rpc(app.clone(), Some("session-secret"), "tools/call", json!({"name": "ExecuteCode", "arguments": {"execution_id": ExecutionId::mint(), "source": "export async function main() { throw new Error(\"fixture failure\"); }"}})).await;
    assert_ne!(failed["result"]["isError"], true, "{failed}");
    assert_eq!(failed["result"]["structuredContent"]["status"], "failed");
    // A Stop processed on another replica changes shared session state. The
    // stateless MCP request itself stays connected and never sends cancellation.
    let cancelled_id = ExecutionId::mint();
    let running = tokio::spawn(async move {
        rpc(app, Some("session-secret"), "tools/call", json!({"name": "ExecuteCode", "arguments": {
            "execution_id": cancelled_id,
            "source": "export async function main() { await new Promise(r => setTimeout(r, 10000)); return {data:true,reviews:[]}; }"
        }})).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Ok(record) = store.get(session.id, cancelled_id).await
                && record.status == agent_code_mode::domain::ExecutionStatus::Running
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    sqlx::raw_sql("UPDATE agent_session SET turn_state = 'stopping'")
        .execute(&pool)
        .await
        .unwrap();
    let (_, stopped) = tokio::time::timeout(std::time::Duration::from_secs(3), running)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stopped["result"]["structuredContent"]["status"], "cancelled",
        "{stopped}"
    );
    let recovered = store.get(session.id, cancelled_id).await.unwrap();
    assert!(recovered.calls.is_empty());
    assert_eq!(
        recovered.status,
        agent_code_mode::domain::ExecutionStatus::Cancelled
    );
    runner.shutdown().await;
    assert_eq!(std::fs::read_dir(scratch.path()).unwrap().count(), 0);
}
