//! Object-safe bot lookup used while routing triggers.

use async_trait::async_trait;
use bot_id::BotId;
use bots::domain::models::Bot;
use bots::domain::ports::BotRepo;

/// Object-safe lookup for bots by id, regardless of caller. Implemented by any
/// [`BotRepo`].
#[async_trait]
pub trait BotDirectory: Send + Sync {
    /// Fetch a bot by id, if it exists and is not deleted.
    async fn get_bot(&self, bot_id: BotId) -> anyhow::Result<Option<Bot>>;
}

#[async_trait]
impl<R: BotRepo> BotDirectory for R {
    async fn get_bot(&self, bot_id: BotId) -> anyhow::Result<Option<Bot>> {
        BotRepo::get_bot(self, bot_id).await.map_err(Into::into)
    }
}
