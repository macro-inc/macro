use super::*;

#[test]
fn local_binaries_are_unique_and_complete() {
    let bins = local_binaries();
    assert_eq!(bins.len(), 19, "{bins:?}");
    assert!(bins.contains(&"gmail_emulator"));
    assert!(bins.contains(&"outlook_emulator"));
    assert!(bins.contains(&"whatsapp_session_service"));
    assert!(bins.contains(&"gitai_service"));
    assert!(bins.contains(&"pubsub_workers"));
    assert!(bins.contains(&"seed_cli"));
    assert!(bins.contains(&"document_upload_finalizer_local_worker"));
    assert!(bins.contains(&"search_processing_service"));
    assert!(!bins.contains(&"service"));
    assert!(bins.contains(&"agent_harness_service"));
    assert!(!bins.contains(&"mcp_service"));
    assert!(!bins.contains(&"document_cognition_service"));
    let mut sorted = bins.clone();
    sorted.dedup();
    assert_eq!(sorted.len(), bins.len(), "binaries must be deduplicated");
}

#[test]
fn nonobvious_crate_mappings() {
    let by_bin = |b: &str| RUST_SERVICES.iter().find(|s| s.cargo_bin == b).unwrap();
    assert_eq!(
        by_bin("document_upload_finalizer_local_worker").package,
        "document_upload_finalizer_handler"
    );
    assert_eq!(by_bin("pubsub_workers").package, "email_service");
}

#[test]
fn workers_are_portless() {
    for name in [
        "document_upload_finalizer",
        "email_pubsub_workers",
        "slack_import_worker",
    ] {
        let svc = RUST_SERVICES
            .iter()
            .find(|s| s.compose_name == name)
            .unwrap();
        assert!(svc.host_port.is_none());
    }
}

#[test]
fn slack_import_worker_is_opt_in() {
    let worker = RUST_SERVICES
        .iter()
        .find(|svc| svc.compose_name == "slack_import_worker")
        .unwrap();
    assert_eq!(worker.package, "slack_import_worker");
    assert_eq!(worker.cargo_bin, "slack_import_worker");
    assert!(worker.path_prefix.is_none());
    assert!(worker.is_opt_in());
    assert!(!local_binaries().contains(&worker.cargo_bin));
    for mode in [Mode::Local, Mode::Dev] {
        assert!(!services_for_mode(mode).any(|svc| svc.compose_name == worker.compose_name));
    }
    let compose: serde_yaml::Value = serde_yaml::from_str(include_str!(
        "../../../../../../../docker/docker-compose.yml"
    ))
    .unwrap();
    let service = &compose["services"][worker.compose_name];
    assert_eq!(service["profiles"][0], "slack-import");
    assert!(service["ports"].is_null());
    assert_eq!(service["stop_grace_period"], "120s");
    assert_eq!(service["build"]["args"]["SERVICE_NAME"], worker.cargo_bin);
}

#[test]
fn agent_harness_has_an_instance_port() {
    let svc = RUST_SERVICES
        .iter()
        .find(|svc| svc.compose_name == "agent_harness_service")
        .unwrap();
    assert_eq!(svc.host_port, Some(Port::AgentHarness));
}

#[test]
fn dev_mode_excludes_workers_and_optin() {
    let dev: Vec<&str> = services_for_mode(Mode::Dev)
        .map(|s| s.compose_name)
        .collect();
    assert!(!dev.contains(&"email_pubsub_workers"));
    assert!(!dev.contains(&"search_processing_service"));
    assert!(!dev.contains(&"scheduled_action_service"));
    assert!(dev.contains(&"authentication-service"));
}

#[test]
fn agent_features_share_the_harness_process() {
    for name in [
        "scheduled_action_service",
        "preview_gateway",
        "document_cognition_service",
        "mcp_service",
    ] {
        assert!(
            RUST_SERVICES
                .iter()
                .all(|service| service.compose_name != name)
        );
    }
}

#[test]
fn services_are_named_by_compose_name_or_binary() {
    let by_bin = services_named(Mode::Local, &["contacts_service".to_owned()]).unwrap();
    assert_eq!(by_bin[0].cargo_bin, "contacts_service");
    let auth = RUST_SERVICES
        .iter()
        .find(|s| s.cargo_bin == "authentication_service")
        .unwrap();
    let both = services_named(
        Mode::Local,
        &[
            auth.compose_name.to_owned(),
            "authentication_service".to_owned(),
        ],
    )
    .unwrap();
    assert_eq!(both.len(), 1, "a service named twice is built once");
}

#[test]
fn an_unknown_service_name_lists_the_known_ones() {
    let err = services_named(Mode::Local, &["contact".to_owned()]).unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("no local service named contact"));
    assert!(msg.contains("contacts_service"));
    assert!(services_named(Mode::Local, &[]).is_err());
}
