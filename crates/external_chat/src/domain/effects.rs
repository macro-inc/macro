//! Durable generic notifications for messages persisted by the session service.
//! Runs in DSS, which supplies the notification ingress adapter.

use super::ports::*;
use std::sync::Arc;

/// Drains `external_chat_message` revisions that are not yet published.
#[derive(Clone)]
pub struct EffectsService {
    repository: Arc<dyn EffectsRepository>,
    publisher: Arc<dyn ChatPublisher>,
}

impl EffectsService {
    /// Wire the outbox and the chat publisher.
    pub fn new(repository: Arc<dyn EffectsRepository>, publisher: Arc<dyn ChatPublisher>) -> Self {
        Self {
            repository,
            publisher,
        }
    }

    /// Publish one batch of due revisions. A failed message is deferred and never
    /// holds up the others. Returns how many were published.
    #[tracing::instrument(
        name = "whatsapp.linked.publish_effects",
        skip_all,
        err,
        fields(due, published)
    )]
    pub async fn publish_pending(&self) -> ExternalChatResult<usize> {
        let effects = self.repository.pending_effects(50).await?;
        tracing::Span::current().record("due", effects.len());
        let mut published = 0;
        for effect in &effects {
            if !effect.should_notify() {
                self.repository
                    .published(effect.message_id, effect.revision)
                    .await?;
                published += 1;
                continue;
            }
            match self.publisher.publish(effect).await {
                Ok(()) => {
                    self.repository
                        .published(effect.message_id, effect.revision)
                        .await?;
                    published += 1;
                }
                Err(error) => {
                    tracing::warn!(
                        message_id = %effect.message_id,
                        code = error.current_context().code(),
                    error = %error,
                        "External chat notification will retry"
                    );
                    self.repository.defer_effect(effect.message_id).await?;
                }
            }
        }
        tracing::Span::current().record("published", published);
        Ok(published)
    }
}
