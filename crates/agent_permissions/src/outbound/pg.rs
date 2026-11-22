//! [`PermissionStore`] over MacroDB: `agent_permission_policy` (one row per
//! policy, under a stable id: an owned agent's, or a person's for a built-in
//! persona), `agent_permission_rule` (a policy's saved settings) and
//! `agent_session_tool_permission` (an agent's restrictions on itself for one
//! session). Every query is a lookup by a unique key or its table's
//! primary-key prefix. Writes take a transaction-scoped advisory lock per
//! policy and per session, so a check and the write it allows see the same
//! rules; a gate reads the policy and the overlay in one read-only snapshot.
//!
//! `agent_tool_permission` and `persona_tool_permission`, which held the
//! settings before policies had ids, are no longer read or written.

#[cfg(test)]
mod test;

use agent_fold::domain::log::AgentSessionId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, PgPool};

use crate::domain::model::{
    Change, PermissionError, PolicyId, PolicyOwner, Rule, SetBy, Target, TargetKind,
};
use crate::domain::ports::{PermissionStore, Write, WriteTo};

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
    (via_agent, restriction_only): (bool, bool),
    updated_at: DateTime<Utc>,
) -> Result<Rule, PgPermissionStoreError> {
    let corrupt = || PgPermissionStoreError::Corrupt(format!("{kind} {target} {state}"));
    let kind: TargetKind = kind.parse().map_err(|_| corrupt())?;
    Ok(Rule {
        target: Target::from_stored(kind, target).ok_or_else(corrupt)?,
        state: state.parse().map_err(|_| corrupt())?,
        via_agent,
        restriction_only,
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

/// The advisory lock key of a policy or a session, hashed by Postgres.
fn lock_key(policy: Option<PolicyId>, session: Option<AgentSessionId>) -> String {
    match (policy, session) {
        (Some(policy), _) => format!("agent_permission_policy:{policy}"),
        (None, Some(session)) => {
            format!("agent_session_tool_permission:{}", session.as_uuid())
        }
        (None, None) => String::new(),
    }
}

/// The isolation a gate's read runs at: its two statements see one snapshot,
/// so a write committing between them can't pair the policy before it with
/// the overlay after it. Read only, so it never blocks a writer.
const SNAPSHOT: &str = "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY";

async fn lock(connection: &mut PgConnection, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key,)
        .fetch_one(connection)
        .await?;
    Ok(())
}

/// The id of `owner`'s policy, if it has one.
async fn find_policy(
    connection: &mut PgConnection,
    owner: &PolicyOwner,
) -> Result<Option<PolicyId>, sqlx::Error> {
    let id = match owner {
        PolicyOwner::Agent(agent) => {
            sqlx::query_scalar!(
                r#"
                SELECT id FROM agent_permission_policy
                WHERE bot_id = $1
                "#,
                agent.as_uuid(),
            )
            .fetch_optional(connection)
            .await?
        }
        PolicyOwner::Persona { persona, user } => {
            sqlx::query_scalar!(
                r#"
                SELECT id FROM agent_permission_policy
                WHERE user_id = $1 AND persona_id = $2
                "#,
                user.as_ref(),
                persona.as_uuid(),
            )
            .fetch_optional(connection)
            .await?
        }
    };
    Ok(id.map(PolicyId::from_uuid))
}

/// Create `owner`'s policy under `id` unless it already has one; `None` when
/// it did (perhaps made by a concurrent call).
async fn insert_policy(
    connection: &mut PgConnection,
    owner: &PolicyOwner,
    id: PolicyId,
) -> Result<Option<PolicyId>, sqlx::Error> {
    let inserted = match owner {
        PolicyOwner::Agent(agent) => {
            sqlx::query_scalar!(
                r#"
                INSERT INTO agent_permission_policy (id, kind, bot_id)
                VALUES ($1, 'agent', $2)
                ON CONFLICT (bot_id) WHERE bot_id IS NOT NULL DO NOTHING
                RETURNING id
                "#,
                id.as_uuid(),
                agent.as_uuid(),
            )
            .fetch_optional(connection)
            .await?
        }
        PolicyOwner::Persona { persona, user } => {
            sqlx::query_scalar!(
                r#"
                INSERT INTO agent_permission_policy (id, kind, user_id, persona_id)
                VALUES ($1, 'persona', $2, $3)
                ON CONFLICT (user_id, persona_id) WHERE user_id IS NOT NULL DO NOTHING
                RETURNING id
                "#,
                id.as_uuid(),
                user.as_ref(),
                persona.as_uuid(),
            )
            .fetch_optional(connection)
            .await?
        }
    };
    Ok(inserted.map(PolicyId::from_uuid))
}

async fn policy_rules(
    connection: &mut PgConnection,
    policy: PolicyId,
) -> Result<Vec<Rule>, PgPermissionStoreError> {
    sqlx::query!(
        r#"
        SELECT kind, target, state, via_agent, restriction_only, updated_at
        FROM agent_permission_rule
        WHERE policy_id = $1
        "#,
        policy.as_uuid(),
    )
    .fetch_all(connection)
    .await?
    .into_iter()
    .map(|row| {
        rule(
            &row.kind,
            &row.target,
            &row.state,
            (row.via_agent, row.restriction_only),
            row.updated_at,
        )
    })
    .collect()
}

async fn overlay_rules(
    connection: &mut PgConnection,
    session: AgentSessionId,
) -> Result<Vec<Rule>, PgPermissionStoreError> {
    // Only the agent restricts a session, so every row is via the agent.
    sqlx::query!(
        r#"
        SELECT kind, target, state, created_at
        FROM agent_session_tool_permission
        WHERE agent_session_id = $1
        "#,
        session.as_uuid(),
    )
    .fetch_all(connection)
    .await?
    .into_iter()
    .map(|row| {
        rule(
            &row.kind,
            &row.target,
            &row.state,
            (true, true),
            row.created_at,
        )
    })
    .collect()
}

async fn save_policy(
    connection: &mut PgConnection,
    policy: PolicyId,
    batch: &Batch,
    by: &MacroUserIdStr<'static>,
    set_by: SetBy,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM agent_permission_rule
        WHERE policy_id = $1
          AND (kind, target) IN (SELECT * FROM UNNEST($2::text[], $3::text[]))
        "#,
        policy.as_uuid(),
        &batch.delete_kinds,
        &batch.delete_targets,
    )
    .execute(&mut *connection)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO agent_permission_rule
            (policy_id, kind, target, state, updated_by, via_agent, restriction_only)
        SELECT $1, kind, target, state, $5, $6, $7
        FROM UNNEST($2::text[], $3::text[], $4::text[]) AS change (kind, target, state)
        ON CONFLICT (policy_id, kind, target) DO UPDATE
        SET state = EXCLUDED.state,
            updated_by = EXCLUDED.updated_by,
            via_agent = EXCLUDED.via_agent,
            restriction_only = EXCLUDED.restriction_only,
            updated_at = now()
        "#,
        policy.as_uuid(),
        &batch.upsert_kinds,
        &batch.upsert_targets,
        &batch.upsert_states,
        by.as_ref(),
        set_by.via_agent(),
        set_by.restriction_only(),
    )
    .execute(&mut *connection)
    .await?;
    Ok(())
}

async fn save_overlay(
    connection: &mut PgConnection,
    session: AgentSessionId,
    batch: &Batch,
    by: &MacroUserIdStr<'static>,
) -> Result<(), sqlx::Error> {
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
    .execute(&mut *connection)
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
    .execute(&mut *connection)
    .await?;
    Ok(())
}

impl PermissionStore for PgPermissionStore {
    type Err = PgPermissionStoreError;

    #[tracing::instrument(skip_all, err)]
    async fn ensure_policy(&self, owner: &PolicyOwner) -> Result<PolicyId, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        if let Some(id) = find_policy(&mut connection, owner).await? {
            return Ok(id);
        }
        if let Some(id) = insert_policy(&mut connection, owner, PolicyId::generate()).await? {
            return Ok(id);
        }
        // A concurrent call created it between the two statements.
        find_policy(&mut connection, owner)
            .await?
            .ok_or_else(|| PgPermissionStoreError::Corrupt("policy vanished on create".to_owned()))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn rules(&self, policy: PolicyId) -> Result<Vec<Rule>, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        policy_rules(&mut connection, policy).await
    }

    #[tracing::instrument(skip_all, err)]
    async fn session_rules(&self, session: AgentSessionId) -> Result<Vec<Rule>, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        overlay_rules(&mut connection, session).await
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn rules_with_session(
        &self,
        policy: PolicyId,
        session: AgentSessionId,
    ) -> Result<(Vec<Rule>, Vec<Rule>), Self::Err> {
        let mut snapshot = self.pool.begin_with(SNAPSHOT).await?;
        let saved = policy_rules(&mut snapshot, policy).await?;
        let overlay = overlay_rules(&mut snapshot, session).await?;
        snapshot.commit().await?;
        Ok((saved, overlay))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %write.policy), err)]
    async fn write<Plan>(
        &self,
        write: Write<'_>,
        plan: Plan,
    ) -> Result<Result<(), PermissionError>, Self::Err>
    where
        Plan: FnOnce(&[Rule], &[Rule]) -> Result<Vec<Change>, PermissionError> + Send,
    {
        let mut transaction = self.pool.begin().await?;

        // Policy first, then session: every writer locks in this order.
        lock(&mut transaction, &lock_key(Some(write.policy), None)).await?;
        if let Some(session) = write.session {
            lock(&mut transaction, &lock_key(None, Some(session))).await?;
        }

        let saved = policy_rules(&mut transaction, write.policy).await?;
        let overlay = match write.session {
            Some(session) => overlay_rules(&mut transaction, session).await?,
            None => Vec::new(),
        };
        let changes = match plan(&saved, &overlay) {
            Ok(changes) => changes,
            Err(refused) => return Ok(Err(refused)),
        };

        let batch = Batch::new(&changes);
        match write.to {
            WriteTo::Saved => {
                save_policy(
                    &mut transaction,
                    write.policy,
                    &batch,
                    write.by,
                    write.set_by,
                )
                .await?;
            }
            WriteTo::Session(session) => {
                save_overlay(&mut transaction, session, &batch, write.by).await?;
            }
        }
        transaction.commit().await?;
        Ok(Ok(()))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn reset(&self, policy: PolicyId) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        lock(&mut transaction, &lock_key(Some(policy), None)).await?;
        sqlx::query!(
            "DELETE FROM agent_permission_rule WHERE policy_id = $1",
            policy.as_uuid(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}
