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

/// Every instance runs OpenSearch under a tag keyed by its Dockerfile, so a
/// changed image is built rather than an old one reused under a fixed tag.
#[test]
fn every_instance_runs_the_content_tagged_opensearch_image() {
    let image = opensearch_image().unwrap();
    let tag = image.strip_prefix("macro-local-opensearch:").unwrap();
    assert_eq!(tag.len(), 12);
    assert!(tag.bytes().all(|b| b.is_ascii_hexdigit()));
    for name in [None, Some("opensearch-tag-test")] {
        let instance = Instance::derive(name, None).unwrap();
        let mut services = IndexMap::new();
        add_local_infra(&mut services, &instance, false).unwrap();
        let search = services["search"].as_ref().unwrap();
        assert_eq!(search.image.as_deref(), Some(image.as_str()));
    }
}
