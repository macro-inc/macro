use super::*;
use agent_client_protocol::schema::v1::{
    SessionConfigId, SessionConfigOption, SessionConfigSelectOption,
};
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

fn harness(command: &str) -> Harness {
    Harness {
        command: command.to_owned(),
        args: Vec::new(),
    }
}

#[test]
fn pairing_catalog_projects_raw_acp_model_options_into_harness_domain_types() {
    let options = vec![
        SessionConfigOption::boolean(SessionConfigId::new("thinking"), "Thinking", true),
        SessionConfigOption::select(
            SessionConfigId::new("model"),
            "Model",
            "sonnet",
            vec![
                SessionConfigSelectOption::new("opus", "Opus").description("Largest model"),
                SessionConfigSelectOption::new("sonnet", "Sonnet"),
            ],
        ),
    ];

    let catalog = pairing_model_catalog(&options).expect("model select should project");

    assert_eq!(catalog.current, "sonnet");
    assert_eq!(
        catalog.options,
        vec![
            PairingModelOption {
                id: "opus".to_owned(),
                name: "Opus".to_owned(),
                description: Some("Largest model".to_owned()),
                group: None,
            },
            PairingModelOption {
                id: "sonnet".to_owned(),
                name: "Sonnet".to_owned(),
                description: None,
                group: None,
            },
        ]
    );
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
    let _ = bridge(&harness("true"), std::path::Path::new("/"), runtime).await;

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
    let error = bridge(&harness("true"), std::path::Path::new("/"), runtime)
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
        },
    };

    let error = probes
        .probe()
        .await
        .expect_err("unspawnable probe must fail");

    assert_eq!(error, "the ACP model probe process failed");
    assert!(!error.contains("secret-argument"));
}
