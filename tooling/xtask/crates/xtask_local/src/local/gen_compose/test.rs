use super::*;

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
        add_local_infra(&mut services, &instance, false);
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
fn disabled_control_plane_is_explicit_only_in_the_harness() {
    let instance = Instance::derive(Some("computers-off"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Off, &instance);
    let mut services = IndexMap::from([(
        EGRESS_SERVICE.to_owned(),
        Some(dct::Service {
            environment: kv(&[("PORT", "8080")]),
            ..Default::default()
        }),
    )]);
    add_computers(&mut services, &computers).unwrap();
    let value = serde_yaml::to_value(&services).unwrap();
    assert_eq!(
        value[EGRESS_SERVICE]["environment"]["COMPUTERS_FLEET"],
        "disabled"
    );
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
