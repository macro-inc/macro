use async_graphql::{Context, ID, Object};
use bots::domain::models::{BotId, MAX_BOT_IDENTITY_IDS};
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::{BotsGraphqlContext, GraphqlBot, errors::BotReadError};

/// Flattenable bot fields of the authenticated user.
pub struct GraphqlBotsQuery {
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlBotsQuery {
    /// Bot fields for the authenticated `user_id`; the reads come from
    /// request data per field.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }
}

/// Bot fields of the authenticated user.
#[Object]
impl GraphqlBotsQuery {
    /// The bots with these ids, in request order, each once. Any signed-in
    /// user may read the identity of a bot id they hold; ids no bot has are
    /// left out. At most 100 ids.
    #[tracing::instrument(skip_all, fields(bot_count = ids.len()), err(Debug))]
    async fn bots(
        &self,
        ctx: &Context<'_>,
        ids: Vec<ID>,
    ) -> async_graphql::Result<Vec<GraphqlBot>> {
        if ids.len() > MAX_BOT_IDENTITY_IDS {
            return Err(BotReadError::BadInput(format!(
                "at most {MAX_BOT_IDENTITY_IDS} bot ids may be requested"
            ))
            .into());
        }
        let ids = ids
            .into_iter()
            .map(|id| parse_id(id, "ids").map(BotId::new_from_uuid))
            .collect::<async_graphql::Result<Vec<_>>>()?;
        let context = ctx.data::<BotsGraphqlContext>()?;
        let identities = context.reads.identities(ids).await?;
        Ok(identities.into_iter().map(Into::into).collect())
    }

    /// Bots the user can `@` mention. In a channel (`channelId`, which the
    /// user must belong to): its installed bots, then the user's agents
    /// available in every channel. Elsewhere: every agent the user can
    /// start. Each bot once.
    #[tracing::instrument(skip_all, fields(channel_id = ?channel_id), err(Debug))]
    async fn mentionable_bots(
        &self,
        ctx: &Context<'_>,
        channel_id: Option<ID>,
    ) -> async_graphql::Result<Vec<GraphqlBot>> {
        let channel_id = channel_id
            .map(|channel_id| parse_id(channel_id, "channelId"))
            .transpose()?;
        let context = ctx.data::<BotsGraphqlContext>()?;
        let bots = context
            .reads
            .mentionable_bots(self.user_id.clone(), channel_id)
            .await?;
        Ok(bots.into_iter().map(Into::into).collect())
    }
}

/// The bots installed in a channel, for its `bots` edge, or `None` when the
/// viewer is not a member of the channel (the check `GET /channels/{id}/bots`
/// makes). Not an error: a Soup list can hold channels the viewer has not
/// joined, and an error there would fail the whole row.
#[tracing::instrument(skip(ctx), err(Debug))]
pub async fn resolve_channel_bots(
    ctx: &Context<'_>,
    channel_id: Uuid,
) -> async_graphql::Result<Option<Vec<GraphqlBot>>> {
    let viewer = require_authenticated_user(ctx)?;
    let context = ctx.data::<BotsGraphqlContext>()?;
    match context.reads.channel_bots(viewer, channel_id).await {
        Ok(bots) => Ok(Some(bots.into_iter().map(Into::into).collect())),
        Err(BotReadError::Forbidden) => Ok(None),
        Err(error) => Err(error.into()),
    }
}
