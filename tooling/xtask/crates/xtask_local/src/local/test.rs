use super::*;
use std::collections::BTreeSet;

/// Every mode whose spec we assert invariants over.
const MODES: &[Mode] = &[Mode::Local, Mode::Dev];

#[test]
fn full_teardown_removes_vault_storage_without_crossing_instance_boundaries() {
    let default = Instance::derive(None, None).unwrap();
    let named = Instance::derive(Some("passwords-isolation"), None).unwrap();
    let default_volumes: BTreeSet<_> = instance_volumes(&default).collect();
    let named_volumes: BTreeSet<_> = instance_volumes(&named).collect();

    assert_eq!(default_volumes.len(), 7);
    assert_eq!(named_volumes.len(), 7);
    assert!(default_volumes.is_disjoint(&named_volumes));
    assert!(default_volumes.contains("macro_openbao_data"));
    assert!(named_volumes.contains("macro-passwords-isolation_openbao_data"));
    assert!(external_volumes(&named).into_iter().all(|volume| {
        named_volumes.contains(&volume) && volume != "macro-passwords-isolation_openbao_data"
    }));
}

/// Cross-field design rules every [`ModeSpec`] must satisfy. These encode what
/// makes a mode *coherent* — a new mode that trips one of these is a bug, not a
/// new policy — so they're the real guard on the table, not a restatement of it.
#[test]
fn mode_specs_are_coherent() {
    for &mode in MODES {
        let s = mode.spec();
        // You either own the local plumbing (LocalEnv: dummy creds + localstack
        // endpoint) or you point at deployed AWS and strip those — never both.
        assert!(
            !(s.overlay_local_env && s.uses_remote_aws),
            "{}: overlay_local_env and uses_remote_aws are mutually exclusive",
            s.label
        );
        // Migrations only make sense against a database this mode runs itself.
        assert!(
            !s.migrates_db || s.runs_local_infra,
            "{}: migrates_db requires runs_local_infra",
            s.label
        );
    }
}

#[test]
fn durable_bake_covers_every_repository_built_local_image() {
    fn direct_build_services(path: &std::path::Path) -> BTreeSet<String> {
        let raw = std::fs::read_to_string(path).unwrap();
        let compose: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        compose["services"]
            .as_mapping()
            .unwrap()
            .iter()
            .filter(|(_, service)| {
                service
                    .as_mapping()
                    .is_some_and(|service| service.contains_key("build"))
            })
            .map(|(name, _)| name.as_str().unwrap().to_string())
            .collect()
    }

    let mut expected = direct_build_services(&repo_root().join("docker/docker-compose.yml"));
    expected.extend(direct_build_services(
        &repo_root().join("docker/docker-compose-databases.yml"),
    ));
    // The generated override adds this build definition.
    expected.insert("sdk-webhook-relay".to_string());
    // The Rust services use the host-built runtime image; this profile-only
    // helper is intentionally never needed by local stack preparation.
    expected.remove("rust_services_image");
    for service in inventory::RUST_SERVICES {
        expected.remove(service.compose_name);
    }

    let actual: BTreeSet<_> = LOCAL_BUILD_SERVICE_IMAGES
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(actual, expected);
    assert_eq!(
        LOCAL_PULL_SERVICE_IMAGES,
        ["proxy", "mailpit", "static_file_cdn"]
    );
}

#[test]
fn a_running_global_collector_is_reused_not_recreated() {
    assert_eq!(
        collector_action(Some("macro-lgtm-1 macro lgtm"), "lgtm"),
        CollectorAction::Reuse("macro-lgtm-1".to_string())
    );
}

#[test]
fn a_collector_from_another_project_or_backend_is_replaced() {
    // An instance named `lgtm` has the same-looking container name.
    assert_eq!(
        collector_action(Some("macro-lgtm-lgtm-1 macro-lgtm lgtm"), "lgtm"),
        CollectorAction::Replace("macro-lgtm-lgtm-1".to_string())
    );
    assert_eq!(
        collector_action(Some("macro-jaeger-1 macro jaeger"), "lgtm"),
        CollectorAction::Replace("macro-jaeger-1".to_string())
    );
    // Not a compose container at all.
    assert_eq!(
        collector_action(Some("otel  "), "lgtm"),
        CollectorAction::Replace("otel".to_string())
    );
}

#[test]
fn a_free_port_starts_the_collector() {
    assert_eq!(collector_action(None, "lgtm"), CollectorAction::Start);
}

#[test]
fn only_the_container_binding_host_port_4318_holds_the_collector_port() {
    // `publish=4318` also matches an instance mapping container port 4318 to
    // another host port; Docker lists it first when it is newer.
    let ps = "macro-other-otel-1\tmacro-other\totel\t0.0.0.0:14318->4318/tcp, [::]:14318->4318/tcp\n\
              macro-lgtm-1\tmacro\tlgtm\t0.0.0.0:3001->3000/tcp, 0.0.0.0:4317-4318->4317-4318/tcp, [::]:4317-4318->4317-4318/tcp, 4040/tcp\n";
    assert_eq!(
        pick_otlp_port_holder(ps).as_deref(),
        Some("macro-lgtm-1 macro lgtm")
    );

    assert_eq!(
        pick_otlp_port_holder("macro-jaeger-1\tmacro\tjaeger\t127.0.0.1:4318->4318/tcp\n")
            .as_deref(),
        Some("macro-jaeger-1 macro jaeger")
    );
    assert_eq!(
        pick_otlp_port_holder("collector\t\t\t:::4318->4318/tcp\n").as_deref(),
        Some("collector  ")
    );

    // Nothing binds host 4318: remove nothing.
    assert_eq!(
        pick_otlp_port_holder(
            "macro-other-otel-1\tmacro-other\totel\t0.0.0.0:14318->4318/tcp, 4318/tcp\n"
        ),
        None
    );
    assert_eq!(pick_otlp_port_holder(""), None);
}
