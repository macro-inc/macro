//! Reads of the agents conversing in a channel.

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    channel_agents::{ChannelAgent, ChannelAgentKind, ChannelAgentRepo},
    ports::ChannelMutationErr,
};

use super::PgChannelsRepo;

fn kind(kind: &str, user_id: Option<String>) -> anyhow::Result<ChannelAgentKind> {
    match (kind, user_id) {
        ("direct", Some(user_id)) => Ok(ChannelAgentKind::Direct {
            user_id: MacroUserIdStr::try_from(user_id)?,
        }),
        ("member", None) => Ok(ChannelAgentKind::Member),
        (kind, _) => anyhow::bail!("unknown channel agent kind {kind}"),
    }
}

impl ChannelAgentRepo for PgChannelsRepo {
    async fn agents_in(&self, channel_id: Uuid) -> Result<Vec<ChannelAgent>, ChannelMutationErr> {
        let rows = sqlx::query!(
            "SELECT bot_id, kind, user_id FROM comms_channel_agents WHERE channel_id = $1 ORDER BY bot_id",
            channel_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        rows.into_iter()
            .map(|row| {
                Ok(ChannelAgent {
                    channel_id,
                    bot_id: BotId::new_from_uuid(row.bot_id),
                    kind: kind(&row.kind, row.user_id)?,
                })
            })
            .collect()
    }

    async fn find(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<Option<ChannelAgent>, ChannelMutationErr> {
        let row = sqlx::query!(
            "SELECT kind, user_id FROM comms_channel_agents WHERE channel_id = $1 AND bot_id = $2",
            channel_id,
            bot_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        row.map(|row| {
            Ok(ChannelAgent {
                channel_id,
                bot_id,
                kind: kind(&row.kind, row.user_id)?,
            })
        })
        .transpose()
    }
}
