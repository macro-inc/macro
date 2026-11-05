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
    assert_eq!(env["COMPUTERS_HOST_NAME"], "local-docker");
    assert_eq!(env["COMPUTERS_IMAGE"], "macro-box:latest");
    assert_eq!(env["COMPUTERS_DOCKER_NETWORK"], "macro-computers_services");
    assert_eq!(env["COMPUTERS_DOCKER_ENROLLMENT_DIR"], enrollment_dir);
    let overrides: BTreeMap<String, String> =
        serde_json::from_str(&env["COMPUTERS_SERVICE_URL_OVERRIDES"]).unwrap();
    assert_eq!(
        overrides,
        BTreeMap::from([
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
fn incus_computers_dial_the_stack_through_the_box_bridge() {
    let instance = Instance::derive(Some("computers"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Incus, &instance);
    let base = local_env(&instance);
    let env = computers.incus_env(&base, &credentials()).unwrap();

    assert_eq!(env["COMPUTERS_FLEET"], "incus");
    assert_eq!(env["COMPUTERS_HOST_NAME"], "runtime-dev-1");
    assert_eq!(env["COMPUTERS_IMAGE"], "macro-box");
    assert_eq!(env["COMPUTERS_INCUS_URL"], "https://computers-incus:8443");
    assert_eq!(env["COMPUTERS_INCUS_CLIENT_CERT"], "client cert");
    assert_eq!(env["COMPUTERS_INCUS_CLIENT_KEY"], "client key");
    assert_eq!(env["COMPUTERS_INCUS_SERVER_CERT"], "server cert");
    let overrides: BTreeMap<String, String> =
        serde_json::from_str(&env["COMPUTERS_SERVICE_URL_OVERRIDES"]).unwrap();
    let bridge = |port: Port| format!("http://10.210.0.1:{}", instance.port(port));
    assert_eq!(
        overrides["OVERRIDE_AGENT_HARNESS_SERVICE_URL"],
        bridge(Port::AgentHarness)
    );
    assert_eq!(
        overrides["OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL"],
        bridge(Port::DocStorage)
    );
    assert_eq!(overrides["OVERRIDE_AUTH_SERVICE_URL"], bridge(Port::Auth));
    assert_eq!(
        overrides["OVERRIDE_APP_SERVICE_URL"],
        base["OVERRIDE_APP_SERVICE_URL"]
    );
    assert_eq!(
        computers.tunnel_ports(),
        vec![
            instance.port(Port::AgentHarness),
            instance.port(Port::DocStorage),
            instance.port(Port::Auth),
        ]
    );
}

#[test]
fn off_removes_every_computers_key() {
    let instance = Instance::derive(Some("computers-off"), None).unwrap();
    let mut env = local_env(&instance);
    env.insert("COMPUTERS_FLEET".into(), "docker".into());
    env.insert("COMPUTERS_IMAGE".into(), "stale".into());
    Computers::new(Mode::Local, Fleet::Off, &instance)
        .write_env(&mut env)
        .unwrap();
    assert!(!env.keys().any(|key| key.starts_with("COMPUTERS_")));
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
fn tunnel_command_reuses_a_running_incus_tunnel() {
    assert_eq!(
        tunnel_command(true, &[8101, 8086, 8080]),
        "nix/hosts/computers-tunnels.sh reverse 8101 8086 8080"
    );
    assert_eq!(
        tunnel_command(false, &[8101]),
        "nix/hosts/computers-tunnels.sh all 8101"
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
