//! Agents' creators from MacroDB's `team_agents` rows.

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;

use super::AgentCreators;

#[cfg(test)]
mod test;

/// Reads `team_agents.created_by`, or the team's `owner_id` when the
/// creator's account is gone.
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
        // A deleted creator clears `created_by`; the team's owner then decides.
        let responsible = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(ta.created_by, t.owner_id) AS "responsible!"
            FROM team_agents ta
            JOIN team t ON t.id = ta.team_id
            WHERE ta.user_id = $1
            "#,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| Report::new(error).into_dynamic())?;

        let Some(responsible) = responsible else {
            return Ok(None);
        };

        let creator = MacroUserIdStr::parse_from_str(&responsible)
            .map_err(|_| rootcause::report!("a stored creator id is malformed"))?
            .into_owned();
        Ok(Some(creator))
    }
}
