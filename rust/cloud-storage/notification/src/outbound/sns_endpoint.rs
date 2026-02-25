//! SNS adapter for deleting platform endpoints.

use crate::domain::ports::SnsEndpointDeleter;
use rootcause::Report;

/// Trait for SNS endpoint operations.
///
/// This allows the adapter to work with different SNS client implementations.
pub trait SnsEndpointOps: Send + Sync + 'static {
    /// Delete an SNS platform endpoint by its ARN.
    fn delete_endpoint(
        &self,
        endpoint_arn: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl SnsEndpointOps for aws_sdk_sns::Client {
    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.delete_endpoint()
            .endpoint_arn(endpoint_arn)
            .send()
            .await?;

        Ok(())
    }
}

/// SNS adapter for deleting platform endpoints.
pub struct SnsEndpointDeletionAdapter<S> {
    sns: S,
}

impl<S> SnsEndpointDeletionAdapter<S> {
    /// Create a new SNS endpoint deletion adapter.
    pub fn new(sns: S) -> Self {
        Self { sns }
    }
}

impl<S: SnsEndpointOps> SnsEndpointDeleter for SnsEndpointDeletionAdapter<S> {
    #[tracing::instrument(err, skip(self))]
    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.sns.delete_endpoint(endpoint_arn).await
    }
}
