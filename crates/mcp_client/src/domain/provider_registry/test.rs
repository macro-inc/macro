use super::*;

#[test]
fn linear_gets_explicit_read_write_scopes() {
    assert_eq!(
        dcr_default_scopes("https://mcp.linear.app/mcp"),
        vec!["read".to_string(), "write".to_string()]
    );
}

#[test]
fn unknown_server_gets_no_default_scopes() {
    assert_eq!(
        dcr_default_scopes("https://mcp.example.com/mcp"),
        Vec::<String>::new()
    );
}
