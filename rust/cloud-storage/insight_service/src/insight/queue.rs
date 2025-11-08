use super::context_router::ContextRouter;
use crate::{
    context::ServiceContext,
    insight::insight_context_handler::{handle_context, handle_email_context},
};
use anyhow::Context;
use aws_sdk_sqs::types::Message;
use macro_db_client::insights_backfill::job::update::update_insights_backfill_job_status;
use model::insight_context::insights_backfill::InsightsBackfillJobStatus;
use model::insight_context::{InsightContextQueueMessage, email_insights::EmailInfo};
use sqs_worker::SQSWorker;
use std::sync::Arc;

fn message_from_str(body: &str) -> Result<InsightContextQueueMessage, anyhow::Error> {
    serde_json::from_str(body).context("deserialize error")
}

fn message_from_sqs_message(
    msg: &aws_sdk_sqs::types::Message,
) -> Result<InsightContextQueueMessage, anyhow::Error> {
    msg.body()
        .ok_or_else(|| anyhow::anyhow!("no message body"))
        .and_then(message_from_str)
}

pub struct ContextQueue {
    inner: Arc<SQSWorker>,
    context_router: ContextRouter,
    service_context: Arc<ServiceContext>,
}

impl ContextQueue {
    pub fn new(
        worker: SQSWorker,
        context_config: ServiceContext,
        context_router: ContextRouter,
    ) -> Self {
        Self {
            inner: Arc::new(worker),
            context_router,
            service_context: Arc::new(context_config),
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn poll(&self) {
        tracing::debug!("Polling Start");
        loop {
            tracing::trace!("Poll");
            match self.inner.receive_messages().await {
                Ok(messages) => {
                    if messages.is_empty() {
                        tracing::trace!("no messages found");
                        continue;
                    }
                    for message in messages {
                        let _ = self.handle_message(message).await;
                    }
                }
                Err(e) => tracing::trace!(error =? e, "error receiving messages"),
            }
        }
    }

    #[tracing::instrument(skip(self))]
    async fn handle_message(&self, message: Message) -> Result<(), ()> {
        tracing::debug!("MESSAGE RECIEVED\n{:?}", message);
        let context_message = message_from_sqs_message(&message).map_err(|e| {
            tracing::error!(error =? e, sqx_message=?message, "Malformed SQS message");
        })?;

        match context_message {
            // its context
            InsightContextQueueMessage::Context(context) => {
                // find a context consumer
                let context_consumer = self
                    .context_router
                    .route_context(&context)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Router could not find a consumer for provided context")
                    })
                    .map_err(|e| {
                        tracing::error!(error=?e, provided_context=?context);
                    })?;

                // clone stuff
                let sqs_worker_clone = Arc::clone(&self.inner);
                let consumer_clone = Arc::clone(&context_consumer);
                let service_context = Arc::clone(&self.service_context);

                // start task
                tokio::spawn(async move {
                    match handle_context(service_context, context, consumer_clone.clone()).await {
                        Ok(_) => {
                            sqs_worker_clone.cleanup_message(&message).await.ok();
                        }
                        Err(e) => {
                            tracing::error!(error=?e, "context handler exited with an error");
                        }
                    }
                });
            }
            InsightContextQueueMessage::Email { context } => {
                let sqs_worker_clone = Arc::clone(&self.inner);
                let service_context = Arc::clone(&self.service_context);
                let service_context_clone = Arc::clone(&service_context);
                let context_clone = context.clone();
                tokio::spawn(async move {
                    match handle_email_context(service_context, context, message.message_id()).await
                    {
                        Ok(_) => {
                            sqs_worker_clone.cleanup_message(&message).await.ok();
                        }
                        Err(e) => {
                            if let EmailInfo::Backfill(batch) = &context_clone.info {
                                tracing::error!(error=?e, "email context handler exited with an error for job {}", batch.job_id);
                                if let Err(e) = update_insights_backfill_job_status(
                                    &service_context_clone.macro_db,
                                    &batch.job_id,
                                    InsightsBackfillJobStatus::Failed,
                                )
                                .await
                                {
                                    tracing::error!(error=?e, "failed to add job {} to db", batch.job_id);
                                }
                            } else {
                                tracing::error!(error=?e, "email context handler exited with an error");
                            }
                            sqs_worker_clone.cleanup_message(&message).await.ok();
                        }
                    }
                });
            }
            InsightContextQueueMessage::Test { .. } => {
                self.inner.cleanup_message(&message).await.ok();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use model::insight_context::InsightContextQueueMessage;

    fn make_sqs_message() -> aws_sdk_sqs::types::Message {
        let message = include_str!("../../tests/chat_context.json");
        aws_sdk_sqs::types::Message::builder()
            .set_body(Some(message.to_string()))
            .build()
    }

    #[test]
    fn test_deserialize_message() {
        let message_json: &'static str = include_str!("../../tests/chat_context.json");
        let message = message_from_str(message_json);
        assert!(message.is_ok());
    }

    #[tokio::test]
    async fn test_context_message_from_sqs_queue() {
        let message = make_sqs_message();
        let parsed = message_from_sqs_message(&message);
        assert!(parsed.is_ok());
        let parsed_message = parsed.unwrap();

        #[allow(irrefutable_let_patterns)]
        if let InsightContextQueueMessage::Context(context) = parsed_message {
            assert_eq!(context.provider_source, "chat".to_string());
            assert_eq!(context.user_id, "fake|user.com");
        } else {
            panic!("message does not match\n{:?}", parsed_message);
        }
    }
}
