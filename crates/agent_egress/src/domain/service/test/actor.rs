use super::*;
use crate::domain::ports::ActorMcpTransport;
use serde_json::{Value, json};

#[derive(Default)]
struct ActorTransport(Mutex<Vec<Value>>);

#[async_trait::async_trait]
impl ActorMcpTransport for ActorTransport {
    async fn exchange(
        &self,
        _: AgentSessionId,
        _: MacroUserIdStr<'static>,
        _: UpstreamCall,
        request: Value,
    ) -> Result<Value, EgressError> {
        self.0.lock().unwrap().push(request.clone());
        if request["method"] == "tools/list" {
            Ok(
                json!({"tools":[{"name":"search","inputSchema":{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}}]}),
            )
        } else {
            Ok(json!({"content":[{"type":"text","text":"ok"}]}))
        }
    }
}

#[tokio::test]
async fn requester_credentials_are_used_and_actor_is_never_forwarded() {
    let asker = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    let transport = Arc::new(ActorTransport::default());
    let service = gated(prompted_by(Some(asker.clone())), SpyCredentials::knowing())
        .with_actor_mcp(transport.clone());
    let request = json_request(
        r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"acting_as":"requester","q":"x"}}}"#,
    );
    let response = service
        .proxy(
            &SessionToken::new("session"),
            EgressTarget::McpServer(McpDestination::Connected(
                McpServerSlug::parse("linear").unwrap(),
            )),
            request,
        )
        .await
        .unwrap();
    assert_eq!(
        body_json(response).await["result"]["content"][0]["text"],
        "ok"
    );
    assert_eq!(
        service.credentials.asked.lock().unwrap()[0].0,
        asker.to_string()
    );
    assert_eq!(
        transport.0.lock().unwrap()[0]["params"]["arguments"],
        json!({"q":"x"})
    );
    assert!(service.approvals.held.lock().unwrap().is_empty());
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn choosing_owner_still_holds_the_call_without_executing_it() {
    let transport = Arc::new(ActorTransport::default());
    let service = gated(
        prompted_by(Some(
            MacroUserIdStr::try_from_email("asker@example.com").unwrap(),
        )),
        SpyCredentials::knowing(),
    )
    .with_actor_mcp(transport.clone());
    let request = json_request(
        r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"acting_as":"owner","q":"x"}}}"#,
    );
    let response = service
        .proxy(
            &SessionToken::new("session"),
            EgressTarget::McpServer(McpDestination::Macro),
            request,
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::IM_USED);
    assert_eq!(
        service.credentials.asked.lock().unwrap()[0].0,
        owner().to_string()
    );
    assert_eq!(service.approvals.held.lock().unwrap().len(), 1);
    assert!(transport.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_selection_and_missing_requester_never_resolve_credentials() {
    let transport = Arc::new(ActorTransport::default());
    let service =
        gated(prompted_by(None), SpyCredentials::knowing()).with_actor_mcp(transport.clone());
    for arguments in [
        json!({}),
        json!({"acting_as":"requester"}),
        json!({"acting_as":"other@example.com"}),
    ] {
        let request = json_request(&json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":arguments}}).to_string());
        let response = service
            .proxy(
                &SessionToken::new("session"),
                EgressTarget::McpServer(McpDestination::Macro),
                request,
            )
            .await
            .unwrap();
        assert_eq!(body_json(response).await["result"]["isError"], true);
    }
    assert!(service.credentials.asked.lock().unwrap().is_empty());
    assert!(transport.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_requester_connection_offers_connect_without_owner_fallback() {
    let asker = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    let transport = Arc::new(ActorTransport::default());
    let service = gated(
        prompted_by(Some(asker.clone())),
        SpyCredentials::unconnected(),
    )
    .with_actor_mcp(transport.clone());
    let request = json_request(
        r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"acting_as":"requester"}}}"#,
    );
    let response = service
        .proxy(
            &SessionToken::new("session"),
            EgressTarget::McpServer(McpDestination::Connected(
                McpServerSlug::parse("linear").unwrap(),
            )),
            request,
        )
        .await
        .unwrap();
    let result = body_json(response).await;
    assert_eq!(result["result"]["isError"], true);
    assert!(
        result["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("<m-connect-app>")
    );
    assert_eq!(service.credentials.asked.lock().unwrap().len(), 1);
    assert_eq!(
        service.credentials.asked.lock().unwrap()[0].0,
        asker.to_string()
    );
    assert!(service.approvals.held.lock().unwrap().is_empty());
    assert!(transport.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deferred_mcp_catalog_requires_an_actor_without_changing_provider_arguments() {
    let transport = Arc::new(ActorTransport::default());
    let service =
        gated(prompted_by(Some(owner())), SpyCredentials::knowing()).with_actor_mcp(transport);
    let response = service
        .proxy(
            &SessionToken::new("session"),
            EgressTarget::McpServer(McpDestination::Macro),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .unwrap();
    let result = body_json(response).await;
    assert_eq!(
        result["result"]["tools"][0]["inputSchema"]["required"],
        json!(["q", "acting_as"])
    );
}

struct TurnChanges(std::sync::atomic::AtomicUsize);

impl SessionAuthority for TurnChanges {
    async fn authorize(&self, _: &SessionToken) -> Result<SessionGrant, EgressError> {
        let StubSessions(Ok(mut grant)) = prompted_by(Some(asker())) else {
            unreachable!()
        };
        if self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            grant.prompter.as_mut().unwrap().action_id =
                agent_runtime_protocol::domain::action::AgentActionId::from_uuid(
                    macro_uuid::Uuid::from_u128(1),
                );
        }
        Ok(grant)
    }
}

struct Approve;
impl OwnerApprovals for Approve {
    async fn hold(&self, call: HeldCall) -> Result<ProxyResponse, EgressError> {
        (call.forward)(call.request).await
    }
    async fn withdraw(&self, _: AgentSessionId, _: &Value) -> Result<(), EgressError> {
        Ok(())
    }
}

#[tokio::test]
async fn an_owner_approval_cannot_execute_after_the_original_turn_is_superseded() {
    let service = EgressServiceImpl::new(
        TurnChanges(std::sync::atomic::AtomicUsize::new(0)),
        SpyCredentials::knowing(),
        SpyGithubTokens::default(),
        SpyForwarder::answering(&[]),
    )
    .with_owner_approvals(Approve)
    .with_actor_mcp(Arc::new(ActorTransport::default()));
    let response = service.proxy(&SessionToken::new("session"), EgressTarget::McpServer(McpDestination::Macro), json_request(r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"ListEmails","arguments":{"acting_as":"owner"}}}"#)).await.unwrap();
    assert_eq!(body_json(response).await["result"]["isError"], true);
    assert!(!service.forward.was_called());
}
