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
