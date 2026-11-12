//! Which agent teammate each computer runs: `agent_user_id` on the computer,
//! or on its reservation while the purchase is confirming.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{PgComputerError, PgComputerRepo};
use crate::domain::{agent::ComputerAgents, ids::ComputerId};

impl ComputerAgents for PgComputerRepo {
    type Error = PgComputerError;

    #[tracing::instrument(skip(self), err)]
    async fn agent_of(
        &self,
        computer: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, PgComputerError> {
        let agent = sqlx::query_scalar!(
            r#"
            SELECT agent_user_id FROM hosted_runtime WHERE id = $1
            UNION ALL
            SELECT agent_user_id FROM computer_reservation WHERE id = $1
            LIMIT 1
            "#,
            computer.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        agent
            .map(|agent| {
                MacroUserIdStr::try_from(agent).map_err(|_| {
                    PgComputerError::Corrupt("agent_user_id is not a Macro user id".to_owned())
                })
            })
            .transpose()
    }

    #[tracing::instrument(skip(self, agent), err)]
    async fn computer_for_agent(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<ComputerId>, PgComputerError> {
        // A purchase still confirming counts: its id is the future computer's.
        let id = sqlx::query_scalar!(
            r#"
            SELECT id AS "id!" FROM hosted_runtime WHERE team_id = $1 AND agent_user_id = $2
            UNION ALL
            SELECT id AS "id!" FROM computer_reservation WHERE team_id = $1 AND agent_user_id = $2
            LIMIT 1
            "#,
            team_id,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(id.map(ComputerId::new_from_uuid))
    }

    #[tracing::instrument(skip(self, agent), err)]
    async fn has_live_computer(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<bool, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM hosted_runtime
                WHERE team_id = $1 AND agent_user_id = $2
                  AND (state->'phase'->>'phase') <> 'destroying'
            ) AS "live!"
            "#,
            team_id,
            agent.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?)
    }
}
