use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AuthToken {
    #[allow(unused)]
    pub user_id: Option<String>,
    pub document_id: String,
    pub access_level: AccessLevel,
}

pub fn decode_validate_jwt(token: &str, secret_key: &str) -> anyhow::Result<AuthToken> {
    let validation = Validation::new(Algorithm::HS256);
    let key = DecodingKey::from_secret(secret_key.to_string().as_bytes());
    Ok(decode::<AuthToken>(token, &key, &validation)?.claims)
}

/// Validates document permission for a specific operation requiring edit access
pub fn validate_edit_document_permission(
    token: &str,
    document_id: &str,
    secret_key: &str,
) -> Result<(), anyhow::Error> {
    let decoded = decode_validate_jwt(token, secret_key)?;

    // Validate token is for this document
    if decoded.document_id != document_id {
        anyhow::bail!("Document ID mismatch in token");
    }

    // Check permission level - require Edit or Admin access
    match decoded.access_level {
        AccessLevel::Edit | AccessLevel::Owner => Ok(()),
        _ => anyhow::bail!("Insufficient permissions: Edit access required"),
    }
}
