//! Cross-session change signals over the user-addressed Soup realtime topic.

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use soup_realtime::domain::{
    models::{Patch, SoupRealtimeMessage},
    ports::SoupRealtimePublisher,
};

use crate::domain::ports::FeedSignals;

/// Publishes an entity patch addressed to the viewer alone, which every
/// one of their sessions' feed subscriptions recomputes from.
pub struct SoupRealtimeFeedSignals<P> {
    publisher: P,
}

impl<P> SoupRealtimeFeedSignals<P> {
    /// Create the adapter over a Soup realtime publisher.
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }
}

impl<P> FeedSignals for SoupRealtimeFeedSignals<P>
where
    P: SoupRealtimePublisher,
{
    async fn changed(&self, user: MacroUserIdStr<'static>, entities: Vec<Entity<'static>>) {
        for entity in entities {
            let message = SoupRealtimeMessage::new(user.clone(), Patch::Updated(entity));
            if let Err(error) = self.publisher.publish(message).await {
                tracing::warn!(error = ?error, "failed to publish feed change");
            }
        }
    }
}
