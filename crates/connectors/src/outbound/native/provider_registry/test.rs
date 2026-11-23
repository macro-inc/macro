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

/// A trailing slash does not change which server a URL names. Getting this
/// wrong is quiet and confusing: the pre-registered providers are exactly the
/// ones that cannot register a client on the fly, so a missed match sends the
/// flow to DCR and the connector fails with "Dynamic client registration not
/// supported" for a provider Macro has credentials for.
#[test]
fn a_trailing_slash_names_the_same_server() {
    assert_eq!(
        dcr_default_scopes("https://mcp.linear.app/mcp/"),
        dcr_default_scopes("https://mcp.linear.app/mcp")
    );
}
