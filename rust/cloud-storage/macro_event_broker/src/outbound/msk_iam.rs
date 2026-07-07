//! AWS MSK IAM (SASL/OAUTHBEARER) support shared by Kafka producers and consumers.

use aws_msk_iam_sasl_signer::generate_auth_token;
use aws_types::region::Region;
use rdkafka::ClientConfig;
use rdkafka::client::{ClientContext, OAuthToken};
use rdkafka::consumer::ConsumerContext;

use crate::domain::models::EventBrokerError;

/// Region used to sign MSK IAM auth tokens when `AWS_REGION` is unset.
/// Matches the fallback in `macro_aws_config`.
const DEFAULT_AWS_REGION: &str = "us-east-1";

macro_env_var::maybe_env_var! {
    /// AWS region used to sign MSK IAM auth tokens.
    struct AwsRegion;
}

/// Apply the TLS + SASL/OAUTHBEARER settings required to authenticate to an
/// AWS MSK cluster with IAM auth (the `:9098` bootstrap listener).
pub fn configure_sasl_iam(config: &mut ClientConfig) -> &mut ClientConfig {
    config
        .set("security.protocol", "SASL_SSL")
        .set("sasl.mechanism", "OAUTHBEARER")
}

/// Client context that supplies AWS MSK IAM (SASL/OAUTHBEARER) auth tokens,
/// signing with the ambient AWS credentials (e.g. the ECS task role).
///
/// librdkafka invokes [`ClientContext::generate_oauth_token`] on one of its own
/// (non-tokio) threads when the connection is first established and again
/// before each token expires, so blocking on the async signer here is safe.
pub struct MskIamClientContext {
    region: Region,
    runtime: tokio::runtime::Handle,
}

impl MskIamClientContext {
    /// Build a context that signs tokens for the region in `AWS_REGION`
    /// (falling back to `us-east-1`), refreshing through the current tokio
    /// runtime. Errors when called outside a tokio runtime.
    pub fn from_env() -> Result<Self, EventBrokerError> {
        let runtime = tokio::runtime::Handle::try_current().map_err(|e| {
            EventBrokerError::Publish(format!("MSK IAM auth requires a tokio runtime: {e}"))
        })?;
        let region = AwsRegion::new()
            .and_then(|region| region.value().map(str::to_string))
            .unwrap_or_else(|| DEFAULT_AWS_REGION.to_string());

        Ok(Self {
            region: Region::new(region),
            runtime,
        })
    }
}

impl ClientContext for MskIamClientContext {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = true;

    fn generate_oauth_token(
        &self,
        _oauthbearer_config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        let (token, expiration_time_ms) = self
            .runtime
            .block_on(generate_auth_token(self.region.clone()))?;

        Ok(OAuthToken {
            token,
            principal_name: String::new(),
            lifetime_ms: expiration_time_ms,
        })
    }
}

/// Lets consumers (e.g. `StreamConsumer<MskIamClientContext>`) use this
/// context; all behavior is the trait's defaults.
impl ConsumerContext for MskIamClientContext {}
