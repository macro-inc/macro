use crate::config::Config;
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::s3::client::S3Client;
use aws_sdk_sqs::Client;
use axum::extract::FromRef;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use std::sync::Arc;

/// Concrete authorization service used by the `MacroAuthorizationExtractor` in handlers.
pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub metadata_client: DynamodbClient,
    pub storage_client: Arc<S3Client>,
    pub sqs_client: Client,
    pub config: Arc<Config>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
}
