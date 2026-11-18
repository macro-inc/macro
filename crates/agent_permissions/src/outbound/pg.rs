//! [`PermissionStore`] over MacroDB: `agent_tool_permission` (owned agents),
//! `persona_tool_permission` (a person's settings for a built-in persona) and
//! `agent_session_tool_permission` (an agent's restrictions on itself for one
//! session). Every query is a lookup by its table's primary-key prefix.

#[cfg(test)]
mod test;

use agent_fold::domain::log::AgentSessionId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::model::{Change, PolicyOwner, Rule, Target, TargetKind};
use crate::domain::ports::PermissionStore;

/// Why the store failed.
#[derive(Debug, thiserror::Error)]
pub enum PgPermissionStoreError {
    /// The database failed.
    #[error("database error")]
    Database(#[from] sqlx::Error),
    /// A stored row is not a valid setting; the table's checks should make
    /// this impossible.
    #[error("invalid stored permission: {0}")]
    Corrupt(String),
}

/// [`PermissionStore`] over a MacroDB pool.
#[derive(Clone)]
pub struct PgPermissionStore {
    pool: PgPool,
}

impl PgPermissionStore {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn rule(
    kind: &str,
    target: &str,
    state: &str,
    via_agent: bool,
    updated_at: DateTime<Utc>,
) -> Result<Rule, PgPermissionStoreError> {
    let corrupt = || PgPermissionStoreError::Corrupt(format!("{kind} {target} {state}"));
    let kind: TargetKind = kind.parse().map_err(|_| corrupt())?;
    Ok(Rule {
        target: Target::from_stored(kind, target).ok_or_else(corrupt)?,
        state: state.parse().map_err(|_| corrupt())?,
        via_agent,
        updated_at,
    })
}

/// A batch of changes as parallel arrays for `UNNEST`: the upserts
/// (kind, target, state) and the deletes (kind, target).
#[derive(Default)]
struct Batch {
    upsert_kinds: Vec<String>,
    upsert_targets: Vec<String>,
    upsert_states: Vec<String>,
    delete_kinds: Vec<String>,
    delete_targets: Vec<String>,
}

impl Batch {
    fn new(changes: &[Change]) -> Self {
        let mut batch = Batch::default();
        for change in changes {
            let kind: &'static str = change.target.kind().into();
            match change.state {
                Some(state) => {
                    let state: &'static str = state.into();
                    batch.upsert_kinds.push(kind.to_owned());
                    batch.upsert_targets.push(change.target.key());
                    batch.upsert_states.push(state.to_owned());
                }
                None => {
                    batch.delete_kinds.push(kind.to_owned());
                    batch.delete_targets.push(change.target.key());
                }
            }
        }
        batch
    }
}

impl PermissionStore for PgPermissionStore {
    type Err = PgPermissionStoreError;

    #[tracing::instrument(skip_all, err)]
    async fn rules(&self, owner: &PolicyOwner) -> Result<Vec<Rule>, Self::Err> {
        match owner {
            PolicyOwner::Agent(agent) => sqlx::query!(
                r#"
                SELECT kind, target, state, via_agent, updated_at
                FROM agent_tool_permission
                WHERE bot_id = $1
                "#,
                agent.as_uuid(),
            )
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| rule(&row.kind, &row.target, &row.state, row.via_agent, row.updated_at))
            .collect(),
            PolicyOwner::Persona { persona, user } => sqlx::query!(
                r#"
                SELECT kind, target, state, via_agent, updated_at
                FROM persona_tool_permission
                WHERE user_id = $1 AND persona_id = $2
                "#,
                user.as_ref(),
                persona.as_uuid(),
            )
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| rule(&row.kind, &row.target, &row.state, row.via_agent, row.updated_at))
            .collect(),
        }
    }

    #[tracing::instrument(skip_all, err)]
    async fn session_rules(&self, session: AgentSessionId) -> Result<Vec<Rule>, Self::Err> {
        // Only the agent restricts a session, so every row is via the agent.
        sqlx::query!(
            r#"
            SELECT kind, target, state, created_at
            FROM agent_session_tool_permission
            WHERE agent_session_id = $1
            "#,
            session.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| rule(&row.kind, &row.target, &row.state, true, row.created_at))
        .collect()
    }

    #[tracing::instrument(skip_all, fields(changes = changes.len()), err)]
    async fn apply(
        &self,
        owner: &PolicyOwner,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
        via_agent: bool,
    ) -> Result<(), Self::Err> {
        let batch = Batch::new(changes);
        let mut transaction = self.pool.begin().await?;
        match owner {
            PolicyOwner::Agent(agent) => {
                sqlx::query!(
                    r#"
                    DELETE FROM agent_tool_permission
                    WHERE bot_id = $1
                      AND (kind, target) IN (SELECT * FROM UNNEST($2::text[], $3::text[]))
                    "#,
                    agent.as_uuid(),
                    &batch.delete_kinds,
                    &batch.delete_targets,
                )
                .execute(&mut *transaction)
                .await?;
                sqlx::query!(
                    r#"
                    INSERT INTO agent_tool_permission
                        (bot_id, kind, target, state, updated_by, via_agent)
                    SELECT $1, kind, target, state, $5, $6
                    FROM UNNEST($2::text[], $3::text[], $4::text[]) AS change (kind, target, state)
                    ON CONFLICT (bot_id, kind, target) DO UPDATE
                    SET state = EXCLUDED.state,
                        updated_by = EXCLUDED.updated_by,
                        via_agent = EXCLUDED.via_agent,
                        updated_at = now()
                    "#,
                    agent.as_uuid(),
                    &batch.upsert_kinds,
                    &batch.upsert_targets,
                    &batch.upsert_states,
                    by.as_ref(),
                    via_agent,
                )
                .execute(&mut *transaction)
                .await?;
            }
            PolicyOwner::Persona { persona, user } => {
                sqlx::query!(
                    r#"
                    DELETE FROM persona_tool_permission
                    WHERE user_id = $1 AND persona_id = $2
                      AND (kind, target) IN (SELECT * FROM UNNEST($3::text[], $4::text[]))
                    "#,
                    user.as_ref(),
                    persona.as_uuid(),
                    &batch.delete_kinds,
                    &batch.delete_targets,
                )
                .execute(&mut *transaction)
                .await?;
                sqlx::query!(
                    r#"
                    INSERT INTO persona_tool_permission
                        (user_id, persona_id, kind, target, state, via_agent)
                    SELECT $1, $2, kind, target, state, $6
                    FROM UNNEST($3::text[], $4::text[], $5::text[]) AS change (kind, target, state)
                    ON CONFLICT (user_id, persona_id, kind, target) DO UPDATE
                    SET state = EXCLUDED.state,
                        via_agent = EXCLUDED.via_agent,
                        updated_at = now()
                    "#,
                    user.as_ref(),
                    persona.as_uuid(),
                    &batch.upsert_kinds,
                    &batch.upsert_targets,
                    &batch.upsert_states,
                    via_agent,
                )
                .execute(&mut *transaction)
                .await?;
            }
        }
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(changes = changes.len()), err)]
    async fn apply_session(
        &self,
        session: AgentSessionId,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
    ) -> Result<(), Self::Err> {
        let batch = Batch::new(changes);
        let mut transaction = self.pool.begin().await?;
        sqlx::query!(
            r#"
            DELETE FROM agent_session_tool_permission
            WHERE agent_session_id = $1
              AND (kind, target) IN (SELECT * FROM UNNEST($2::text[], $3::text[]))
            "#,
            session.as_uuid(),
            &batch.delete_kinds,
            &batch.delete_targets,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO agent_session_tool_permission
                (agent_session_id, kind, target, state, set_by)
            SELECT $1, kind, target, state, $5
            FROM UNNEST($2::text[], $3::text[], $4::text[]) AS change (kind, target, state)
            ON CONFLICT (agent_session_id, kind, target) DO UPDATE
            SET state = EXCLUDED.state,
                set_by = EXCLUDED.set_by,
                created_at = now()
            "#,
            session.as_uuid(),
            &batch.upsert_kinds,
            &batch.upsert_targets,
            &batch.upsert_states,
            by.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn reset(&self, owner: &PolicyOwner) -> Result<(), Self::Err> {
        match owner {
            PolicyOwner::Agent(agent) => {
                sqlx::query!(
                    "DELETE FROM agent_tool_permission WHERE bot_id = $1",
                    agent.as_uuid(),
                )
                .execute(&self.pool)
                .await?;
            }
            PolicyOwner::Persona { persona, user } => {
                sqlx::query!(
                    "DELETE FROM persona_tool_permission WHERE user_id = $1 AND persona_id = $2",
                    user.as_ref(),
                    persona.as_uuid(),
                )
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }
}
