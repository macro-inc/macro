use super::*;
use crate::local::local_env::{LocalEnv, Tunnels};

fn local_env(instance: &Instance) -> BTreeMap<String, String> {
    LocalEnv::for_instance(Mode::Local, instance, true, Tunnels::default())
        .unwrap()
        .to_env()
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
    assert_eq!(env["COMPUTERS_AGENT_IMAGE"], "macro-box-agent:latest");
    assert_eq!(env["COMPUTERS_DOCKER_MEMORY_GB"], "32");
    assert_eq!(env["COMPUTERS_DOCKER_NETWORK"], "macro-computers_services");
    assert_eq!(env["COMPUTERS_DOCKER_ENROLLMENT_DIR"], enrollment_dir);
    let overrides: BTreeMap<String, String> = env
        .iter()
        .filter(|(name, _)| {
            MACROD_SERVICES
                .iter()
                .any(|needed| name.as_str() == *needed)
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
            (
                "OVERRIDE_AGENT_GIT_SERVICE_URL".to_string(),
                "http://agent-harness-service:8080/agent-git".to_string(),
            ),
        ])
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
    assert_eq!(ComputersArgs::default().fleet(), Fleet::Off);
    assert_eq!(
        ComputersArgs {
            computers: Some(Fleet::Docker),
            ..Default::default()
        }
        .fleet(),
        Fleet::Docker
    );
    assert_eq!(
        ComputersArgs {
            no_computers: true,
            ..Default::default()
        }
        .fleet(),
        Fleet::Off
    );
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
