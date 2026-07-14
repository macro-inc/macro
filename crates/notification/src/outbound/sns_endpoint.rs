//! SNS adapter for platform endpoint operations.

use std::collections::HashMap;

use crate::domain::ports::SnsEndpointManager;
use rootcause::Report;

/// Trait for SNS endpoint management operations (create, get/set attributes, delete).
///
/// This allows the adapter to work with different SNS client implementations.
pub trait SnsEndpointManagementOps: Send + Sync + 'static {
    /// Create a new SNS platform endpoint for the given platform ARN and device token.
    fn create_platform_endpoint(
        &self,
        platform_arn: &str,
        token: &str,
    ) -> impl std::future::Future<Output = Result<String, Report>> + Send;

    /// Get the attributes of an existing SNS endpoint.
    fn get_endpoint_attributes(
        &self,
        endpoint_arn: &str,
    ) -> impl std::future::Future<Output = Result<HashMap<String, String>, Report>> + Send;

    /// Set/update attributes on an existing SNS endpoint.
    fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Delete an SNS platform endpoint by its ARN.
    fn delete_endpoint(
        &self,
        endpoint_arn: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl SnsEndpointManagementOps for aws_sdk_sns::Client {
    async fn create_platform_endpoint(
        &self,
        platform_arn: &str,
        token: &str,
    ) -> Result<String, Report> {
        match self
            .create_platform_endpoint()
            .platform_application_arn(platform_arn)
            .token(token)
            .send()
            .await?
            .endpoint_arn()
        {
            Some(endpoint) => Ok(endpoint.to_string()),
            None => Err(rootcause::report!("unable to create platform endpoint")),
        }
    }

    async fn get_endpoint_attributes(
        &self,
        endpoint_arn: &str,
    ) -> Result<HashMap<String, String>, Report> {
        let output = self
            .get_endpoint_attributes()
            .endpoint_arn(endpoint_arn)
            .send()
            .await?;

        match output.attributes() {
            Some(attrs) => Ok(attrs.clone()),
            None => Err(rootcause::report!("unable to get endpoint attributes")),
        }
    }

    async fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> Result<(), Report> {
        self.set_endpoint_attributes()
            .endpoint_arn(endpoint_arn)
            .set_attributes(Some(attributes))
            .send()
            .await?;

        Ok(())
    }

    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.delete_endpoint()
            .endpoint_arn(endpoint_arn)
            .send()
            .await?;

        Ok(())
    }
}

/// SNS adapter for platform endpoint management.
pub struct SnsEndpointManagerAdapter<S> {
    sns: S,
}

impl<S> SnsEndpointManagerAdapter<S> {
    /// Create a new SNS endpoint manager adapter.
    pub fn new(sns: S) -> Self {
        Self { sns }
    }
}

impl<S: SnsEndpointManagementOps> SnsEndpointManager for SnsEndpointManagerAdapter<S> {
    #[tracing::instrument(err, skip(self))]
    async fn create_platform_endpoint(
        &self,
        platform_arn: &str,
        token: &str,
    ) -> Result<String, Report> {
        self.sns.create_platform_endpoint(platform_arn, token).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_endpoint_attributes(
        &self,
        endpoint_arn: &str,
    ) -> Result<HashMap<String, String>, Report> {
        self.sns.get_endpoint_attributes(endpoint_arn).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> Result<(), Report> {
        self.sns
            .set_endpoint_attributes(endpoint_arn, attributes)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.sns.delete_endpoint(endpoint_arn).await
    }
}
