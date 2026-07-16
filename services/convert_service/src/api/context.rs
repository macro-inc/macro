use axum::extract::FromRef;
use macro_authorization::{
    MacroAuthorizationServiceImpl, MacroAuthorizationState, NoopMacroAuthJwtValidator,
};
use s3_client::S3;
use std::sync::Arc;

use crate::config::Config;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<NoopMacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: sqlx::PgPool,
    pub s3_client: S3,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub config: Arc<Config>,
}
