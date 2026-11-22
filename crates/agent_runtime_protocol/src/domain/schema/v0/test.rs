use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::RequestId;
use serde_json::json;

use super::*;

#[test]
fn event_names_are_opaque_wire_strings() {
    let event_names = [
        SystemEvent::Unknown("runtime/ready".to_owned()),
        SystemEvent::Unknown("agent/started".to_owned()),
        SystemEvent::Unknown("vendor/custom-event".to_owned()),
    ];
    for name in event_names {
        let wire_name = name.as_str();
        assert_eq!(serde_json::to_value(&name).unwrap(), json!(wire_name));
        assert_eq!(
            serde_json::from_value::<SystemEvent>(json!(wire_name)).unwrap(),
            name
        );
    }
}

#[test]
fn acp_ready_round_trips_as_a_typed_variant() {
    assert_eq!(
        serde_json::to_value(SystemEvent::AcpReady).unwrap(),
        json!("acp_ready")
    );
    assert_eq!(
        serde_json::from_value::<SystemEvent>(json!("acp_ready")).unwrap(),
        SystemEvent::AcpReady
    );
}

#[test]
fn disconnected_round_trips_as_a_typed_variant() {
    assert_eq!(
        serde_json::to_value(SystemEvent::Disconnected).unwrap(),
        json!("disconnected")
    );
    assert_eq!(
        serde_json::from_value::<SystemEvent>(json!("disconnected")).unwrap(),
        SystemEvent::Disconnected
    );
}

#[test]
fn unknown_event_names_round_trip_losslessly() {
    let event = serde_json::from_value::<SystemEvent>(json!("vendor/custom-event")).unwrap();
    assert_eq!(
        event,
        SystemEvent::Unknown("vendor/custom-event".to_owned())
    );
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!("vendor/custom-event")
    );
}

#[test]
fn to_server_message_event_has_the_specified_wire_shape() {
    let event = ToServerMessage::Event {
        event: SystemEvent::Unknown("agent/stopped".to_owned()),
    };

    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "type": "event",
            "event": "agent/stopped",
        })
    );
}

#[test]
fn acp_message_contains_an_acp_raw_jsonrpc_message() {
    let nested = RawJsonRpcMessage::request(
        "initialize".to_owned(),
        json!({ "protocolVersion": 1 }),
        RequestId::Number(1),
    )
    .unwrap();
    let delivery = ToRuntimeMessage::Acp(AcpMessage(nested));

    let message = serde_json::to_value(delivery).unwrap();
    assert_eq!(
        message,
        json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
            },
        })
    );

    let ToRuntimeMessage::Acp(AcpMessage(parsed)) =
        serde_json::from_value::<ToRuntimeMessage>(message).unwrap()
    else {
        panic!("expected ACP message")
    };
    assert_eq!(
        serde_json::to_value(parsed).unwrap(),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
            },
        })
    );
}

#[test]
fn agents_changed_is_a_bare_hint() {
    assert_eq!(
        serde_json::to_value(ToRuntimeMessage::AgentsChanged).unwrap(),
        json!({ "type": "agentsChanged" })
    );
}

#[test]
fn recheck_teammate_host_is_a_hint_carrying_only_its_trace() {
    let traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    assert_eq!(
        serde_json::to_value(ToRuntimeMessage::RecheckTeammateHost {
            traceparent: Some(traceparent.to_owned()),
        })
        .unwrap(),
        json!({ "type": "recheckTeammateHost", "traceparent": traceparent })
    );
    assert_eq!(
        serde_json::to_value(ToRuntimeMessage::RecheckTeammateHost { traceparent: None }).unwrap(),
        json!({ "type": "recheckTeammateHost" })
    );
    // As a service without the field sends it.
    assert!(matches!(
        serde_json::from_value(json!({ "type": "recheckTeammateHost" })).unwrap(),
        ToRuntimeMessage::RecheckTeammateHost { traceparent: None }
    ));
    assert_eq!(ACCEPTS_RECHECK_TEAMMATE_HOST, "recheck-teammate-host");
}

#[test]
fn model_probe_messages_carry_no_session_id_and_no_correlation() {
    let request = ToRuntimeMessage::ModelProbeRequest;
    let response = ToServerMessage::ModelProbeResponse {
        result: ModelProbeResult::Available {
            config_options: Vec::new(),
        },
    };

    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({ "type": "modelProbeRequest" })
    );
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "type": "modelProbeResponse",
            "result": {
                "status": "available",
                "configOptions": [],
            },
        })
    );
}

#[test]
fn an_agent_environment_travels_by_name_and_debug_shows_no_value() {
    let message = ToRuntimeMessage::ApplyAgent {
        environment: AgentEnvironment(
            [("MACRO_API_KEY".to_owned(), "mak_secret".to_owned())]
                .into_iter()
                .collect(),
        ),
        traceparent: None,
    };

    let wire = serde_json::to_value(&message).unwrap();
    assert_eq!(
        wire,
        json!({ "type": "applyAgent", "environment": { "MACRO_API_KEY": "mak_secret" } })
    );
    let read: ToRuntimeMessage = serde_json::from_value(wire).unwrap();
    let ToRuntimeMessage::ApplyAgent { environment, .. } = read else {
        panic!("not an agent environment");
    };
    let debug = format!("{environment:?}");
    assert!(debug.contains("MACRO_API_KEY"));
    assert!(!debug.contains("mak_secret"));
}

#[test]
fn a_teammate_run_carries_its_install_image_and_environment() {
    let message = ToRuntimeMessage::RunTeammate {
        install: TeammateInstall {
            install_id: TeammateInstallId::new("3f2a-install").unwrap(),
            generation: 4,
            delivery: 2,
        },
        image: TeammateImage {
            repository: "ghcr.io/macro-inc/teammate-runtime".to_owned(),
            image_id: format!("sha256:{}", "a".repeat(64)),
        },
        environment: AgentEnvironment(
            [("MACRO_API_KEY".to_owned(), "mak_secret".to_owned())]
                .into_iter()
                .collect(),
        ),
        traceparent: Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".to_owned()),
    };

    let wire = serde_json::to_value(&message).unwrap();
    assert_eq!(
        wire,
        json!({
            "type": "runTeammate",
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            "install": { "installId": "3f2a-install", "generation": 4, "delivery": 2 },
            "image": {
                "repository": "ghcr.io/macro-inc/teammate-runtime",
                "imageId": format!("sha256:{}", "a".repeat(64)),
            },
            "environment": { "MACRO_API_KEY": "mak_secret" },
        })
    );
    let read: ToRuntimeMessage = serde_json::from_value(wire).unwrap();
    assert!(
        matches!(read, ToRuntimeMessage::RunTeammate { install, .. } if install.generation == 4)
    );
}

#[test]
fn a_teammate_stop_names_its_install() {
    let message = ToRuntimeMessage::StopTeammate {
        install: TeammateInstall {
            install_id: TeammateInstallId::new("3f2a-install").unwrap(),
            generation: 4,
            delivery: 0,
        },
        traceparent: None,
    };

    assert_eq!(
        serde_json::to_value(&message).unwrap(),
        json!({
            "type": "stopTeammate",
            "install": { "installId": "3f2a-install", "generation": 4, "delivery": 0 },
        })
    );
}

#[test]
fn an_install_id_that_could_escape_a_container_name_is_refused() {
    for bad in ["", "../etc", "a b", "x;rm", &"a".repeat(65)] {
        assert!(TeammateInstallId::new(bad).is_err(), "{bad:?} was accepted");
        assert!(serde_json::from_value::<TeammateInstallId>(json!(bad)).is_err());
    }
    assert!(TeammateInstallId::new("Ab-09").is_ok());
}

#[test]
fn a_host_report_says_which_engine_or_why_not() {
    let ready = ToServerMessage::TeammateHost {
        report: TeammateHostReport {
            engine: Some(ContainerEngine {
                kind: ContainerEngineKind::Podman,
                version: "5.2.0".to_owned(),
                rootless: true,
            }),
            engines: Vec::new(),
            os: HostOs::Linux,
            arch: HostArch::Amd64,
            cpus: 8,
            memory_mib: 16_384,
            disk_free_mib: Some(100_000),
            problem: None,
            installs: vec![TeammateInstall {
                install_id: TeammateInstallId::new("i-1").unwrap(),
                generation: 3,
                delivery: 0,
            }],
        },
    };
    assert_eq!(
        serde_json::to_value(&ready).unwrap(),
        json!({
            "type": "teammateHost",
            "report": {
                "engine": { "kind": "podman", "version": "5.2.0", "rootless": true },
                "engines": [],
                "os": "linux",
                "arch": "amd64",
                "cpus": 8,
                "memoryMib": 16384,
                "diskFreeMib": 100000,
                "problem": null,
                "installs": [{ "installId": "i-1", "generation": 3, "delivery": 0 }],
            },
        })
    );

    let short = TeammateHostProblem::BelowFloor {
        resource: HostResource::Memory,
    };
    assert_eq!(
        serde_json::to_value(&short).unwrap(),
        json!({ "kind": "belowFloor", "resource": "memory" })
    );
}

#[test]
fn a_teammate_status_reports_a_failure_with_its_reason() {
    let status = ToServerMessage::TeammateStatus {
        install: TeammateInstall {
            install_id: TeammateInstallId::new("i-1").unwrap(),
            generation: 2,
            delivery: 0,
        },
        state: TeammateRunState::Failed {
            reason: TeammateRunFailure::ImageMismatch,
        },
    };
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        json!({
            "type": "teammateStatus",
            "install": { "installId": "i-1", "generation": 2, "delivery": 0 },
            "state": { "state": "failed", "reason": "imageMismatch" },
        })
    );
}

#[test]
fn an_install_from_an_older_runtime_reads_as_its_first_delivery() {
    let install: TeammateInstall =
        serde_json::from_value(json!({ "installId": "i-1", "generation": 2 })).unwrap();
    assert_eq!(install.delivery, 0);
}

#[test]
fn a_rollback_names_why_the_new_image_was_abandoned() {
    let status = ToServerMessage::TeammateStatus {
        install: TeammateInstall {
            install_id: TeammateInstallId::new("i-1").unwrap(),
            generation: 3,
            delivery: 1,
        },
        state: TeammateRunState::RolledBack {
            reason: TeammateRunFailure::IncompatibleRuntime,
        },
    };
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        json!({
            "type": "teammateStatus",
            "install": { "installId": "i-1", "generation": 3, "delivery": 1 },
            "state": { "state": "rolledBack", "reason": "incompatibleRuntime" },
        })
    );
}

#[test]
fn an_agent_environment_carries_the_setup_trace_and_reads_without_it() {
    let traceparent = "00-11111111111111111111111111111111-2222222222222222-01";
    let message = ToRuntimeMessage::ApplyAgent {
        environment: AgentEnvironment(Default::default()),
        traceparent: Some(traceparent.to_owned()),
    };
    assert_eq!(
        serde_json::to_value(&message).unwrap(),
        json!({ "type": "applyAgent", "environment": {}, "traceparent": traceparent })
    );

    let read: ToRuntimeMessage =
        serde_json::from_value(json!({ "type": "applyAgent", "environment": {} })).unwrap();
    let ToRuntimeMessage::ApplyAgent { traceparent, .. } = read else {
        panic!("not an agent environment");
    };
    assert_eq!(traceparent, None);
}

#[test]
fn network_isolation_that_cant_be_enforced_is_a_host_problem_and_a_failure() {
    assert_eq!(
        serde_json::to_value(TeammateHostProblem::NetworkIsolationUnavailable).unwrap(),
        json!({ "kind": "networkIsolationUnavailable" })
    );
    let status = ToServerMessage::TeammateStatus {
        install: TeammateInstall {
            install_id: TeammateInstallId::new("i-1").unwrap(),
            generation: 1,
            delivery: 1,
        },
        state: TeammateRunState::Failed {
            reason: TeammateRunFailure::NetworkIsolationUnavailable,
        },
    };
    assert_eq!(
        serde_json::to_value(&status).unwrap()["state"],
        json!({ "state": "failed", "reason": "networkIsolationUnavailable" })
    );
}

#[test]
fn a_host_with_no_route_to_the_internet_is_an_egress_failure() {
    assert_eq!(
        serde_json::to_value(TeammateRunState::Failed {
            reason: TeammateRunFailure::EgressBlocked,
        })
        .unwrap(),
        json!({ "state": "failed", "reason": "egressBlocked" })
    );
}

#[test]
fn a_host_report_lists_each_installed_engine_and_whether_it_enforces_isolation() {
    let report = TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: ContainerEngineKind::Podman,
            version: "5.2.0".to_owned(),
            rootless: true,
        }),
        engines: vec![
            InstalledEngine {
                kind: ContainerEngineKind::Docker,
                version: Some("29.5.1".to_owned()),
                rootless: false,
                isolation: EngineIsolation::Unavailable {
                    reason: IsolationProblem::GuardRefused,
                },
            },
            InstalledEngine {
                kind: ContainerEngineKind::Podman,
                version: Some("5.2.0".to_owned()),
                rootless: true,
                isolation: EngineIsolation::Enforced,
            },
        ],
        os: HostOs::Linux,
        arch: HostArch::Amd64,
        cpus: 8,
        memory_mib: 16_384,
        disk_free_mib: Some(100_000),
        problem: None,
        installs: Vec::new(),
    };
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(
        json["engines"],
        json!([
            {
                "kind": "docker",
                "version": "29.5.1",
                "rootless": false,
                "isolation": { "state": "unavailable", "reason": "guardRefused" },
            },
            {
                "kind": "podman",
                "version": "5.2.0",
                "rootless": true,
                "isolation": { "state": "enforced" },
            },
        ])
    );
    // A report from a runtime that lists no engines reads as an empty list.
    let mut older = json;
    older.as_object_mut().unwrap().remove("engines");
    let read: TeammateHostReport = serde_json::from_value(older).unwrap();
    assert!(read.engines.is_empty());
}
