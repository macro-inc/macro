//! Live delivery of changed bot identities to the people who see the bot.
//!
//! Each process reads every bot change off the bot topic, reads the bot's
//! current identity and audience once, and hands the identity to that
//! audience's subscribers on this process. A change nobody here subscribes
//! to is dropped.

#[cfg(all(test, feature = "realtime"))]
mod test;

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, prelude::IntoRootcause as _};

use super::{
    models::{BotId, BotIdentity},
    ports::BotRepo,
};

/// One bot change read off the bot topic.
#[derive(Debug)]
pub struct BotChange {
    /// The bot that was created, updated or deleted.
    pub bot_id: BotId,
    /// The processing span for the change, parented on the trace that
    /// published it, so delivery joins that trace.
    pub span: tracing::Span,
}

/// Source of bot changes, such as the bot topic.
pub trait BotChangeSource: Send + Sync + 'static {
    /// The next change. Cancel-safe.
    fn recv(&self) -> impl Future<Output = Result<BotChange, Report>> + Send;
}

/// The reads one delivery makes.
pub trait BotUpdateReads: Send + Sync + 'static {
    /// The bot's identity as it is now, or `None` when no bot has the id.
    fn identity(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Option<BotIdentity>, Report>> + Send;

    /// The users who see the bot: see [`BotRepo::bot_audience`].
    fn audience(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
}

impl<R: BotRepo + Send + Sync + 'static> BotUpdateReads for R {
    async fn identity(&self, bot_id: BotId) -> Result<Option<BotIdentity>, Report> {
        let mut identities = self
            .get_bot_identities(&[bot_id])
            .await
            .map_err(|error| error.into().into_rootcause())?;
        Ok(identities.remove(&bot_id))
    }

    async fn audience(&self, bot_id: BotId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.bot_audience(bot_id)
            .await
            .map_err(|error| error.into().into_rootcause())
    }
}

/// Why a bot update subscription ended, read after its updates drain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BotUpdatesExit {
    /// The subscription closed normally.
    Closed,
    /// The subscriber's buffer filled; updates were dropped.
    SlowConsumer,
    /// The subscriber fell behind the shared buffer and skipped updates.
    Lagging {
        /// Updates skipped.
        skipped: u64,
    },
}

/// One user's stream of changed bot identities.
pub struct BotUpdateSubscription {
    receiver: tokio::sync::mpsc::Receiver<BotIdentity>,
    exit_reason: tokio::sync::oneshot::Receiver<BotUpdatesExit>,
}

impl BotUpdateSubscription {
    /// A subscription over its update and exit-reason receivers.
    pub fn from_parts(
        receiver: tokio::sync::mpsc::Receiver<BotIdentity>,
        exit_reason: tokio::sync::oneshot::Receiver<BotUpdatesExit>,
    ) -> Self {
        Self {
            receiver,
            exit_reason,
        }
    }

    /// The next changed identity, or `None` once the subscription ends.
    pub async fn recv(&mut self) -> Option<BotIdentity> {
        self.receiver.recv().await
    }

    /// An identity that is already buffered, without waiting.
    pub fn try_recv(&mut self) -> Option<BotIdentity> {
        self.receiver.try_recv().ok()
    }

    /// Why the subscription ended, once its updates are drained.
    pub async fn exit_reason(self) -> BotUpdatesExit {
        self.exit_reason.await.unwrap_or(BotUpdatesExit::Closed)
    }
}

/// Subscriptions to changed bot identities.
pub trait BotUpdateSubscriptions: Send + Sync + 'static {
    /// Changed identities of the bots `user_id` sees.
    fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> BotUpdateSubscription;
}

/// Delivers nothing; for schema-only builds and tests.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoBotUpdates;

impl BotUpdateSubscriptions for NoBotUpdates {
    fn subscribe(&self, _user_id: MacroUserIdStr<'static>) -> BotUpdateSubscription {
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        let (exit_sender, exit_reason) = tokio::sync::oneshot::channel();
        let _ = exit_sender.send(BotUpdatesExit::Closed);
        BotUpdateSubscription::from_parts(receiver, exit_reason)
    }
}

#[cfg(feature = "realtime")]
pub use realtime::BotUpdates;

#[cfg(feature = "realtime")]
mod realtime {
    use std::{num::NonZeroUsize, time::Duration};

    use broadcast::{BroadcastManager, GlobalSpawner};
    use macro_user_id::user_id::MacroUserIdStr;
    use rootcause::{Report, prelude::ResultExt as _};
    use tokio_retry::Retry;
    use tracing::Instrument as _;

    use super::{
        BotChangeSource, BotUpdateReads, BotUpdateSubscription, BotUpdateSubscriptions,
        BotUpdatesExit,
    };
    use crate::domain::models::{BotId, BotIdentity};

    /// Updates retained by each user's shared channel.
    const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();
    /// Updates buffered for each subscriber.
    const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();
    /// Receive attempts before `run` returns for its supervisor to restart.
    const MAX_RECEIVE_ATTEMPTS: usize = 5;

    /// Retries after one, two, four and eight seconds.
    fn receive_retry_strategy() -> impl Iterator<Item = Duration> {
        tokio_retry::strategy::ExponentialBackoff::from_millis(2)
            .factor(500)
            .take(MAX_RECEIVE_ATTEMPTS - 1)
    }

    /// Hands each changed bot's current identity to this process's
    /// subscribers in its audience.
    pub struct BotUpdates<R, C> {
        reads: R,
        source: C,
        broadcasts: BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, BotIdentity>,
    }

    impl<R: BotUpdateReads, C: BotChangeSource> BotUpdates<R, C> {
        /// Delivery of `source`'s changes, reading through `reads`. Read the
        /// primary: a change arrives right after its write commits.
        pub fn new(reads: R, source: C) -> Self {
            Self {
                reads,
                source,
                broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
            }
        }

        /// Delivers changes until receiving fails repeatedly. Run it in a
        /// supervised task that restarts it.
        #[tracing::instrument(name = "bots.updates", skip(self), err)]
        pub async fn run(&self) -> Result<(), Report> {
            loop {
                let change = Retry::start(receive_retry_strategy(), || self.source.recv())
                    .await
                    .context(format!(
                        "failed to receive a bot change after {MAX_RECEIVE_ATTEMPTS} attempts"
                    ))?;
                let span = change.span;
                // A failed delivery is logged on its span; later changes still go out.
                let _ = self.deliver(change.bot_id).instrument(span).await;
            }
        }

        /// Hands `bot_id`'s current identity to its audience's subscribers here.
        #[tracing::instrument(
            name = "bots.deliver_update",
            skip(self),
            fields(%bot_id, audience, delivered),
            err
        )]
        async fn deliver(&self, bot_id: BotId) -> Result<(), Report> {
            let Some(identity) = self.reads.identity(bot_id).await? else {
                tracing::warn!("changed bot has no identity");
                return Ok(());
            };
            let audience = self.reads.audience(bot_id).await?;
            let span = tracing::Span::current();
            span.record("audience", audience.len());
            let delivered = audience
                .iter()
                .filter(|user| self.broadcasts.publish(user, identity.clone()).is_ok())
                .count();
            span.record("delivered", delivered);
            Ok(())
        }
    }

    impl<R: BotUpdateReads, C: BotChangeSource> BotUpdateSubscriptions for BotUpdates<R, C> {
        fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> BotUpdateSubscription {
            let (receiver, broadcast_exit) = self
                .broadcasts
                .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
                .into_parts();
            let (exit_sender, exit_reason) = tokio::sync::oneshot::channel();
            tokio::spawn(async move {
                let reason = match broadcast_exit.await {
                    Ok(broadcast::ExitReason::SlowConsumer) => BotUpdatesExit::SlowConsumer,
                    Ok(broadcast::ExitReason::Lagging { skipped }) => {
                        BotUpdatesExit::Lagging { skipped }
                    }
                    Ok(
                        broadcast::ExitReason::ReceiverClosed | broadcast::ExitReason::SenderClosed,
                    )
                    | Err(_) => BotUpdatesExit::Closed,
                };
                let _ = exit_sender.send(reason);
            });
            BotUpdateSubscription::from_parts(receiver, exit_reason)
        }
    }
}
