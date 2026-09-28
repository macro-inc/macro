use super::*;

#[test]
fn adds_only_gateway_and_preserves_existing_hosts_and_other_settings() {
    let network = json!({
        "type":"limited", "allowed_hosts":["github.com"],
        "allow_mcp_servers":true, "allow_package_managers":false,
        "future_setting":"preserve"
    });
    let patch = gateway_network_patch(&network, "dev-gateway.macro.com")
        .unwrap()
        .unwrap();
    assert_eq!(
        patch,
        json!({"type":"limited", "allowed_hosts":["github.com", "dev-gateway.macro.com"]})
    );
    let mut merged = network.clone();
    merged
        .as_object_mut()
        .unwrap()
        .extend(patch.as_object().unwrap().clone());
    assert_eq!(merged["allow_mcp_servers"], true);
    assert_eq!(merged["allow_package_managers"], false);
    assert_eq!(merged["future_setting"], "preserve");
    assert!(
        gateway_network_patch(&merged, "dev-gateway.macro.com")
            .unwrap()
            .is_none()
    );
}

#[test]
fn unrestricted_network_needs_no_update() {
    assert!(
        gateway_network_patch(&json!({"type":"unrestricted"}), "gateway.macro.com")
            .unwrap()
            .is_none()
    );
}

#[test]
fn never_broadens_disabled_unknown_or_malformed_policies() {
    for network in [
        json!(null),
        json!({"type":"none"}),
        json!({"type":"future"}),
        json!({"type":"limited"}),
        json!({"type":"limited", "allowed_hosts":[1]}),
    ] {
        assert!(matches!(
            gateway_network_patch(&network, "gateway.macro.com"),
            Err(Error::EnvironmentNetwork)
        ));
    }
}

#[test]
fn uses_the_deployments_host_without_adding_other_environments() {
    let patch = gateway_network_patch(
        &json!({"type":"limited", "allowed_hosts":[]}),
        "gateway.macro.com",
    )
    .unwrap()
    .unwrap();
    assert_eq!(patch["allowed_hosts"], json!(["gateway.macro.com"]));
}
