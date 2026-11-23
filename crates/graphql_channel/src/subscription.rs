//! Live channel timeline updates for the authenticated user.

#[cfg(test)]
mod test;

use std::sync::Arc;

use async_graphql::{Context, ID, SimpleObject, Subscription};
use broadcast::{BroadcastSubscription, ExitReason};
use graphql_common::require_authenticated_user;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::timeline_updates::ChannelTimelineUpdate;
use tokio_stream::Stream;

use crate::{GraphqlChannelMessage, GraphqlChannelTimelineActivity};

/// One committed change to a channel the viewer participates in: exactly what
/// `channelChanges` returns for this one sequence.
#[derive(SimpleObject)]
pub struct GraphqlChannelTimelineUpdate {
    /// Channel whose sequence this change advanced.
    pub channel_id: ID,
    /// The channel's sequence once this change is applied, encoded as in
    /// `channelChanges`. Updates can arrive out of order, and a sequence can
    /// have no update; a gap is closed with `channelChanges`.
    pub seq: String,
    /// The changed message and, for a reply, its root with the thread
    /// summary, tombstones included.
    pub messages: Vec<GraphqlChannelMessage>,
    /// The recorded timeline activity.
    pub activities: Vec<GraphqlChannelTimelineActivity>,
    /// A changed entry that no longer exists.
    pub removed_ids: Vec<ID>,
}

impl GraphqlChannelTimelineUpdate {
    /// Map a hydrated update once, for every subscriber to share.
    pub fn shared(update: ChannelTimelineUpdate) -> Arc<Self> {
        let channel_id = update.channel_id;
        Arc::new(Self {
            channel_id: ID(channel_id.to_string()),
            seq: update.seq.to_string(),
            messages: update
                .messages
                .into_iter()
                .map(|change| GraphqlChannelMessage::from_change(change, channel_id))
                .collect(),
            activities: update
                .activities
                .into_iter()
                .map(|activity| GraphqlChannelTimelineActivity::from_activity(activity, channel_id))
                .collect(),
            removed_ids: update
                .removed_ids
                .into_iter()
                .map(|id| ID(id.to_string()))
                .collect(),
        })
    }
}

/// A user's subscription to shared, already mapped updates.
type Subscribe = dyn Fn(MacroUserIdStr<'static>) -> BroadcastSubscription<Arc<GraphqlChannelTimelineUpdate>>
    + Send
    + Sync;

/// Request data: where `channelTimelineUpdates` subscriptions get updates.
#[derive(Clone)]
pub struct ChannelTimelineSubscriptions(Arc<Subscribe>);

impl ChannelTimelineSubscriptions {
    /// Subscriptions drawn from `subscribe`, the process-local fan-out.
    pub fn new(
        subscribe: impl Fn(
            MacroUserIdStr<'static>,
        ) -> BroadcastSubscription<Arc<GraphqlChannelTimelineUpdate>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self(Arc::new(subscribe))
    }
}

/// Root GraphQL adapter for live channel timeline updates.
#[derive(Default)]
pub struct ChannelTimelineSubscriptionRoot;

#[Subscription]
impl ChannelTimelineSubscriptionRoot {
    /// Subscribe to committed changes in every channel the authenticated user
    /// participates in. Updates come from memory: subscribing reads nothing
    /// from the database. A subscription that falls behind ends with an error;
    /// subscribe again and catch up each held channel with `channelChanges`.
    async fn channel_timeline_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<Arc<GraphqlChannelTimelineUpdate>>> + 'static,
    > {
        let user_id = require_authenticated_user(ctx)?;
        let subscriptions = ctx.data::<ChannelTimelineSubscriptions>()?;
        let (mut updates, exit_reason) = (subscriptions.0)(user_id).into_parts();

        Ok(async_stream::stream! {
            while let Some(update) = updates.recv().await {
                yield Ok(update);
            }

            match exit_reason.await {
                Ok(ExitReason::SlowConsumer | ExitReason::Lagging { .. }) => {
                    yield Err(async_graphql::Error::new(
                        "channel timeline subscription fell behind; subscribe again and catch up",
                    ));
                }
                Ok(ExitReason::ReceiverClosed | ExitReason::SenderClosed) | Err(_) => {}
            }
        })
    }
}
