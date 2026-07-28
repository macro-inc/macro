//! AWS MSK IAM (SASL/OAUTHBEARER) support shared by Kafka producers and consumers.

use aws_msk_iam_sasl_signer::generate_auth_token;
use aws_types::region::Region;
use rdkafka::ClientConfig;
use rdkafka::client::{ClientContext, OAuthToken};
use rdkafka::consumer::{BaseConsumer, ConsumerContext, Rebalance};

use crate::RebalanceTracker;

/// Region used to sign MSK IAM auth tokens when `AWS_REGION` is unset.
/// Matches the fallback in `macro_aws_config`.
const DEFAULT_AWS_REGION: &str = "us-east-1";

macro_env_var::maybe_env_var! {
    /// AWS region used to sign MSK IAM auth tokens.
    struct AwsRegion;
}

/// Applies the TLS and SASL/OAUTHBEARER settings required for MSK IAM auth.
pub fn configure_sasl_iam(mut config: ClientConfig) -> ClientConfig {
    config
        .set("security.protocol", "SASL_SSL")
        .set("sasl.mechanism", "OAUTHBEARER");
    config
}

/// Client context that supplies AWS MSK IAM authentication tokens.
///
/// Tokens are signed with ambient AWS credentials such as an ECS task role.
pub struct MskIamClientContext {
    region: Region,
    rebalance_tracker: Option<RebalanceTracker>,
}

impl MskIamClientContext {
    /// Builds a context using `AWS_REGION`, falling back to `us-east-1`.
    pub fn from_env() -> Self {
        Self::from_env_with_optional_rebalance_tracker(None)
    }

    pub(crate) fn from_env_with_rebalance_tracker(rebalance_tracker: RebalanceTracker) -> Self {
        Self::from_env_with_optional_rebalance_tracker(Some(rebalance_tracker))
    }

    fn from_env_with_optional_rebalance_tracker(
        rebalance_tracker: Option<RebalanceTracker>,
    ) -> Self {
        let region = AwsRegion::new()
            .and_then(|region| region.value().map(str::to_string))
            .unwrap_or_else(|| DEFAULT_AWS_REGION.to_string());

        Self {
            region: Region::new(region),
            rebalance_tracker,
        }
    }

    pub(crate) fn observe_pre_rebalance(&self, rebalance: &Rebalance<'_>) {
        if let Some(tracker) = &self.rebalance_tracker {
            tracker.observe_pre_rebalance(rebalance);
        }
    }

    pub(crate) fn observe_post_rebalance(&self, rebalance: &Rebalance<'_>) {
        if let Some(tracker) = &self.rebalance_tracker {
            tracker.observe_post_rebalance(rebalance);
        }
    }

    #[cfg(test)]
    pub(crate) fn has_rebalance_tracker(&self) -> bool {
        self.rebalance_tracker.is_some()
    }
}

impl ClientContext for MskIamClientContext {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = true;

    fn generate_oauth_token(
        &self,
        _oauthbearer_config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        let region = self.region.clone();

        // librdkafka may invoke this callback on a Tokio runtime thread. Sign
        // on a dedicated thread with its own runtime so blocking is safe from
        // every calling context.
        let signer = std::thread::spawn(
            move || -> Result<(String, i64), Box<dyn std::error::Error + Send + Sync>> {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()?;
                Ok(runtime.block_on(generate_auth_token(region))?)
            },
        );

        let (token, expiration_time_ms) = signer
            .join()
            .map_err(|_| "MSK IAM token signer thread panicked")?
            .map_err(|error| -> Box<dyn std::error::Error> { error })
            .inspect_err(|error| {
                tracing::error!(error = %error, "failed to sign MSK IAM auth token");
            })?;

        tracing::info!(expiration_time_ms, "signed MSK IAM auth token");

        Ok(OAuthToken {
            token,
            principal_name: String::new(),
            lifetime_ms: expiration_time_ms,
        })
    }
}

impl ConsumerContext for MskIamClientContext {
    fn pre_rebalance(&self, _consumer: &BaseConsumer<Self>, rebalance: &Rebalance<'_>) {
        self.observe_pre_rebalance(rebalance);
    }

    fn post_rebalance(&self, _consumer: &BaseConsumer<Self>, rebalance: &Rebalance<'_>) {
        self.observe_post_rebalance(rebalance);
    }
}
