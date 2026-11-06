//! Keep an agent's credential rotation serialized across auth replicas.

use hosted_runtimes::domain::{ids::ComputerId, persona_credentials::PersonaCredentialError};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use super::PgTeamAgentsRepo;
use crate::domain::{
    enrollment::{EnrollmentAccounts, EnrollmentAgent, EnrollmentContext},
    models::PersonaSeed,
};

impl EnrollmentAccounts for PgTeamAgentsRepo {
    type Guard = sqlx::Transaction<'static, sqlx::Postgres>;

    async fn enrollment_context(
        &self,
        computer: ComputerId,
        candidate: Option<&MacroUserIdStr<'_>>,
        team: uuid::Uuid,
    ) -> Result<EnrollmentContext<Self::Guard>, PersonaCredentialError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        // Do not acquire hosted_runtimes' enrollment advisory lock: the caller
        // already holds it while invoking this internal service.
        let agent = sqlx::query!(
            r#"SELECT a.user_id, a.team_id, a.created_by,
                      a.persona_seed AS "persona_seed: sqlx::types::Json<PersonaSeed>",
                      u."isAgent" AS "is_agent!"
               FROM team_agents a JOIN "User" u ON u.id = a.user_id
               WHERE a.computer_id = $1 OR (a.computer_id IS NULL AND a.user_id = $2 AND a.team_id = $3)
               FOR UPDATE OF a"#,
            computer.as_uuid(),
            candidate.map(|id| id.as_ref()),
            team,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        let agent = agent
            .map(|agent| {
                let mut seed = agent
                    .persona_seed
                    .ok_or(PersonaCredentialError::IssuanceFailed)?
                    .0;
                if seed.creator_id.is_none() {
                    seed.creator_id = agent
                        .created_by
                        .map(|raw| {
                            MacroUserIdStr::parse_from_str(&raw)
                                .map(MacroUserIdStr::into_owned)
                                .map_err(|_| PersonaCredentialError::IssuanceFailed)
                        })
                        .transpose()?;
                }
                Ok::<_, PersonaCredentialError>(EnrollmentAgent {
                    user_id: MacroUserIdStr::parse_from_str(&agent.user_id)
                        .map(MacroUserIdStr::into_owned)
                        .map_err(|_| PersonaCredentialError::IssuanceFailed)?,
                    team_id: agent.team_id,
                    is_agent: agent.is_agent,
                    seed,
                })
            })
            .transpose()?;
        Ok(EnrollmentContext { agent, guard: tx })
    }
    async fn finish_enrollment(
        &self,
        mut guard: Self::Guard,
        computer: ComputerId,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), PersonaCredentialError> {
        // The fleet may run before the invite handler records purchase's ID.
        // Claim an unbound account under the same lock, never another computer's.
        let updated = sqlx::query!(
            r#"UPDATE team_agents SET computer_id = $1
               WHERE user_id = $2 AND (computer_id IS NULL OR computer_id = $1)"#,
            computer.as_uuid(),
            agent.as_ref(),
        )
        .execute(&mut *guard)
        .await
        .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        if updated.rows_affected() != 1 {
            return Err(PersonaCredentialError::NotFound);
        }
        guard
            .commit()
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)
    }
}
