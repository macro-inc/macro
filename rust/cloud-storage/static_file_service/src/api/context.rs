use crate::config::Config;
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::s3::client::S3Client;
use aws_sdk_sqs::Client;
use axum::extract::FromRef;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub metadata_client: DynamodbClient,
    pub storage_client: Arc<S3Client>,
    pub sqs_client: Client,
    pub config: Arc<Config>,
    pub internal_api_secret: LocalOrRemoteSecret<InternalApiSecretKey>,
}
