use super::MCP_CLIENT_NAME;

/// Public OAuth client metadata used when an authorization server supports
/// Client ID Metadata Documents (CIMD).
#[derive(Clone, Debug, serde::Serialize)]
pub struct OAuthClientMetadata {
    client_id: String,
    client_name: String,
    redirect_uris: Vec<String>,
    grant_types: Vec<String>,
    response_types: Vec<String>,
    token_endpoint_auth_method: String,
}

impl OAuthClientMetadata {
    /// Build Macro's public OAuth client metadata document.
    pub fn new(client_id: String, redirect_uri: String) -> Self {
        Self {
            client_id,
            client_name: MCP_CLIENT_NAME.to_string(),
            redirect_uris: vec![redirect_uri],
            grant_types: vec![
                "authorization_code".to_string(),
                "refresh_token".to_string(),
            ],
            response_types: vec!["code".to_string()],
            token_endpoint_auth_method: "none".to_string(),
        }
    }

    /// Return the HTTPS URL that identifies Macro to CIMD-capable servers.
    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    /// Return the callback URI used for authorization-code redirects.
    pub fn redirect_uri(&self) -> &str {
        self.redirect_uris
            .first()
            .expect("OAuthClientMetadata always has one redirect URI")
    }
}

#[cfg(test)]
mod test;
