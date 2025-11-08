use anyhow::Context;
use model::insight_context::email_insights::GenerateEmailInsightContext;
use model::insight_context::{InsightContextQueueMessage, ProvidedContext};
use sqs_client::SQS;

#[derive(Debug, Clone)]
pub struct InsightContextProvider {
    pub source_name: String,
    pub sqs_client: SQS,
}

impl InsightContextProvider {
    #[tracing::instrument(skip(sqs_client))]
    pub fn create(sqs_client: SQS, source_name: &'static str) -> Self {
        Self {
            source_name: source_name.to_string(),
            sqs_client,
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn provide_context(&self, user_id: &str, resource_id: &str) {
        let message = InsightContextQueueMessage::Context(ProvidedContext {
            provider_source: self.source_name.to_owned(),
            resource_id: resource_id.to_string(),
            user_id: user_id.to_string(),
        });

        tracing::debug!("provide context {:?}", message);
        let _ = self
            .sqs_client
            .enqueue_insight_context(message)
            .await
            .context(format!("failed to send context {}", self.source_name));
    }

    /// Enqueue a batch of email threads for insight generation
    #[tracing::instrument(skip(self))]
    pub async fn provide_email_context(
        &self,
        context: GenerateEmailInsightContext,
    ) -> anyhow::Result<()> {
        let message = InsightContextQueueMessage::Email { context };
        self.sqs_client
            .enqueue_insight_context(message)
            .await
            .context("failed to send email context")
    }
}
