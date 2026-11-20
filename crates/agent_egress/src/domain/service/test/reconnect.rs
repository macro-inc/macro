//! A sandbox owner's `tools/call` is forwarded raw; Macro Connect's HTTP 409
//! for an expired grant comes back as the reconnect tool result.

use super::*;
use crate::domain::approval::HeldCall;
use crate::domain::ports::ActorMcpTransport;
use serde_json::Value;

/// Never reached: owner calls are forwarded, not exchanged.
struct UnusedTransport;

#[async_trait::async_trait]
impl ActorMcpTransport for UnusedTransport {
    async fn exchange(
        &self,
        _: AgentSessionId,
        _: MacroUserIdStr<'static>,
        _: UpstreamCall,
        _: Value,
    ) -> Result<Value, EgressError> {
        Err(EgressError::Internal(rootcause::report!(
            "owner calls are forwarded"
        )))
    }
}

/// The owner approves every held call at once, so it is forwarded.
struct GrantingApprovals;

impl OwnerApprovals for GrantingApprovals {
    async fn hold(&self, call: HeldCall) -> Result<ProxyResponse, EgressError> {
        (call.forward)(call.request).await
    }

    async fn withdraw(&self, _: AgentSessionId, _: &Value) -> Result<(), EgressError> {
        Ok(())
    }

    async fn hold_in_process(
        &self,
        _: crate::domain::approval::InProcessCall,
    ) -> Result<agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus, EgressError>
    {
        Ok(agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus::Approved)
    }
}

const OWNER_CALL: &str = r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"acting_as":"owner","q":"x"}}}"#;

const RECONNECT_DATADOG: &str =
    r#"<m-connect-app>{"appSlug":"datadog","name":"Datadog","reconnect":true}</m-connect-app>"#;

async fn reconnect_result(response: ProxyResponse) -> String {
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["id"], 9);
    assert_eq!(body["result"]["isError"], true);
    body["result"]["content"][0]["text"]
        .as_str()
        .expect("text")
        .to_owned()
}

#[tokio::test]
async fn an_owner_call_refused_for_an_expired_grant_offers_reconnect() {
    let service = EgressServiceImpl::new(
        prompted_by(Some(owner())),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering_status(StatusCode::CONFLICT),
    )
    .with_owner_approvals(RecordingApprovals::default())
    .with_actor_mcp(Arc::new(UnusedTransport));

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(OWNER_CALL),
        )
        .await
        .expect("proxied");

    assert!(service.forward.was_called());
    let text = reconnect_result(response).await;
    assert!(text.contains(RECONNECT_DATADOG), "{text}");
}

#[tokio::test]
async fn an_approved_owner_call_refused_for_an_expired_grant_offers_reconnect() {
    let asker = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    let service = EgressServiceImpl::new(
        prompted_by(Some(asker)),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering_status(StatusCode::CONFLICT),
    )
    .with_owner_approvals(GrantingApprovals)
    .with_actor_mcp(Arc::new(UnusedTransport));

    let response = service
        .proxy(
            &SessionToken::new("token"),
            datadog(),
            json_request(OWNER_CALL),
        )
        .await
        .expect("proxied");

    assert!(service.forward.was_called());
    let text = reconnect_result(response).await;
    assert!(text.contains(RECONNECT_DATADOG), "{text}");
}

#[tokio::test]
async fn a_custom_servers_409_on_an_owner_call_passes_through() {
    let service = EgressServiceImpl::new(
        prompted_by(Some(owner())),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering_status(StatusCode::CONFLICT),
    )
    .with_owner_approvals(RecordingApprovals::default())
    .with_actor_mcp(Arc::new(UnusedTransport));

    let response = service
        .proxy(
            &SessionToken::new("token"),
            EgressTarget::McpServer(McpDestination::Custom(
                CustomMcpServerKey::parse("0123456789abcdef0123456789abcdef").unwrap(),
            )),
            json_request(OWNER_CALL),
        )
        .await
        .expect("proxied");

    assert!(service.forward.was_called());
    assert_eq!(response.status(), StatusCode::CONFLICT);
}
