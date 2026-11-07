//! Runtime-routing assignment reads owned by bots, and deleting the agents
//! of a harness that is going away.
use super::{PgBotsRepo, principal_id, require_persisted_owner};
use crate::domain::models::BotOwner;
use crate::domain::ports::HarnessAssignments;
use anyhow::Context;
use bot_id::BotId;
use harness_id::HarnessId;

impl PgBotsRepo {
    pub(super) async fn delete_harness_agents_inner(
        &self,
        harness: HarnessId,
    ) -> anyhow::Result<Vec<(BotId, BotOwner)>> {
        let mut tx = self.pool.begin().await?;
        let rows = sqlx::query!(
            r#"
            UPDATE bots
            SET deleted_at = now(), updated_at = now()
            FROM agent_configs
            WHERE agent_configs.bot_id = bots.id
              AND agent_configs.harness_id = $1
              AND bots.kind = 'owned'
              AND bots.deleted_at IS NULL
            RETURNING bots.id, bots.owner_user_id, bots.team_id
            "#,
            harness.as_uuid(),
        )
        .fetch_all(&mut *tx)
        .await
        .context("failed to soft-delete the harness's agents")?;

        let mut deleted = Vec::with_capacity(rows.len());
        for row in rows {
            let owner = require_persisted_owner(row.id, row.owner_user_id, row.team_id)?;
            deleted.push((BotId::new_from_uuid(row.id), owner));
        }

        let principals: Vec<String> = deleted
            .iter()
            .map(|(bot_id, _)| principal_id(*bot_id))
            .collect();
        sqlx::query!(
            r#"
            UPDATE comms_channel_participants
            SET left_at = now()
            WHERE user_id = ANY($1)
              AND left_at IS NULL
            "#,
            &principals,
        )
        .execute(&mut *tx)
        .await
        .context("failed to remove the harness's deleted agents from channels")?;

        tx.commit().await?;
        Ok(deleted)
    }
}

impl HarnessAssignments for PgBotsRepo {
    type Err = sqlx::Error;

    async fn harness_for(&self, bot: BotId) -> Result<Option<HarnessId>, Self::Err> {
        let id = sqlx::query_scalar!(
            "SELECT harness_id FROM agent_configs WHERE bot_id = $1",
            bot.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(id.flatten().map(HarnessId::new_from_uuid))
    }

    async fn bots_on_harness(&self, harness: HarnessId) -> Result<Vec<BotId>, Self::Err> {
        let ids = sqlx::query_scalar!(
            "SELECT bot_id FROM agent_configs WHERE harness_id = $1",
            harness.as_uuid()
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(ids.into_iter().map(BotId::new_from_uuid).collect())
    }
}
