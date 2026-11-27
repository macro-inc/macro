//! The provider's deployment settings: all three values together, or none.
use super::signer::{KmsKeyId, KmsKeyIdError};

/// A complete OpenBao provider configuration.
#[derive(Debug, PartialEq, Eq)]
pub struct OpenBaoSettings<'a> {
    /// The vault's origin.
    pub address: &'a str,
    /// `iss` of the login JWTs, which each JWT mount binds.
    pub issuer: &'a str,
    /// The KMS key that signs them.
    pub key: KmsKeyId,
}

/// Why the configured values were refused at startup.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum SettingsError {
    /// Some but not all of the three values are set.
    #[error(
        "Passwords requires OPENBAO_ADDRESS, PASSWORDS_JWT_ISSUER and PASSWORDS_JWT_KMS_KEY_ID together"
    )]
    Partial,
    /// The key reference is not one this environment accepts.
    #[error(transparent)]
    KeyId(#[from] KmsKeyIdError),
}

/// `Ok(None)` when Passwords has no provider at all; an error for a partial set.
/// `allow_alias` is true only for local stacks.
pub fn openbao_settings<'a>(
    address: Option<&'a str>,
    issuer: Option<&'a str>,
    key_id: Option<&str>,
    allow_alias: bool,
) -> Result<Option<OpenBaoSettings<'a>>, SettingsError> {
    match (address, issuer, key_id) {
        (None, None, None) => Ok(None),
        (Some(address), Some(issuer), Some(key_id)) => Ok(Some(OpenBaoSettings {
            address,
            issuer,
            key: KmsKeyId::parse(key_id, allow_alias)?,
        })),
        _ => Err(SettingsError::Partial),
    }
}

#[cfg(test)]
mod test;
