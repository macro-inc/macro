use std::any::TypeId;

use super::*;

#[test]
fn canonical_setup_types_share_rust_identity() {
    assert_eq!(
        TypeId::of::<team_agents::domain::models::SetupStep>(),
        TypeId::of::<hosted_runtimes::domain::models::SetupStep>(),
    );
    assert_eq!(
        TypeId::of::<team_agents::domain::models::SetupProgress>(),
        TypeId::of::<hosted_runtimes::domain::models::SetupProgress>(),
    );
}

#[test]
fn canonical_setup_openapi_uses_four_steps_and_shared_progress() {
    let openapi = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let schemas = &openapi["components"]["schemas"];
    assert_eq!(
        schemas["SetupStep"]["enum"],
        serde_json::json!(["creating", "booting", "connecting", "ready"]),
    );
    assert_eq!(
        schemas["SetupProgress"]["properties"]["step"]["$ref"],
        "#/components/schemas/SetupStep",
    );
    for schema in ["TeamAgent", "ComputerStatus"] {
        let variants = schemas[schema]["properties"]["setup"]["oneOf"]
            .as_array()
            .expect("nullable setup progress");
        assert!(
            variants
                .iter()
                .any(|variant| { variant["$ref"] == "#/components/schemas/SetupProgress" }),
            "{schema} must reference canonical setup progress"
        );
    }
}
