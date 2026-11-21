//! The error body of every non-2xx answer.

use serde::{Deserialize, Serialize};

/// Why a request failed. The client decides retries from the code alone.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::Display,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum ErrorCode {
    /// The computer does not exist on this host.
    NotFound,
    /// The computer exists for another control plane or generation.
    GenerationMismatch,
    /// The request is malformed or asks for what this host never offers;
    /// retrying it cannot succeed.
    InvalidRequest,
    /// The image is not installed on this host; retrying cannot succeed until
    /// it is.
    ImageMissing,
    /// The golden for this image and shape is still being built; retry.
    GoldenNotReady,
    /// Every network slot is taken; retry once a computer is destroyed.
    NoNetworkSlot,
    /// The action does not apply to the current power state (e.g. `unfreeze`
    /// of a stopped guest).
    InvalidState,
    /// The guest did not answer on vsock in time; retry.
    GuestUnreachable,
    /// Anything else on the host; retry.
    Internal,
}

impl ErrorCode {
    /// Whether repeating the same request cannot succeed.
    pub fn is_permanent(self) -> bool {
        match self {
            Self::GenerationMismatch | Self::InvalidRequest | Self::ImageMissing => true,
            Self::NotFound
            | Self::GoldenNotReady
            | Self::NoNetworkSlot
            | Self::InvalidState
            | Self::GuestUnreachable
            | Self::Internal => false,
        }
    }
}

/// The JSON body of an error answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct ErrorResponse {
    /// What went wrong, for the client's decisions.
    pub code: ErrorCode,
    /// Human-readable detail, for logs.
    pub message: String,
}
