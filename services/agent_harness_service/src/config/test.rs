use super::*;

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct Selection {
    computers_fleet: ComputerFleetKind,
}

#[test]
fn computer_fleet_selection_is_required() {
    let error = serde_json::from_str::<Selection>("{}").err().unwrap();
    assert!(error.to_string().contains("COMPUTERS_FLEET"));
    let selection: Selection = serde_json::from_str(r#"{"COMPUTERS_FLEET":"disabled"}"#).unwrap();
    assert!(matches!(
        selection.computers_fleet,
        ComputerFleetKind::Disabled
    ));
    assert!(serde_json::from_str::<Selection>(r#"{"COMPUTERS_FLEET":"off"}"#).is_err());
}

#[test]
fn computer_fleet_settings_require_the_selected_groups() {
    let error = serde_json::from_str::<DockerFleetSettings>("{}")
        .err()
        .unwrap();
    assert!(error.to_string().contains("COMPUTERS_CONTROL_PLANE_ID"));
    let settings = serde_json::json!({
        "COMPUTERS_CONTROL_PLANE_ID": "local-test",
        "COMPUTERS_HOST_NAME": "local-docker",
        "COMPUTERS_IMAGE": "macro-box:latest",
        "COMPUTERS_HOST_RESERVE_GB": 7,
        "COMPUTERS_OVERSELL_FACTOR": 3,
        "COMPUTERS_DOCKER_NETWORK": "test-services",
        "COMPUTERS_DOCKER_ENROLLMENT_DIR": "/tmp/enrollments",
        "COMPUTERS_DOCKER_MEMORY_GB": 32
    });
    let config: DockerFleetSettings = serde_json::from_value(settings.clone()).unwrap();
    config.validate().unwrap();
    let mut missing = settings.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("COMPUTERS_DOCKER_MEMORY_GB");
    let error = serde_json::from_value::<DockerFleetSettings>(missing)
        .err()
        .unwrap();
    assert!(error.to_string().contains("COMPUTERS_DOCKER_MEMORY_GB"));
    let mut blank = settings;
    blank["COMPUTERS_IMAGE"] = serde_json::json!("");
    assert!(
        serde_json::from_value::<DockerFleetSettings>(blank)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string()
            .contains("COMPUTERS_IMAGE")
    );
}
