//! Runtime-routing assignment reads owned by bots.
use super::PgBotsRepo;
use crate::domain::ports::HarnessAssignments;
use bot_id::BotId;
use harness_id::HarnessId;

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
