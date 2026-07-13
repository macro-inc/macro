//! AWS MSK IAM (SASL/OAUTHBEARER) support shared by Kafka producers and consumers.

use aws_msk_iam_sasl_signer::generate_auth_token;
use aws_types::region::Region;
use rdkafka::ClientConfig;
use rdkafka::client::{ClientContext, OAuthToken};
use rdkafka::consumer::ConsumerContext;

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
/// librdkafka invokes [`ClientContext::generate_oauth_token`] when the
/// connection is first established and again before each token expires.
pub struct MskIamClientContext {
    region: Region,
}

impl MskIamClientContext {
    /// Build a context that signs tokens for the region in `AWS_REGION`,
    /// falling back to `us-east-1`.
    pub fn from_env() -> Self {
        let region = AwsRegion::new()
            .and_then(|region| region.value().map(str::to_string))
            .unwrap_or_else(|| DEFAULT_AWS_REGION.to_string());

        Self {
            region: Region::new(region),
        }
    }
}

impl ClientContext for MskIamClientContext {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = true;

    fn generate_oauth_token(
        &self,
        _oauthbearer_config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        let region = self.region.clone();

        // librdkafka may invoke this callback on a tokio runtime thread (for a
        // `StreamConsumer`, it fires while `recv()` is polled from async code),
        // where blocking on the ambient runtime panics. Sign on a dedicated
        // thread with its own single-threaded runtime instead, so the callback
        // is safe from any calling context. Tokens live ~15 minutes, so the
        // per-refresh thread + runtime cost is negligible.
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
            .map_err(|e| -> Box<dyn std::error::Error> { e })
            .inspect_err(|e| {
                tracing::error!(error = %e, "failed to sign MSK IAM auth token");
            })?;

        tracing::info!(expiration_time_ms, "signed MSK IAM auth token");

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
