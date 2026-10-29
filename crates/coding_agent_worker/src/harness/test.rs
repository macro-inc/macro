use super::*;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

fn harness(command: &str) -> Harness {
    Harness {
        command: command.to_owned(),
        args: Vec::new(),
        env: Default::default(),
    }
}

/// Drain the system events the service side observed, in order.
fn events(mut service: ServerChannel) -> Vec<SystemEvent> {
    let mut seen = Vec::new();
    while let Ok(message) = service.rx.try_recv() {
        match message {
            ToServerMessage::Event { event } => seen.push(event),
            other => panic!("only system events expected, got {other:?}"),
        }
    }
    seen
}

#[tokio::test]
async fn unspawnable_harness_reports_failure() {
    let (runtime, service) = Channel::duplex();

    let error = bridge(
        &harness("macro-no-such-harness-binary"),
        std::path::Path::new("/"),
        runtime,
        None,
    )
    .await
    .expect_err("a harness that cannot be spawned must not look like success");

    assert!(matches!(error, BridgeError::Harness(_)), "got {error:?}");
    // The service is told the transport is done even though the child never
    // existed, so it is never left waiting on a session that cannot start.
    assert_eq!(
        events(service),
        vec![SystemEvent::AcpReady, SystemEvent::Disconnected],
    );
}

#[tokio::test]
async fn harness_that_exits_immediately_disconnects() {
    let (runtime, service) = Channel::duplex();

    // `true` spawns cleanly and closes its stdio at once, which is the
    // shutdown path rather than the spawn-failure path above.
    let _ = bridge(&harness("true"), std::path::Path::new("/"), runtime, None).await;

    assert_eq!(
        events(service),
        vec![SystemEvent::AcpReady, SystemEvent::Disconnected],
    );
}

#[tokio::test]
async fn dropped_service_channel_does_not_panic_the_bridge() {
    let (runtime, service) = Channel::duplex();
    drop(service);

    // Announcing readiness into a closed channel is a failure to announce, not
    // a harness failure: nothing was ever spawned.
    let error = bridge(&harness("true"), std::path::Path::new("/"), runtime, None)
        .await
        .expect_err("announcing into a closed channel must fail");

    assert!(matches!(error, BridgeError::Announce(_)), "got {error:?}");
}

#[tokio::test]
async fn model_probe_process_failures_are_safely_redacted() {
    let probes = HarnessModelProbes {
        process: ProbeSubprocess {
            command: "macro-no-such-harness-binary".into(),
            args: vec!["secret-argument".to_owned()],
            cwd: "/".into(),
            env: Default::default(),
        },
    };

    let error = probes
        .probe()
        .await
        .expect_err("unspawnable probe must fail");

    assert_eq!(error, "the ACP model probe process failed");
    assert!(!error.contains("secret-argument"));
}

#[tokio::test]
async fn relay_teaches_a_new_session_on_its_first_prompt() {
    let (mut service, service_side) = AcpChannel::duplex();
    let (agent_side, mut agent) = AcpChannel::duplex();
    let _relay = tokio::spawn(relay(service_side, agent_side));
    let frame = |value: serde_json::Value| {
        TransportFrame::Single(serde_json::from_value(value).expect("a valid JSON-RPC message"))
    };
    let received = |frame: TransportFrame| match frame {
        TransportFrame::Single(message) => {
            serde_json::to_value(message).expect("a serializable message")
        }
        other => panic!("expected one message, got {other:?}"),
    };

    service
        .tx
        .unbounded_send(frame(serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/new",
            "params": {"cwd": "/home/operator/code", "mcpServers": []}
        })))
        .expect("the relay is running");
    agent
        .rx
        .next()
        .await
        .expect("session/new reaches the agent");
    agent
        .tx
        .unbounded_send(frame(serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "result": {"sessionId": "acp-1"}
        })))
        .expect("the relay is running");
    service
        .rx
        .next()
        .await
        .expect("the answer reaches the service");
    service
        .tx
        .unbounded_send(frame(serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
            "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "hello"}]}
        })))
        .expect("the relay is running");

    let prompt = received(agent.rx.next().await.expect("the prompt reaches the agent"));
    let blocks = prompt["params"]["prompt"]
        .as_array()
        .expect("the prompt is a block list");
    assert_eq!(blocks.len(), 2);
    assert!(
        blocks[0]["text"]
            .as_str()
            .is_some_and(|text| text.starts_with("<macrod-runtime>")),
        "got {prompt}"
    );
    assert_eq!(
        blocks[1],
        serde_json::json!({"type": "text", "text": "hello"})
    );
}
