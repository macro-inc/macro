use super::*;
use crate::local::local_env::{LocalEnv, Tunnels};

fn local_env(instance: &Instance) -> BTreeMap<String, String> {
    LocalEnv::for_instance(Mode::Local, instance, true, Tunnels::default())
        .unwrap()
        .to_env()
}

fn credentials() -> IncusCredentials {
    IncusCredentials {
        client_cert: "client cert".into(),
        client_key: "client key".into(),
        server_cert: "server cert".into(),
    }
}

#[test]
fn docker_computers_dial_the_stack_in_network() {
    let instance = Instance::derive(Some("computers"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Docker, &instance);
    let mut env = local_env(&instance);
    computers.write_env(&mut env).unwrap();

    let enrollment_dir = repo_root()
        .join("infra/local/generated/computers/computers/enrollments")
        .display()
        .to_string();
    assert_eq!(env["COMPUTERS_FLEET"], "docker");
    assert_eq!(env["COMPUTERS_CONTROL_PLANE_ID"], "local-computers");
    assert_eq!(env["COMPUTERS_HOST_NAME"], "local-docker");
    assert_eq!(env["COMPUTERS_IMAGE"], "macro-box:latest");
    assert_eq!(env["COMPUTERS_HOST_RESERVE_GB"], "7");
    assert_eq!(env["COMPUTERS_OVERSELL_FACTOR"], "3");
    assert_eq!(env["COMPUTERS_DOCKER_MEMORY_GB"], "32");
    assert_eq!(env["COMPUTERS_DOCKER_NETWORK"], "macro-computers_services");
    assert_eq!(env["COMPUTERS_DOCKER_ENROLLMENT_DIR"], enrollment_dir);
    let overrides: BTreeMap<String, String> = env
        .iter()
        .filter(|(name, _)| {
            MACROD_SERVICES
                .iter()
                .any(|(needed, _)| name.as_str() == *needed)
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    assert_eq!(
        overrides,
        BTreeMap::from([
            (
                "OVERRIDE_CONNECTION_GATEWAY_URL".into(),
                "http://connection-gateway:8080".into()
            ),
            (
                "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL".into(),
                "http://agent-harness-service:8080/cognition".into()
            ),
            (
                "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL".into(),
                "http://agent-harness-service:8080/scheduled-action".into()
            ),
            (
                "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL".into(),
                "ws://connection-gateway:8080".into()
            ),
            (
                "OVERRIDE_MCP_SERVICE_URL".into(),
                "http://agent-harness-service:8080".into()
            ),
            (
                "OVERRIDE_API_GATEWAY_URL".to_string(),
                format!("http://proxy:{}", instance.port(Port::ComputerGateway))
            ),
            (
                "OVERRIDE_AGENT_HARNESS_EGRESS_URL".to_string(),
                "http://agent-harness-service:8102".to_string()
            ),
            (
                "OVERRIDE_AGENT_GIT_SERVICE_URL".to_string(),
                "http://agent-git-service:8080".to_string()
            ),
            (
                "OVERRIDE_AGENT_HARNESS_SERVICE_URL".to_string(),
                "http://agent-harness-service:8080".to_string(),
            ),
            (
                "OVERRIDE_APP_SERVICE_URL".to_string(),
                env["OVERRIDE_APP_SERVICE_URL"].clone(),
            ),
            (
                "OVERRIDE_AUTH_SERVICE_URL".to_string(),
                "http://authentication-service:8080".to_string(),
            ),
            (
                "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL".to_string(),
                "http://document-storage-service:8080".to_string(),
            ),
        ])
    );
}

#[test]
fn incus_control_and_all_persona_urls_use_the_tailnet() {
    let instance = Instance::derive(Some("computers"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Incus, &instance);
    let base = local_env(&instance);
    let env = computers
        .incus_env(
            &base,
            &credentials(),
            &IncusNetwork::parse("100.101.102.103", "100.116.73.13").unwrap(),
        )
        .unwrap();

    assert_eq!(env["COMPUTERS_FLEET"], "incus");
    assert_eq!(env["COMPUTERS_CONTROL_PLANE_ID"], "local-computers");
    assert_eq!(env["COMPUTERS_HOST_NAME"], "runtime-dev-1");
    assert_eq!(env["COMPUTERS_IMAGE"], "macro-box");
    assert_eq!(env["COMPUTERS_HOST_RESERVE_GB"], "7");
    assert_eq!(env["COMPUTERS_OVERSELL_FACTOR"], "3");
    assert_eq!(env["COMPUTERS_INCUS_PROFILE"], "macro-box");
    assert_eq!(env["COMPUTERS_INCUS_STORAGE_POOL"], "default");
    assert_eq!(env["COMPUTERS_INCUS_REQUEST_TIMEOUT_SECS"], "90");
    assert_eq!(env["COMPUTERS_INCUS_CONNECT_TIMEOUT_SECS"], "10");
    assert_eq!(env["COMPUTERS_INCUS_OPERATION_WAIT_SECS"], "60");
    assert_eq!(env["COMPUTERS_INCUS_OPERATION_WAITS"], "15");
    assert_eq!(env["COMPUTERS_INCUS_STATE_CHANGE_TIMEOUT_SECS"], "60");
    assert_eq!(env["COMPUTERS_INCUS_SHUTDOWN_GRACE_SECS"], "60");
    assert_eq!(env["COMPUTERS_INCUS_URL"], "https://100.101.102.103:8443");
    assert_eq!(env["COMPUTERS_INCUS_CLIENT_CERT"], "client cert");
    assert_eq!(env["COMPUTERS_INCUS_CLIENT_KEY"], "client key");
    assert_eq!(env["COMPUTERS_INCUS_SERVER_CERT"], "server cert");
    let overrides: BTreeMap<String, String> = env
        .iter()
        .filter(|(name, _)| {
            MACROD_SERVICES
                .iter()
                .any(|(needed, _)| name.as_str() == *needed)
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    let devbox = |port: Port| format!("http://100.116.73.13:{}", instance.port(port));
    assert_eq!(
        overrides["OVERRIDE_API_GATEWAY_URL"],
        devbox(Port::ComputerGateway)
    );
    assert_eq!(
        overrides["OVERRIDE_AGENT_HARNESS_EGRESS_URL"],
        devbox(Port::AgentHarnessEgress)
    );
    assert_eq!(
        overrides["OVERRIDE_AGENT_GIT_SERVICE_URL"],
        devbox(Port::AgentGit)
    );
    assert_eq!(
        overrides["OVERRIDE_AGENT_HARNESS_SERVICE_URL"],
        devbox(Port::AgentHarness)
    );
    assert_eq!(
        overrides["OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL"],
        devbox(Port::DocStorage)
    );
    assert_eq!(overrides["OVERRIDE_AUTH_SERVICE_URL"], devbox(Port::Auth));
    assert_eq!(
        overrides["OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL"],
        format!("{}/cognition", devbox(Port::AgentHarness))
    );
    assert_eq!(
        overrides["OVERRIDE_SCHEDULED_ACTION_SERVICE_URL"],
        format!("{}/scheduled-action", devbox(Port::AgentHarness))
    );
    assert_eq!(
        overrides["OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL"],
        format!("ws://100.116.73.13:{}", instance.port(Port::ConnGateway))
    );
    assert_eq!(
        overrides["OVERRIDE_MCP_SERVICE_URL"],
        devbox(Port::AgentHarness)
    );
    assert_eq!(
        overrides["OVERRIDE_APP_SERVICE_URL"],
        base["OVERRIDE_APP_SERVICE_URL"]
    );
    assert_eq!(
        computers.service_ports(),
        vec![
            instance.port(Port::ComputerGateway),
            instance.port(Port::AgentHarnessEgress),
            instance.port(Port::AgentGit),
            instance.port(Port::AgentHarness),
            instance.port(Port::DocStorage),
            instance.port(Port::Auth),
            instance.port(Port::ConnGateway),
        ]
    );
}

#[test]
fn off_removes_shared_computer_settings() {
    let instance = Instance::derive(Some("computers-off"), None).unwrap();
    let mut env = local_env(&instance);
    env.insert("COMPUTERS_FLEET".into(), "docker".into());
    env.insert("COMPUTERS_IMAGE".into(), "stale".into());
    Computers::new(Mode::Local, Fleet::Off, &instance)
        .write_env(&mut env)
        .unwrap();
    assert_eq!(env["COMPUTERS_FLEET"], "disabled");
    assert!(
        !env.keys()
            .any(|key| key.starts_with("COMPUTERS_") && key != "COMPUTERS_FLEET")
    );
}

#[test]
fn run_dev_runs_no_computers() {
    let instance = Instance::derive(None, None).unwrap();
    assert_eq!(
        Computers::new(Mode::Dev, Fleet::Docker, &instance).fleet(),
        Fleet::Off
    );
}

#[test]
fn flags_pick_the_fleet() {
    let pick = |args: ComputersArgs| args.fleet(Fleet::Docker);
    assert_eq!(pick(ComputersArgs::default()), Fleet::Docker);
    assert_eq!(
        pick(ComputersArgs {
            no_computers: true,
            ..Default::default()
        }),
        Fleet::Off
    );
    assert_eq!(
        pick(ComputersArgs {
            computers_incus: true,
            ..Default::default()
        }),
        Fleet::Incus
    );
    assert_eq!(
        pick(ComputersArgs {
            computers: Some(Fleet::Off),
            ..Default::default()
        }),
        Fleet::Off
    );
}

#[test]
fn incus_addresses_reject_missing_or_ambiguous_resolution() {
    for address in [
        "",
        "runtime-dev-1",
        "100.101.102.103\n100.101.102.104",
        "::1",
    ] {
        assert!(IncusNetwork::parse(address, "100.116.73.13").is_err());
    }
    for control_plane in [
        "",
        "devbox",
        "100.116.73.13\n100.104.105.106",
        "::1",
        "10.210.0.1",
        "127.0.0.1",
        "100.63.255.255",
        "100.128.0.1",
    ] {
        assert!(IncusNetwork::parse("100.101.102.103", control_plane).is_err());
    }
}

#[test]
fn incus_uses_the_discovered_devbox_address() {
    let instance = Instance::derive(Some("computers-address"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Incus, &instance);
    let network = IncusNetwork::parse("100.101.102.103\n", "100.104.105.106").unwrap();
    let env = computers
        .incus_env(&local_env(&instance), &credentials(), &network)
        .unwrap();
    assert_eq!(env["COMPUTERS_CONTROL_PLANE_ADDRESS"], "100.104.105.106");
    let overrides: BTreeMap<String, String> = env
        .iter()
        .filter(|(name, _)| {
            MACROD_SERVICES
                .iter()
                .any(|(needed, _)| name.as_str() == *needed)
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    assert_eq!(
        overrides["OVERRIDE_AGENT_HARNESS_EGRESS_URL"],
        format!(
            "http://100.104.105.106:{}",
            instance.port(Port::AgentHarnessEgress)
        )
    );
}

#[test]
fn reads_the_server_certificate_out_of_s_client_output() {
    let output = "CONNECTED(00000003)\n---\nServer certificate\n-----BEGIN CERTIFICATE-----\nMIIB\nabc=\n-----END CERTIFICATE-----\nsubject=O=Linux Containers\n-----BEGIN CERTIFICATE-----\nsecond\n-----END CERTIFICATE-----\n";
    assert_eq!(
        first_pem_certificate(output).unwrap(),
        "-----BEGIN CERTIFICATE-----\nMIIB\nabc=\n-----END CERTIFICATE-----\n"
    );
    assert_eq!(first_pem_certificate("no certificate"), None);
}

#[test]
fn fingerprints_compare_as_incus_prints_them() {
    assert_eq!(
        parse_fingerprint(
            "sha256 Fingerprint=76:28:FC:FF:44:F2:33:83:83:65:0C:24:89:F3:8E:89:A5:9D:B5:EB:95:1A:3D:E9:BF:04:69:F5:03:87:D8:4B\n"
        )
        .unwrap(),
        INCUS_SERVER_FINGERPRINT
    );
    assert!(parse_fingerprint("garbage").is_err());
}

#[test]
fn loaded_image_marker_roundtrips() {
    let loaded = LoadedImage {
        store_path: "/nix/store/abc-macro-box-docker.tar.gz".into(),
        image_id: "sha256:123".into(),
    };
    assert_eq!(LoadedImage::parse(&loaded.render()), Some(loaded));
    assert_eq!(LoadedImage::parse(""), None);
}

#[test]
fn incus_overrides_use_only_direct_tailnet_service_urls() {
    for name in [None, Some("computers")] {
        let instance = Instance::derive(name, None).unwrap();
        let base = local_env(&instance);
        let network = IncusNetwork::parse("100.101.102.103", "100.116.73.13").unwrap();
        let env = Computers::new(Mode::Local, Fleet::Incus, &instance)
            .incus_env(&base, &credentials(), &network)
            .unwrap();
        let overrides: BTreeMap<_, _> = env
            .into_iter()
            .filter(|(key, _)| key.starts_with("OVERRIDE_"))
            .collect();
        assert_eq!(overrides.len(), 12);
        assert_eq!(
            overrides["OVERRIDE_APP_SERVICE_URL"],
            base["OVERRIDE_APP_SERVICE_URL"]
        );
        for (key, port, scheme, path) in [
            (
                "OVERRIDE_API_GATEWAY_URL",
                Port::ComputerGateway,
                "http",
                "",
            ),
            ("OVERRIDE_AGENT_GIT_SERVICE_URL", Port::AgentGit, "http", ""),
            (
                "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
                Port::AgentHarness,
                "http",
                "/cognition",
            ),
            (
                "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL",
                Port::AgentHarness,
                "http",
                "/scheduled-action",
            ),
            ("OVERRIDE_MCP_SERVICE_URL", Port::AgentHarness, "http", ""),
            (
                "OVERRIDE_AGENT_HARNESS_EGRESS_URL",
                Port::AgentHarnessEgress,
                "http",
                "",
            ),
            (
                "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
                Port::AgentHarness,
                "http",
                "",
            ),
            (
                "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
                Port::DocStorage,
                "http",
                "",
            ),
            ("OVERRIDE_AUTH_SERVICE_URL", Port::Auth, "http", ""),
            (
                "OVERRIDE_CONNECTION_GATEWAY_URL",
                Port::ConnGateway,
                "http",
                "",
            ),
            (
                "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
                Port::ConnGateway,
                "ws",
                "",
            ),
        ] {
            assert_eq!(
                overrides[key],
                format!("{scheme}://100.116.73.13:{}{path}", instance.port(port)),
                "{key}"
            );
        }
    }
}

#[test]
fn incus_guest_ports_are_allowed_by_nix() {
    let output = match Command::new("nix")
        .args([
            "eval",
            "--json",
            ".#nixosConfigurations.runtime-dev-1.config.macro.computers.controlPlanePorts",
        ])
        .current_dir(repo_root())
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("SKIP incus_guest_ports_are_allowed_by_nix: nix is unavailable");
            return;
        }
        Err(error) => panic!("could not run nix eval: {error}"),
    };
    assert!(
        output.status.success(),
        "nix eval failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let allowed: Vec<u16> = serde_json::from_slice(&output.stdout).unwrap();
    let network = IncusNetwork::parse("100.101.102.103", "100.116.73.13").unwrap();
    let instances = std::iter::once(Instance::derive(None, None).unwrap())
        .chain((0..120).map(|bucket| {
            Instance::derive(Some("computers"), Some(20000 + bucket * 100)).unwrap()
        }));
    for instance in instances {
        let env = Computers::new(Mode::Local, Fleet::Incus, &instance)
            .incus_env(&local_env(&instance), &credentials(), &network)
            .unwrap();
        let mut emitted_ports = std::collections::BTreeSet::new();
        for (key, value) in env {
            if !key.starts_with("OVERRIDE_") || key == "OVERRIDE_APP_SERVICE_URL" {
                continue;
            }
            let (_, address) = value.split_once("://").unwrap();
            let authority = address.split('/').next().unwrap();
            let (host, port) = authority.rsplit_once(':').unwrap();
            assert_eq!(host, "100.116.73.13");
            let port: u16 = port.parse().unwrap();
            emitted_ports.insert(port);
            assert!(
                allowed.contains(&port),
                "{key}={value} is missing from controlPlanePorts"
            );
        }
        let service_ports = Computers::new(Mode::Local, Fleet::Incus, &instance).service_ports();
        let unique_ports: std::collections::BTreeSet<_> = service_ports.iter().copied().collect();
        assert_eq!(unique_ports.len(), service_ports.len());
        assert_eq!(emitted_ports, unique_ports);
    }
}
