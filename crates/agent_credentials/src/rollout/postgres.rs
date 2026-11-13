//! Agents' creators from MacroDB's `team_agents` rows.

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;

use super::AgentCreators;

#[cfg(test)]
mod test;

/// Reads `team_agents.created_by`.
#[derive(Clone)]
pub struct PgAgentCreators {
    pool: PgPool,
}

impl PgAgentCreators {
    /// Read from `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentCreators for PgAgentCreators {
    async fn creator_of(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<MacroUserIdStr<'static>>, Report> {
        let created_by = sqlx::query_scalar!(
            "SELECT created_by FROM team_agents WHERE user_id = $1",
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| Report::new(error).into_dynamic())?
        .flatten();

        let Some(created_by) = created_by else {
            return Ok(None);
        };

        let creator = MacroUserIdStr::parse_from_str(&created_by)
            .map_err(|_| rootcause::report!("a stored creator id is malformed"))?
            .into_owned();
        Ok(Some(creator))
    }
}
