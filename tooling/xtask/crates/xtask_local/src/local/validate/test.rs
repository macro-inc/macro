use super::*;

#[test]
fn no_fleet_requires_absent_infrastructure_settings() {
    let instance = Instance::derive(Some("fleet-off-validation"), None).unwrap();
    let computers = Computers::new(Mode::Local, Fleet::Off, &instance);
    let services = serde_json::json!({
        "agent_harness_service": {"environment": {"ENVIRONMENT": "local"}}
    });
    assert!(computers_failures(services.as_object().unwrap(), &computers).is_empty());

    for (key, value) in [
        ("COMPUTERS_FLEET", "disabled"),
        ("COMPUTERS_FLEET", "docker"),
        ("COMPUTERS_IMAGE", "stale-image"),
        ("COMPUTERS_HOST_NAME", "stale-host"),
    ] {
        let mut stale = services.clone();
        stale["agent_harness_service"]["environment"][key] = serde_json::json!(value);
        assert!(
            !computers_failures(stale.as_object().unwrap(), &computers).is_empty(),
            "{key}"
        );
    }
}
