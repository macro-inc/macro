use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ContentBlock, ErrorData, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerConfig,
};
use rmcp::service::{RequestContext as McpRequestContext, RoleServer};
use rmcp::{ServerHandler, ServiceExt as _};
use tokio::sync::Notify;

use super::*;

/// `hold` waits until its request is cancelled, as a call held for the
/// owner's approval does; `echo` answers at once.
#[derive(Clone, Default)]
struct HoldingServer {
    holding: Arc<Notify>,
    cancelled: Arc<Notify>,
}

impl ServerHandler for HoldingServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: McpRequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(vec![
            Tool::new(
                "hold",
                "Waits for the owner's approval.",
                Arc::new(serde_json::Map::new()),
            ),
            Tool::new("echo", "Answers at once.", Arc::new(serde_json::Map::new())),
        ]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: McpRequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if request.name == "echo" {
            return Ok(CallToolResult::success(vec![ContentBlock::text("echo")]).into());
        }
        self.holding.notify_one();
        context.ct.cancelled().await;
        self.cancelled.notify_one();
        Err(ErrorData::internal_error("cancelled", None))
    }
}

#[tokio::test]
async fn cancelling_the_request_abandons_a_held_call_and_tells_the_server() {
    let server = HoldingServer::default();
    let (server_side, client_side) = tokio::io::duplex(8192);
    tokio::spawn({
        let server = server.clone();
        async move {
            let running = server.serve(server_side).await.unwrap();
            let _ = running.waiting().await;
        }
    });
    let client = crate::client_info().serve(client_side).await.unwrap();
    let tools = RemoteMcpToolSet::from_connected(
        vec![ConnectedServer {
            name: "Macro".into(),
            client,
        }],
        None,
    )
    .await;
    let request = RequestContext::new(
        macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
    );
    let cancel = request.cancel.clone();
    let call = tokio::spawn({
        let tools = tools.clone();
        async move {
            ToolSet::<()>::dispatch_tool_call(
                &tools,
                (),
                request,
                "mcp__Macro__hold",
                &serde_json::json!({}),
            )
            .await
        }
    });
    server.holding.notified().await;

    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("cancelling the request ends the held call")
        .unwrap()
        .unwrap();

    assert_eq!(
        result.unwrap_err().description,
        "Stopped before the tool replied; the server may still have completed it."
    );
    tokio::time::timeout(Duration::from_secs(5), server.cancelled.notified())
        .await
        .expect("the server is told the call was cancelled");

    let echo = ToolSet::<()>::dispatch_tool_call(
        &tools,
        (),
        RequestContext::new(
            macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        ),
        "mcp__Macro__echo",
        &serde_json::json!({}),
    )
    .await
    .unwrap();
    assert!(echo.is_ok(), "the session still serves calls: {echo:?}");
}
