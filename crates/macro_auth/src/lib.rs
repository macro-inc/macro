pub mod constant;
pub mod error;
pub mod headers;
pub mod macro_api_token;
pub mod middleware;

pub type Result<T, E = error::MacroAuthError> = std::result::Result<T, E>;
