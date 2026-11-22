use super::*;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};

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
        &ActiveTurns::default(),
        None,
        &mut Handoffs::channel().0,
        None,
        &tokio::sync::Notify::new(),
        None,
        &crate::harness::Hosting::default(),
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
    let _ = bridge(
        &harness("true"),
        std::path::Path::new("/"),
        runtime,
        None,
        &ActiveTurns::default(),
        None,
        &mut Handoffs::channel().0,
        None,
        &tokio::sync::Notify::new(),
        None,
        &crate::harness::Hosting::default(),
    )
    .await;

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
    let error = bridge(
        &harness("true"),
        std::path::Path::new("/"),
        runtime,
        None,
        &ActiveTurns::default(),
        None,
        &mut Handoffs::channel().0,
        None,
        &tokio::sync::Notify::new(),
        None,
        &crate::harness::Hosting::default(),
    )
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
    let (runtime, service) = Channel::duplex();
    let ServerChannel {
        tx: to_bridge,
        rx: mut from_bridge,
    } = service;
    // Answers `session/new` with a session id, and every prompt with the
    // prompt blocks it received.
    let agent = Harness {
        command: "python3".to_owned(),
        args: vec![
            "-c".to_owned(),
            r#"
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if request["method"] == "session/new":
        result = {"sessionId": "acp-1"}
    else:
        result = {"prompt": request["params"]["prompt"]}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"#
            .to_owned(),
        ],
        env: Default::default(),
    };
    let send = |value: serde_json::Value| {
        to_bridge
            .send(ToRuntimeMessage::Acp(AcpMessage(
                serde_json::from_value(value).expect("a valid JSON-RPC message"),
            )))
            .expect("the bridge is running");
    };
    let mut handoffs = Handoffs::channel().0;
    let turns = ActiveTurns::default();
    let agents_changed = tokio::sync::Notify::new();
    let set_up = crate::harness::Hosting::default();
    let bridge = bridge(
        &agent,
        std::path::Path::new("/"),
        runtime,
        None,
        &turns,
        None,
        &mut handoffs,
        None,
        &agents_changed,
        None,
        &set_up,
    );
    let conversation = async {
        let mut next_answer = async || loop {
            match from_bridge.recv().await.expect("the bridge is running") {
                ToServerMessage::Acp(AcpMessage(frame)) => {
                    break serde_json::to_value(frame).expect("a serializable message");
                }
                ToServerMessage::Event { .. } => {}
                other => panic!("unexpected message {other:?}"),
            }
        };
        send(serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/new",
            "params": {"cwd": "/home/operator/code", "mcpServers": []}
        }));
        next_answer().await;
        send(serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
            "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "hello"}]}
        }));
        next_answer().await
    };

    let answer = tokio::select! {
        answer = conversation => answer,
        ended = bridge => panic!("the bridge ended early: {ended:?}"),
    };

    let blocks = answer["result"]["prompt"]
        .as_array()
        .expect("the agent echoed the prompt blocks");
    assert_eq!(blocks.len(), 2, "got {answer}");
    assert!(
        blocks[0]["text"]
            .as_str()
            .is_some_and(|text| text.starts_with("<macrod-runtime>")),
        "got {answer}"
    );
    assert_eq!(
        blocks[1],
        serde_json::json!({"type": "text", "text": "hello"})
    );
}

/// The whole path on one connection: the service's `RunTeammate` reaches
/// the supervisor and ends in a running container (on the fake engine), and
/// the connection carries the host report and each state back.
#[cfg(unix)]
#[tokio::test]
async fn a_run_teammate_over_the_runtime_socket_ends_in_a_running_container() {
    use agent_runtime_protocol::domain::schema::v0::TeammateRunState;

    let (hosting, engine, _exit, _directory) = crate::teammate::test::fake_hosting().await;
    let (runtime, mut service) = Channel::duplex();
    // An agent that stays up, so the bridge keeps relaying.
    let agent = Harness {
        command: "sleep".to_owned(),
        args: vec!["30".to_owned()],
        env: Default::default(),
    };
    let mut handoffs = Handoffs::channel().0;
    let agents_changed = tokio::sync::Notify::new();
    let turns = ActiveTurns::default();
    let set_up = crate::harness::Hosting::default();
    let bridged = bridge(
        &agent,
        std::path::Path::new("/"),
        runtime,
        None,
        &turns,
        None,
        &mut handoffs,
        None,
        &agents_changed,
        Some(hosting),
        &set_up,
    );

    let served = async {
        service
            .tx
            .send(ToRuntimeMessage::RunTeammate {
                install: crate::teammate::test::fake_install(),
                image: crate::teammate::test::fake_image(),
                environment: crate::teammate::test::fake_environment(),
                traceparent: None,
            })
            .unwrap();
        let mut reported_host = false;
        let mut states = Vec::new();
        while states.last() != Some(&TeammateRunState::Running) {
            match service.rx.recv().await.expect("the bridge stays connected") {
                ToServerMessage::TeammateHost { report } => {
                    assert!(report.problem.is_none(), "{report:?}");
                    reported_host = true;
                }
                ToServerMessage::TeammateStatus { install, state } => {
                    assert_eq!(install, crate::teammate::test::fake_install());
                    states.push(state);
                }
                _ => {}
            }
        }
        (reported_host, states)
    };
    let (reported_host, states) = tokio::select! {
        served = served => served,
        ended = bridged => panic!("the bridge ended first: {ended:?}"),
    };

    assert!(reported_host, "the connection sends the host report first");
    assert_eq!(
        states,
        [
            TeammateRunState::Downloading,
            TeammateRunState::Starting,
            TeammateRunState::Running,
        ]
    );
    assert_eq!(engine.runs(), 1);
}

/// An image swap during an active session: the teammate's container is
/// replaced, but macrod's runtime connection and the session's agent on it
/// are not touched (no redial, no disconnect), so there is nothing to
/// re-attach; the agent in the container redials Macro itself.
#[cfg(unix)]
#[tokio::test]
async fn an_image_swap_leaves_the_runtime_connection_and_its_agent_alone() {
    use agent_runtime_protocol::domain::schema::v0::{TeammateInstall, TeammateRunState};

    let (hosting, engine, _exit, _directory) = crate::teammate::test::fake_hosting().await;
    let (runtime, mut service) = Channel::duplex();
    let agent = Harness {
        command: "sleep".to_owned(),
        args: vec!["30".to_owned()],
        env: Default::default(),
    };
    let mut handoffs = Handoffs::channel().0;
    let agents_changed = tokio::sync::Notify::new();
    let turns = ActiveTurns::default();
    let set_up = crate::harness::Hosting::default();
    let bridged = bridge(
        &agent,
        std::path::Path::new("/"),
        runtime,
        None,
        &turns,
        None,
        &mut handoffs,
        None,
        &agents_changed,
        Some(hosting),
        &set_up,
    );

    let first = crate::teammate::test::fake_install();
    let second = TeammateInstall {
        generation: first.generation + 1,
        ..first.clone()
    };
    let other_image = crate::teammate::test::offer_other_image(&engine);
    let served = async {
        let mut events = Vec::new();
        for (install, image) in [
            (first.clone(), crate::teammate::test::fake_image()),
            (second.clone(), other_image.clone()),
        ] {
            service
                .tx
                .send(ToRuntimeMessage::RunTeammate {
                    install: install.clone(),
                    image,
                    environment: crate::teammate::test::fake_environment(),
                    traceparent: None,
                })
                .unwrap();
            loop {
                match service.rx.recv().await.expect("the bridge stays connected") {
                    ToServerMessage::TeammateStatus {
                        install: reported,
                        state: TeammateRunState::Running,
                    } if reported == install => break,
                    ToServerMessage::Event { event } => events.push(event),
                    _ => {}
                }
            }
        }
        events
    };
    let events = tokio::select! {
        events = served => events,
        ended = bridged => panic!("the swap ended the runtime connection: {ended:?}"),
    };

    assert!(
        !events.contains(&SystemEvent::Disconnected),
        "the session's agent was disconnected: {events:?}"
    );
    assert_eq!(
        crate::teammate::test::run_images(&engine),
        [
            crate::teammate::test::fake_image().image_id,
            other_image.image_id
        ]
    );
}
