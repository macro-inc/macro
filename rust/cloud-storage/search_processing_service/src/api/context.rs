use axum::extract::FromRef;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;

use crate::config::Config;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub sqs_client: Arc<sqs_client::SQS>,
    pub opensearch_client: Arc<opensearch_client::OpensearchClient>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
}
