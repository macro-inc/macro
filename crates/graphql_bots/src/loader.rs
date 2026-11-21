use std::{collections::HashMap, sync::Arc};

use async_graphql::{Context, dataloader::DataLoader};
use bots::domain::models::{BotId, BotIdentity, MAX_BOT_IDENTITY_IDS};
use tracing::Instrument as _;

use crate::{BotsGraphqlContext, GraphqlBot};

/// Batches the bot identities one request's edges ask for.
pub struct BotIdentityLoader {
    context: BotsGraphqlContext,
}

impl async_graphql::dataloader::Loader<BotId> for BotIdentityLoader {
    type Value = BotIdentity;
    type Error = Arc<async_graphql::Error>;

    #[tracing::instrument(name = "bots.load_identities", skip_all, fields(bot_count = keys.len()), err(Debug))]
    async fn load(&self, keys: &[BotId]) -> Result<HashMap<BotId, Self::Value>, Self::Error> {
        let identities = self
            .context
            .reads
            .identities(keys.to_vec())
            .await
            .map_err(|error| Arc::new(error.into()))?;
        Ok(identities
            .into_iter()
            .map(|identity| (identity.id, identity))
            .collect())
    }
}

/// Request-scoped loader of bot identities, for edges such as a session's bot.
pub type BotIdentityDataLoader = DataLoader<BotIdentityLoader>;

/// A loader for one request, over the request's bot reads.
pub fn bot_identity_loader(context: BotsGraphqlContext) -> BotIdentityDataLoader {
    DataLoader::new(BotIdentityLoader { context }, |batch| {
        tokio::spawn(batch.in_current_span())
    })
    .max_batch_size(MAX_BOT_IDENTITY_IDS)
}

/// The bot `bot_id` as it is now, or `None` when no bot has that id. For
/// edges from other domains' objects to the bot they reference.
pub async fn resolve_bot(
    ctx: &Context<'_>,
    bot_id: BotId,
) -> async_graphql::Result<Option<GraphqlBot>> {
    let loader = ctx.data::<BotIdentityDataLoader>()?;
    let identity = loader
        .load_one(bot_id)
        .await
        .map_err(|error| (*error).clone())?;
    Ok(identity.map(Into::into))
}
