use super::*;

#[test]
fn passwords_vault_persists_in_isolated_local_storage_without_dev_credentials() {
    for name in [None, Some("passwords-isolation")] {
        let instance = Instance::derive(name, None).unwrap();
        let mut services = IndexMap::new();
        add_local_infra(&mut services, &instance, false);
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
