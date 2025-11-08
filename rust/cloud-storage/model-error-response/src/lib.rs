#![deny(missing_docs)]
//! This crate splits out the [ErrorResponse] struct from the mega model crate to reduce coupling

/// A plain old json error response for use with axum.
/// yup, thats it.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct ErrorResponse<'a> {
    /// Message to explain failure
    pub message: &'a str,
}
