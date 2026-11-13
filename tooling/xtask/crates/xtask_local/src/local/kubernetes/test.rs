use super::*;

#[test]
fn rendered_credentials_are_rejected_but_secret_references_are_allowed() {
    for value in [
        json!({"kind":"Secret", "data":{}}),
        json!({"name":"ANTHROPIC_API_KEY", "value":"accidental-literal"}),
        json!({"name":"DATABASE_PASSWORD", "value":"local"}),
        json!({"arbitrary":format!("-----BEGIN {} PRIVATE KEY-----", "OPENSSH")}),
        json!({"annotation":"sk-ant-accidentally-copied"}),
        json!({"name":"DATABASE_URL", "value":"postgresql://user:password@postgres/database"}),
        json!({"arbitrary":"Bearer accidentally-copied"}),
    ] {
        assert!(render::check_value(&value).is_err());
    }
    assert!(render::check_value(&json!({"name":"ANTHROPIC_API_KEY", "valueFrom":{"secretKeyRef":{"name":"macro-env","key":"ANTHROPIC_API_KEY"}}})).is_ok());
}

#[test]
fn names_cannot_escape_a_namespace_or_nix_parameter_file() {
    for name in [
        "",
        "../other",
        "-invalid",
        "namespace/other",
        "injected\";",
        "upperCase",
        "underscore_name",
    ] {
        assert!(namespace(name).is_err());
    }
    assert_eq!(
        namespace("test-2").expect("valid name"),
        "macro-kube-test-2"
    );
}

#[test]
fn only_internal_url_hostnames_are_normalized() {
    let mut env = std::collections::BTreeMap::from([
        (
            "MCP_SERVICE_URL".into(),
            "http://agent_harness_service:8080/mcp".into(),
        ),
        (
            "UNRELATED_SECRET".into(),
            "some_agent_harness_service_value".into(),
        ),
    ]);
    secrets::normalize(&mut env);
    assert_eq!(
        env["MCP_SERVICE_URL"],
        "http://agent-harness-service:8080/mcp"
    );
    assert_eq!(env["UNRELATED_SECRET"], "some_agent_harness_service_value");
}
