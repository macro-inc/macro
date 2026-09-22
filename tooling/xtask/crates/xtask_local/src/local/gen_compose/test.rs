use super::*;
use crate::local::local_env::LocalEnv;

#[test]
fn voice_runtime_address_reaches_the_generated_harness_listener() {
    let base: Value = serde_yaml::from_str(
        &std::fs::read_to_string(repo_root().join("docker/docker-compose.yml")).unwrap(),
    )
    .unwrap();
    let binaries = BinariesDir::TargetDir(PathBuf::from("/test/binaries"));

    for name in [None, Some("voice-runtime-test")] {
        let instance = Instance::derive(name, None).unwrap();
        let environment = LocalEnv::for_instance(Mode::Local, &instance, true, None).to_env();
        let services = rust_service_overrides(Mode::Local, &instance, &binaries);
        let harness = serde_yaml::to_value(&services["agent_harness_service"]).unwrap();
        let authority = environment["OVERRIDE_AGENT_HARNESS_SERVICE_URL"]
            .strip_prefix("http://")
            .unwrap();
        let (host, port) = authority.rsplit_once(':').unwrap();

        assert_eq!(Some(port), harness["environment"]["PORT"].as_str());
        let network = &base["services"]["agent_harness_service"]["networks"]["services"];
        assert!(
            network["aliases"]
                .as_sequence()
                .unwrap()
                .iter()
                .any(|alias| alias.as_str() == Some(host)),
            "the runtime hostname must resolve on the worker's Compose network"
        );
        assert!(
            base["services"]["agent_voice"]["networks"]
                .as_sequence()
                .unwrap()
                .iter()
                .any(|network| network.as_str() == Some("services"))
        );
    }
}

#[test]
fn dev_mode_keeps_the_hosted_harness_route() {
    let instance = Instance::derive(Some("voice-runtime-dev-test"), None).unwrap();
    let binaries = BinariesDir::TargetDir(PathBuf::from("/test/binaries"));
    let services = rust_service_overrides(Mode::Dev, &instance, &binaries);
    assert!(!services.contains_key("agent_harness_service"));
    assert!(!Mode::Dev.spec().overlay_local_env);
}
