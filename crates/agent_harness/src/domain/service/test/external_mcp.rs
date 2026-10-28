use super::*;

#[tokio::test]
async fn external_binding_preserves_an_explicit_agent_mcp_selection() {
    let (service, _repo, _containers, _announcer, runtimes) = harness();
    let selection = AgentMcpServers::Selected {
        servers: vec![agent_session::domain::model::AgentMcpServer {
            app_slug: "linear".to_owned(),
            server_name: "Linear".to_owned(),
        }],
    };
    let mut request = open_external_request("/home/operator/code");
    request.profile = Some(agent_session::domain::ports::ManagedAgentProfile {
        model: String::new(),
        harness: harness_id::MACROD_HARNESS_SLUG.to_owned(),
        instructions: String::new(),
        mcp_servers: selection.clone(),
    });
    let session = service.open_external_session(request).await.unwrap();
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), runtime.clone());
    let prompted = service.control_event(
        session.id,
        ControlEvent {
            action: AgentAction::prompt("list my issues"),
            action_id: None,
            actor: Some(sender()),
            context: None,
        },
    );
    let (result, ()) = tokio::join!(prompted, complete_bound_handshake(&runtime));
    result.expect("the prompt reaches the external runtime");
    assert_eq!(
        service.inner.egress.provisioned(),
        [(session.id, sender().to_string(), selection)]
    );
}

#[tokio::test]
async fn an_external_open_provisions_nothing_and_prompts_nobody() {
    const INSTRUCTIONS: &str = "Never force-push.";
    let composer = PromptComposerMock::default();
    let (service, repo, containers, announcer, runtimes) =
        harness_with_edges(PromptContextMock::default(), composer.clone());
    service.inner.egress.connect("datadog");
    let mut request = open_external_request("/home/operator/code");
    request.profile = Some(agent_session::domain::ports::ManagedAgentProfile {
        model: String::new(),
        harness: harness_id::MACROD_HARNESS_SLUG.to_owned(),
        instructions: INSTRUCTIONS.to_owned(),
        mcp_servers: AgentMcpServers::OwnerConnections,
    });

    let session = service
        .open_external_session(request)
        .await
        .expect("an external open needs no runtime yet");

    // The row exists with the stated workspace, but nothing was provisioned,
    // nothing was announced, and no prompt has gone anywhere: the runtime
    // delivers the first prompt itself through the control endpoint after
    // dialing in.
    assert_eq!(session.workspace, "/home/operator/code");
    assert_eq!(containers.spawned(), 0);
    assert!(announcer.announced().is_empty());

    // The operator's runtime dials in for the bot. Nothing happens to the
    // session: no handshake, no ACP session, nothing sent - a session nobody
    // is prompting costs the runtime nothing.
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(session.bot_id), runtime.clone());
    assert!(runtime.agent().received_requests().is_empty());
    assert!(
        repo.get(session.id)
            .await
            .expect("the session row exists")
            .acp_session_id
            .is_none()
    );

    // The runtime forwards the mention through control: that is what binds the
    // session to the connection, handshakes, and lands the prompt.
    let prompted = service.control_event(
        session.id,
        ControlEvent {
            action: AgentAction::prompt("@claude fix the failing test"),
            action_id: None,
            actor: Some(sender()),
            context: None,
        },
    );
    let (result, ()) = tokio::join!(prompted, complete_bound_handshake(&runtime));
    result.expect("the first prompt binds the session and reaches the runtime");
    let requests = runtime.agent().received_requests();
    let ClientRequest::NewSessionRequest(open) = &requests[1] else {
        panic!("expected session/new")
    };
    assert_eq!(
        service.inner.egress.provisioned(),
        [(
            session.id,
            sender().to_string(),
            AgentMcpServers::OwnerConnections
        )]
    );
    assert_eq!(open.mcp_servers.len(), 4);
    let agent_client_protocol::schema::v1::McpServer::Http(datadog) = &open.mcp_servers[3] else {
        panic!("expected Datadog HTTP MCP");
    };
    assert_eq!(datadog.name, "datadog");
    assert_eq!(datadog.url, "https://egress.test/mcp/datadog");
    assert_eq!(datadog.headers[0].value, "Bearer test-session-token");
    let agent_client_protocol::schema::v1::McpServer::Http(preview) = &open.mcp_servers[2] else {
        panic!("expected preview HTTP MCP");
    };
    assert_eq!(preview.name, "macro-preview");
    assert!(preview.url.ends_with("/mcp-preview"));
    let agent_client_protocol::schema::v1::McpServer::Http(server) = &open.mcp_servers[1] else {
        panic!("expected HTTP MCP")
    };
    assert_eq!(server.name, "macro_internal");
    assert!(server.url.ends_with("/mcp/internal"));
    assert!(
        server
            .headers
            .iter()
            .any(|header| header.name == "Authorization")
    );

    assert_eq!(
        prompts(&runtime.agent()),
        [vec![ContentBlock::from("@claude fix the failing test")]]
    );
    // Prompt delivery is ordered behind the `session/new` response, so the
    // negotiated ACP session id has been persisted by now.
    let row = repo.get(session.id).await.expect("the session row exists");
    assert_eq!(row.acp_session_id, Some(SessionId::new("acp-test")));
    assert_eq!(row.instructions.as_deref(), Some(INSTRUCTIONS));
    assert_eq!(
        composer.calls(),
        [(
            "@claude fix the failing test".to_owned(),
            Some(INSTRUCTIONS.to_owned()),
            None,
        )]
    );
}
