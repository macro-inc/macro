use super::*;

#[test]
fn passwords_vault_persists_in_isolated_local_storage_without_dev_credentials() {
    for name in [None, Some("passwords-isolation")] {
        let instance = Instance::derive(name, None).unwrap();
        let mut services = IndexMap::new();
        add_local_infra(&mut services, &instance, false).unwrap();
        let compose = dct::Compose {
            services: dct::Services(services),
            ..Default::default()
        };
        let mut value = serde_yaml::to_value(compose).unwrap();
        set_networks_and_volumes(&mut value, Mode::Local, &instance);
        let vault = &value["services"]["openbao"];
        assert_eq!(
            vault["ports"][0],
            format!("127.0.0.1:{}:8200", instance.port(Port::OpenBao))
        );
        assert_eq!(vault["networks"]["services"]["aliases"][0], "openbao");
        assert!(vault["volumes"][0].as_str().unwrap().ends_with(":ro,z"));
        assert_eq!(
            vault["entrypoint"],
            serde_yaml::to_value([
                "/usr/bin/dumb-init",
                "--",
                "/bin/sh",
                "/openbao/config/start.sh",
            ])
            .unwrap()
        );
        assert_eq!(vault["command"], Value::Sequence(vec![]));
        assert_eq!(vault["volumes"][2], "openbao_data:/openbao/file");
        assert_eq!(vault["restart"], "unless-stopped");
        assert_eq!(
            vault["environment"],
            serde_yaml::to_value(serde_json::json!({"BAO_ADDR": "http://127.0.0.1:8200"})).unwrap()
        );
        assert_eq!(
            value["volumes"]["openbao_data"]["name"],
            format!("{}_openbao_data", instance.project_name())
        );
        assert!(value["volumes"]["openbao_data"]["external"].is_null());
    }
}

#[test]
fn remote_dev_mode_does_not_define_local_vault_storage() {
    for name in [None, Some("passwords-isolation")] {
        let instance = Instance::derive(name, None).unwrap();
        let mut value = serde_yaml::to_value(dct::Compose::default()).unwrap();
        set_networks_and_volumes(&mut value, Mode::Dev, &instance);
        assert!(value["volumes"]["openbao_data"].is_null());
    }
}

#[test]
fn generated_services_have_bounded_console_logs_in_every_mode() {
    for mode in [Mode::Local, Mode::Dev] {
        for name in [None, Some("logging-test")] {
            let instance = Instance::derive(name, None).unwrap();
            let mut services = IndexMap::new();
            for svc in services_for_mode(mode) {
                services.insert(svc.compose_name.to_string(), Some(dct::Service::default()));
            }
            add_localstack_service(&mut services, &instance);
            add_proxy_service(&mut services, &instance, false, false);
            let compose = dct::Compose {
                services: dct::Services(services),
                ..Default::default()
            };
            let mut value = serde_yaml::to_value(compose).unwrap();
            apply_tags(&mut value, mode, &instance);

            for service in value["services"].as_mapping().unwrap().values() {
                assert_eq!(service["logging"]["driver"], "json-file");
                assert_eq!(service["logging"]["options"]["max-size"], "20m");
                assert_eq!(service["logging"]["options"]["max-file"], "3");
            }
        }
    }
}

#[test]
fn fusionauth_kickstart_is_privately_relabelled_and_replaces_inherited_mounts() {
    for name in [None, Some("selinux-test")] {
        let instance = Instance::derive(name, None).unwrap();
        let mut services = IndexMap::new();
        add_local_infra(&mut services, &instance, false).unwrap();
        let compose = dct::Compose {
            services: dct::Services(services),
            ..Default::default()
        };
        let mut value = serde_yaml::to_value(compose).unwrap();
        apply_tags(&mut value, Mode::Local, &instance);

        let Value::Tagged(volumes) = &value["services"]["fusionauth"]["volumes"] else {
            panic!("FusionAuth mounts must replace the inherited mount list");
        };
        assert_eq!(volumes.tag, Tag::new("!override"));
        assert_eq!(
            volumes.value,
            serde_yaml::to_value(vec![
                "fusionauth_config:/usr/local/fusionauth/config".to_string(),
                format!(
                    "{}:/usr/local/fusionauth/kickstart:ro,Z",
                    kickstart_dir(&instance).display()
                ),
            ])
            .unwrap()
        );
    }
}

#[test]
fn every_local_harness_publishes_the_api_port_used_by_the_sdk() {
    for name in [None, Some("harness-ports")] {
        let instance = Instance::derive(name, None).unwrap();
        let service = services_for_mode(Mode::Local)
            .find(|service| service.compose_name == EGRESS_SERVICE)
            .unwrap();
        let ports = published_ports(Mode::Local, &instance, service);
        assert!(ports.contains(&format!("{}:8080", instance.port(Port::AgentHarness))));
        assert!(ports.contains(&format!(
            "{}:{EGRESS_CONTAINER_PORT}",
            instance.port(Port::AgentHarnessEgress)
        )));
        assert!(ports.contains(&format!("{}:2222", instance.port(Port::PreviewSsh))));
    }
}

#[test]
fn docker_computers_share_the_enrollment_dir_with_the_daemon() {
    let instance = Instance::derive(Some("computers-compose-docker"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Docker, &instance);
    let mut services = IndexMap::new();
    services.insert(EGRESS_SERVICE.to_string(), Some(dct::Service::default()));
    add_computers(&mut services, &computers).unwrap();

    let dir = computers.enrollment_dir().display().to_string();
    let harness = services[EGRESS_SERVICE].as_ref().unwrap();
    assert_eq!(
        harness.volumes,
        vec![dct::Volumes::Simple(format!("{dir}:{dir}"))]
    );
    assert_eq!(services.len(), 1);
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
}

#[test]
fn incus_computers_need_no_relay_sidecars() {
    let instance = Instance::derive(Some("computers-compose-incus"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Incus, &instance);
    let mut services = IndexMap::new();
    services.insert(EGRESS_SERVICE.to_string(), Some(dct::Service::default()));
    add_computers(&mut services, &computers).unwrap();

    assert_eq!(services.len(), 1);
    assert!(!services.contains_key("computers_incus_uplink"));
    assert!(!services.contains_key("computers_incus_relay"));
    assert!(
        services[EGRESS_SERVICE]
            .as_ref()
            .unwrap()
            .volumes
            .is_empty()
    );
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
}

#[test]
fn no_fleet_leaves_the_harness_without_computer_settings() {
    let instance = Instance::derive(Some("computers-off"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Off, &instance);
    let mut services = IndexMap::from([(
        EGRESS_SERVICE.to_owned(),
        Some(dct::Service {
            environment: kv(&[
                ("PORT", "8080"),
                ("COMPUTERS_FLEET", "docker"),
                ("COMPUTERS_IMAGE", "macro-box:latest"),
            ]),
            ..Default::default()
        }),
    )]);
    add_computers(&mut services, &computers).unwrap();
    let value = serde_yaml::to_value(&services).unwrap();
    let environment = value[EGRESS_SERVICE]["environment"].as_mapping().unwrap();
    assert_eq!(environment.len(), 1);
    assert_eq!(value[EGRESS_SERVICE]["environment"]["PORT"], "8080");
}

/// External is what lets an existing instance keep its networks: a Compose-managed
/// network whose config changed would be recreated, stopping what's attached.
#[test]
fn named_instances_use_their_own_external_project_networks() {
    let instance = Instance::derive(Some("agent-a"), None).unwrap();
    let mut value = Value::Mapping(serde_yaml::Mapping::new());

    set_external_project_networks(&mut value, &instance);

    let services = &value["networks"]["services"];
    assert_eq!(services["external"], Value::from(true));
    assert_eq!(services["name"], Value::from("macro-agent-a_services"));
    let auth_internal = &value["networks"]["auth-internal"];
    assert_eq!(auth_internal["external"], Value::from(true));
    assert_eq!(
        auth_internal["name"],
        Value::from("macro-agent-a_auth-internal")
    );
}

/// Compose builds only a missing tag, so a Dockerfile edit has to change the tag.
#[test]
fn relay_image_tag_follows_its_dockerfile() {
    let tag = sdk_webhook_relay_image(b"FROM alpine\nRUN a\n");
    assert_ne!(tag, sdk_webhook_relay_image(b"FROM alpine\nRUN b\n"));
    assert_eq!(tag, sdk_webhook_relay_image(b"FROM alpine\nRUN a\n"));
    assert!(tag.starts_with("macro-sdk-webhook-relay:"));
}

/// Every instance runs the repository-built images under tags keyed by their
/// inputs, so a changed image is built rather than an old one reused, and an
/// unchanged one is shared rather than rebuilt per instance.
#[test]
fn every_instance_runs_the_content_tagged_images() {
    for image in content_tagged_images() {
        let tag = image.tag().unwrap();
        let key = tag.strip_prefix(&format!("{}:", image.repository)).unwrap();
        assert_eq!(key.len(), 12);
        assert!(key.bytes().all(|b| b.is_ascii_hexdigit()));
        for name in [None, Some("content-tag-test")] {
            let instance = Instance::derive(name, None).unwrap();
            let mut services = IndexMap::new();
            add_local_infra(&mut services, &instance, false).unwrap();
            let service = services[image.service].as_ref().unwrap();
            assert_eq!(
                service.image.as_deref(),
                Some(tag.as_str()),
                "{}",
                image.service
            );
        }
    }
}

/// The sync worker's tag follows its Rust closure, not unrelated files.
#[test]
fn sync_service_inputs_cover_its_closure_only() {
    let inputs = sync_service_inputs().unwrap();
    assert!(inputs.iter().any(|path| path == "Cargo.lock"));
    assert!(inputs.iter().any(|path| path == "services/sync-service"));
    assert!(
        !inputs
            .iter()
            .any(|path| path.starts_with("docs") || path.starts_with("apps"))
    );
}

#[test]
fn compose_worker_telemetry_uses_generated_policy_over_inherited_shell() {
    const KEY: &str = "SYNC_SERVICE_OTEL_EXPORTER_OTLP_ENDPOINT";
    const CASE: &str = "XTASK_TEST_SYNC_OTEL_COMPOSE_CASE";
    let Some(case) = std::env::var_os(CASE) else {
        // Set the ambient environment on a child process, never the test runner.
        for case in ["off", "on"] {
            let status = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "local::gen_compose::test::compose_worker_telemetry_uses_generated_policy_over_inherited_shell",
                ])
                .env(KEY, "http://inherited.invalid:4318")
                .env(CASE, case)
                .status()
                .unwrap();
            assert!(status.success());
        }
        return;
    };
    assert_eq!(
        std::env::var_os(KEY).as_deref(),
        Some(std::ffi::OsStr::new("http://inherited.invalid:4318"))
    );
    let expected = match case.to_str().unwrap() {
        "off" => "",
        "on" => "http://otel-collector:4318",
        _ => panic!("unknown isolated Compose control"),
    };
    let dir = std::env::temp_dir().join(format!("xtask-sync-otel-{}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let env_file = dir.join("generated.env");
    std::fs::write(&env_file, format!("{KEY}={expected}\n")).unwrap();
    let fixture = dir.join("compose.yml");
    // Config-only interpolation control: no service is started, pulled or built.
    std::fs::write(
        &fixture,
        "services:\n  probe:\n    image: busybox\n    environment:\n      OTEL_EXPORTER_OTLP_ENDPOINT: '${SYNC_SERVICE_OTEL_EXPORTER_OTLP_ENDPOINT:-}'\n",
    )
    .unwrap();
    let instance = Instance::derive(Some("sync-otel-config-test"), None).unwrap();
    let mut cmd = docker_compose(&instance, &[fixture], &env_file);
    assert!(
        cmd.get_envs()
            .any(|(key, value)| key == KEY && value.is_none())
    );
    let output = cmd.args(["config", "--format", "json"]).output().unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let config: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        config["services"]["probe"]["environment"]["OTEL_EXPORTER_OTLP_ENDPOINT"],
        expected
    );
}
