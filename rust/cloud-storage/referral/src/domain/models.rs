//! Domain models for the referral crate.

use macro_uuid::ShortUuidConverter;

/// Wrapper for the referral code to make it type safe
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct ReferralCode(pub String);

/// Errors that can occur during referral operations.
#[derive(Debug, thiserror::Error)]
pub enum ReferralError {
    /// The requested referral code was not found.
    #[error("referral not found: {0}")]
    NotFound(String),
    /// The user is not authorized to perform this action.
    #[error("unauthorized")]
    Unauthorized,
    /// A bad request was made.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// The referral code was invalid
    #[error("invalid referral code: {0}")]
    InvalidReferralCode(String),
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

/// Converts the referral code (short uuid) to the full uuid
pub(crate) fn referral_code_to_uuid(
    referral_code: &ReferralCode,
) -> Result<uuid::Uuid, ReferralError> {
    let short_uuid_converter = ShortUuidConverter::default();
    short_uuid_converter
        .to_uuid(&referral_code.0)
        .map_err(|_| ReferralError::InvalidReferralCode(referral_code.0.clone()))
}
