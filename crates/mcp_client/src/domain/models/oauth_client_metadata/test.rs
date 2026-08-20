use super::*;

#[test]
fn serializes_required_client_id_metadata_fields() {
    let metadata = OAuthClientMetadata::new(
        "https://document-cognition.macro.com/mcp/servers/auth/client-metadata".to_string(),
        "https://document-cognition.macro.com/mcp/servers/auth/callback".to_string(),
    );

    let value = serde_json::to_value(metadata).expect("metadata serializes");

    assert_eq!(
        value,
        serde_json::json!({
            "client_id": "https://document-cognition.macro.com/mcp/servers/auth/client-metadata",
            "client_name": "Macro",
            "redirect_uris": ["https://document-cognition.macro.com/mcp/servers/auth/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })
    );
}
