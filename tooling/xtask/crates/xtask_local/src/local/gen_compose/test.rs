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
fn incus_computers_relay_the_tunnel_into_compose() {
    let instance = Instance::derive(Some("computers-compose-incus"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Incus, &instance);
    let mut services = IndexMap::new();
    services.insert(EGRESS_SERVICE.to_string(), Some(dct::Service::default()));
    add_computers(&mut services, &computers).unwrap();

    let relay_mount = format!("{}:/relay", computers.incus_relay_dir().display());
    let uplink = services["computers_incus_uplink"].as_ref().unwrap();
    assert_eq!(uplink.network_mode.as_deref(), Some("host"));
    assert_eq!(
        uplink.command,
        Some(dct::Command::Args(vec![
            "UNIX-LISTEN:/relay/incus.sock,fork,unlink-early,mode=600".to_string(),
            "TCP:127.0.0.1:18443".to_string(),
        ]))
    );
    assert_eq!(
        uplink.volumes,
        vec![dct::Volumes::Simple(relay_mount.clone())]
    );
    let relay = services["computers_incus_relay"].as_ref().unwrap();
    assert_eq!(
        relay.command,
        Some(dct::Command::Args(vec![
            "TCP-LISTEN:8443,fork,reuseaddr".to_string(),
            "UNIX-CONNECT:/relay/incus.sock".to_string(),
        ]))
    );
    assert_eq!(relay.volumes, vec![dct::Volumes::Simple(relay_mount)]);
    assert_eq!(
        relay.networks,
        net_aliases(&[("services", &["computers-incus"])])
    );
    assert!(
        services[EGRESS_SERVICE]
            .as_ref()
            .unwrap()
            .volumes
            .is_empty()
    );
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
}
