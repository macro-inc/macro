//! Cross-session change signals over the user-addressed Soup realtime topic.

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use soup_realtime::domain::{
    models::{Patch, SoupRealtimeMessage},
    ports::SoupRealtimePublisher,
};

use crate::domain::ports::WorkFeedSignals;

/// Publishes an entity patch addressed to the viewer alone, which every
/// one of their sessions' work feed subscriptions recomputes from.
pub struct SoupRealtimeWorkFeedSignals<P> {
    publisher: P,
}

impl<P> SoupRealtimeWorkFeedSignals<P> {
    /// Create the adapter over a Soup realtime publisher.
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }
}

impl<P> WorkFeedSignals for SoupRealtimeWorkFeedSignals<P>
where
    P: SoupRealtimePublisher,
{
    async fn items_changed(&self, user: MacroUserIdStr<'static>, entities: Vec<Entity<'static>>) {
        for entity in entities {
            let message = SoupRealtimeMessage::new(user.clone(), Patch::Updated(entity));
            if let Err(error) = self.publisher.publish(message).await {
                tracing::warn!(error = ?error, "failed to publish work feed change");
            }
        }
    }
}
