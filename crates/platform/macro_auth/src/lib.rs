pub mod constant;
pub mod error;
pub mod headers;
mod internal_api_key;
pub mod macro_api_token;
pub mod middleware;

pub use internal_api_key::InternalApiKey;

pub type Result<T, E = error::MacroAuthError> = std::result::Result<T, E>;
