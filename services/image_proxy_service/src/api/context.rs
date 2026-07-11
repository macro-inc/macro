use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env::Environment;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub jwt_args: JwtValidationArgs,
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
