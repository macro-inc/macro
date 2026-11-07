#![deny(missing_docs)]
//! This crate splits out the [ErrorResponse] and [GenericErrorResponse] structs from the mega
//! model crate to reduce coupling

use std::borrow::Cow;

/// A plain old json error response for use with axum.
/// yup, thats it.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct ErrorResponse<'a> {
    /// Message to explain failure
    pub message: Cow<'a, str>,
}

/// The message carried by the `Generic` variant of the auth and service
/// client error enums.
#[derive(serde::Serialize, Debug)]
pub struct GenericErrorResponse {
    /// The error message.
    pub message: String,
}

#[cfg(feature = "anyhow")]
impl From<anyhow::Error> for GenericErrorResponse {
    fn from(err: anyhow::Error) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}
