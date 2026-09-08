use super::*;
use rmcp::ServiceExt;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Probe(Arc<AtomicUsize>, Arc<tokio::sync::Notify>);
impl rmcp::ServerHandler for Probe {
    async fn list_tools(
        &self,
        _: Option<rmcp::model::PaginatedRequestParams>,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
        Ok(rmcp::model::ListToolsResult {
            tools: vec![Tool::new(
                "probe",
                "A probe",
                Arc::new(
                    serde_json::json!({"type":"object","properties":{}})
                        .as_object()
                        .unwrap()
                        .clone(),
                ),
            )],
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        _: CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        self.0.fetch_add(1, Ordering::SeqCst);
        context.ct.cancelled().await;
        self.1.notify_one();
        Ok(CallToolResult::success(vec![]))
    }
}

#[tokio::test]
async fn cancelled_and_abandoned_calls_do_not_leave_server_work_running() {
    let calls = Arc::new(AtomicUsize::new(0));
    let cancelled = Arc::new(tokio::sync::Notify::new());
    let (a, b) = tokio::io::duplex(8192);
    let probe = Probe(calls.clone(), cancelled.clone());
    let server = tokio::spawn(async move { probe.serve(a).await.unwrap() });
    let client = crate::client_info().into_dyn().serve(b).await.unwrap();
    let server = server.await.unwrap();
    let tools = RemoteMcpToolSet::from_connected(
        vec![ConnectedServer {
            name: "macro".into(),
            client,
        }],
        None,
    )
    .await;
    let context = RequestContext::new("macro|alice@example.com".try_into().unwrap());
    context.cancel.cancel();
    assert!(
        tools
            .call_tool("mcp__macro__probe", Default::default(), context)
            .await
            .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let context = RequestContext::new("macro|alice@example.com".try_into().unwrap());
    let active_tools = tools.clone();
    let task = tokio::spawn(async move {
        active_tools
            .call_tool("mcp__macro__probe", Default::default(), context)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    task.abort();
    tokio::time::timeout(std::time::Duration::from_secs(5), cancelled.notified())
        .await
        .unwrap();
    server.cancel().await.unwrap();
}
