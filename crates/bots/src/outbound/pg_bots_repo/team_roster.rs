//! Team bot roster for team deletion, owned by the bots adapter.

#[cfg(test)]
mod test;

use bot_id::BotId;
use rootcause::{Report, prelude::*};
use uuid::Uuid;

use super::PgBotsRepo;
use crate::domain::ports::TeamBotRoster;

impl TeamBotRoster for PgBotsRepo {
    #[tracing::instrument(skip(self), err)]
    async fn team_bot_ids(&self, team_id: Uuid) -> Result<Vec<BotId>, Report> {
        let ids = sqlx::query_scalar!(
            r#"
            SELECT id
            FROM bots
            WHERE team_id = $1
            ORDER BY id
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("unable to list the bots of a team")?;
        Ok(ids.into_iter().map(BotId::new_from_uuid).collect())
    }
}
