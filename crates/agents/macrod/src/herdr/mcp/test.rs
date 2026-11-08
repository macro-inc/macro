use super::*;
use serde_json::json;

#[test]
fn native_codex_mcp_keeps_headers_and_stdio_secrets_out_of_arguments() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let prepared = codex(root.path(), &[
        json!({"name":"macro.tools", "type":"http", "url":"https://example.com/mcp", "headers":[{"name":"Authorization","value":"Bearer private-test-token"}]}),
        json!({"name":"local", "command":"example", "args":["private-argument"], "env":[{"name":"TOKEN","value":"private-environment"}]}),
    ]).unwrap();
    assert!(!prepared.args.join(" ").contains("private-"));
    for pair in prepared.args.chunks_exact(2) {
        let config: toml::Value = toml::from_str(&pair[1]).unwrap();
        assert!(config["mcp_servers"].is_table());
    }
    let environment = std::fs::read_to_string(&prepared.environment).unwrap();
    assert!(environment.contains("Bearer private-test-token"));
    assert_eq!(
        std::fs::metadata(&prepared.environment)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(
        std::fs::read_to_string(root.path().join("mcp-1.sh"))
            .unwrap()
            .contains("private-argument")
    );
}

#[test]
fn unsupported_transport_and_shell_injection_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    assert!(
        codex(
            root.path(),
            &[json!({"name":"old", "type":"sse", "url":"https://example.com/sse"})]
        )
        .is_err()
    );
    assert!(codex(root.path(), &[json!({"name":"bad", "command":"example", "env":[{"name":"X; echo bad", "value":"value"}]})]).is_err());
}
