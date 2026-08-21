use super::*;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

fn harness(command: &str) -> Harness {
    Harness {
        command: command.to_owned(),
        args: Vec::new(),
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

    let error = bridge(&harness("macro-no-such-harness-binary"), runtime)
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
    let _ = bridge(&harness("true"), runtime).await;

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
    let error = bridge(&harness("true"), runtime)
        .await
        .expect_err("announcing into a closed channel must fail");

    assert!(matches!(error, BridgeError::Announce(_)), "got {error:?}");
}
