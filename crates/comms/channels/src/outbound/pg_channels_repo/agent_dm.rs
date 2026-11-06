//! Atomic agent-DM identity and membership persistence, as direct
//! `comms_channel_agents` rows.

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::{
    agent_dm::{AgentDm, AgentDmRepo, EnsuredAgentDm},
    ports::ChannelMutationErr,
};

use super::{PgChannelsRepo, create_activity};

#[cfg(test)]
mod test;

impl PgChannelsRepo {
    async fn ensure_agent_dm(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> anyhow::Result<EnsuredAgentDm> {
        let mut tx = self.pool.begin().await?;
        // Serialize creation of this pair before creating a channel, so a
        // losing request never leaves an orphan. The unique key is the durable
        // invariant; the transaction-scoped lock also covers membership repair.
        let pair_key = format!("agent-dm:{user_id}:{bot_id}");
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            pair_key,
        )
        .execute(&mut *tx)
        .await?;
        let existing = sqlx::query_scalar!(
            "SELECT channel_id FROM comms_channel_agents WHERE kind = 'direct' AND user_id = $1 AND bot_id = $2",
            user_id.as_ref(),
            bot_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let channel_id = existing.unwrap_or_else(macro_uuid::generate_uuid_v7);
        if existing.is_none() {
            sqlx::query!(
                "INSERT INTO comms_channels (id, channel_type, owner_id)
                 VALUES ($1, 'direct_message', $2)",
                channel_id,
                user_id.as_ref(),
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!(
                "INSERT INTO comms_channel_agents (channel_id, user_id, bot_id, kind)
                 VALUES ($1, $2, $3, 'direct')",
                channel_id,
                user_id.as_ref(),
                bot_id.as_uuid(),
            )
            .execute(&mut *tx)
            .await?;
            create_activity(&mut *tx, channel_id, user_id.as_ref()).await?;
        }
        let bot_principal = bot_id.into_storage_id();
        sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role)
             VALUES ($1, $2, 'owner'), ($1, $3, 'member')
             ON CONFLICT (channel_id, user_id) DO UPDATE SET left_at = NULL",
            channel_id,
            user_id.as_ref(),
            bot_principal.as_ref(),
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(EnsuredAgentDm {
            dm: AgentDm {
                channel_id,
                user_id,
                bot_id,
            },
            created: existing.is_none(),
        })
    }
}

impl AgentDmRepo for PgChannelsRepo {
    async fn for_user(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<AgentDm>, ChannelMutationErr> {
        let rows = sqlx::query!(
            "SELECT channel_id, bot_id FROM comms_channel_agents WHERE kind = 'direct' AND user_id = $1",
            user_id.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(rows
            .into_iter()
            .map(|row| AgentDm {
                channel_id: row.channel_id,
                bot_id: BotId::new_from_uuid(row.bot_id),
                user_id: user_id.clone(),
            })
            .collect())
    }
    async fn ensure(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<EnsuredAgentDm, ChannelMutationErr> {
        self.ensure_agent_dm(user_id, bot_id)
            .await
            .map_err(ChannelMutationErr::Repo)
    }
}
