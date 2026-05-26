mod permissions_token;
mod renamed_middleware {
    pub use macro_middleware::auth::decode_jwt::handler as decode_jwt;
}
pub use permissions_token::{AuthToken, decode_validate_jwt, validate_edit_document_permission};
pub use renamed_middleware::decode_jwt;
