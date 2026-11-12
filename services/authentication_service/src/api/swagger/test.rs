use super::*;

#[test]
fn computer_status_openapi_uses_canonical_setup_progress() {
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
    let variants = schemas["ComputerStatus"]["properties"]["setup"]["oneOf"]
        .as_array()
        .expect("nullable setup progress");
    assert!(
        variants
            .iter()
            .any(|variant| variant["$ref"] == "#/components/schemas/SetupProgress"),
        "ComputerStatus must reference canonical setup progress"
    );
}
