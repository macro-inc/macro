use super::*;
use mcp_toolset::ListedServer;
use rmcp::{ServerHandler, ServiceExt};

struct StubServer;
impl ServerHandler for StubServer {}

async fn remote(
    names: &[&str],
) -> (
    rmcp::service::RunningService<rmcp::RoleServer, StubServer>,
    RemoteMcpToolSet,
) {
    let (server_io, client_io) = tokio::io::duplex(4096);
    let (server, client) = tokio::join!(
        StubServer.serve(server_io),
        mcp_toolset::client_info().serve(client_io),
    );
    let tools = names
        .iter()
        .map(|name| {
            rmcp::model::Tool::new(
                (*name).to_owned(),
                "Fixture tool",
                Arc::new(
                    serde_json::json!({"type": "object"})
                        .as_object()
                        .unwrap()
                        .clone(),
                ),
            )
        })
        .collect();
    let remote = RemoteMcpToolSet::from_listed(
        vec![ListedServer {
            name: "macro_internal".into(),
            client: Arc::new(client.unwrap()),
            tools,
        }],
        None,
    );
    (server.unwrap(), remote)
}

fn request_context() -> RequestContext {
    RequestContext::new(
        macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
    )
}

/// The internal server hands a session code mode's tools beside others that
/// write; a draft's turn keeps only the first three.
async fn tools() -> (
    rmcp::service::RunningService<rmcp::RoleServer, StubServer>,
    DraftTools,
) {
    let (server, code) = remote(&[
        "ExecuteCode",
        "DescribeCodeTools",
        "ReadCodeDocs",
        "PresentReview",
        "CreateDocument",
    ])
    .await;
    (server, DraftTools { code: Some(code) })
}

#[tokio::test]
async fn a_draft_turn_offers_only_code_modes_tools() {
    let (_server, tools) = tools().await;
    let mut names: Vec<String> = AiToolSet::<()>::request_schemas(&tools)
        .unwrap()
        .into_iter()
        .map(|schema| schema.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "mcp__macro_internal__DescribeCodeTools",
            "mcp__macro_internal__ExecuteCode",
            "mcp__macro_internal__ReadCodeDocs",
        ]
    );
}

#[tokio::test]
async fn a_draft_turn_cannot_call_any_other_tool() {
    let (_server, tools) = tools().await;
    for name in [
        "mcp__macro_internal__CreateDocument",
        "mcp__macro_internal__PresentReview",
        "SendEmail",
        "CreateTask",
        "mcp__gmail__send_email",
    ] {
        let result = tools
            .dispatch_tool_call((), request_context(), name, &serde_json::json!({}))
            .await;
        assert!(
            matches!(result, Err(ToolSetError::NotFound(ref missing)) if missing == name),
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_draft_summary_has_no_tools() {
    assert!(AiToolSet::<()>::request_schemas(&DraftTools { code: None }).is_none());
}
