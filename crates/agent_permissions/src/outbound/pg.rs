//! [`PermissionStore`] over MacroDB: `agent_permission_policy` (one row per
//! policy, under a stable id: an owned agent's, or a person's for a built-in
//! persona; an agent's may follow another policy, its source),
//! `agent_permission_rule` (a policy's saved settings) and
//! `agent_session_tool_permission` (an agent's restrictions on itself for one
//! session). Every query is a lookup by a unique key or its table's
//! primary-key prefix; a chain is a recursive walk of at most
//! `MAX_CHAIN + 1` primary-key lookups, and a policy's followers a walk of
//! `agent_permission_policy_source_idx` as deep. Writes take a
//! transaction-scoped advisory lock per policy and per session, so a check
//! and the write it allows see the same rules; every source change takes one
//! global lock first, so no two can each pass the cycle check the other
//! breaks. A gate reads the chain and the overlay in one read-only snapshot.
//!
//! `agent_tool_permission` and `persona_tool_permission`, which held the
//! settings before policies had ids, are no longer read or written.

#[cfg(test)]
mod test;

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, PgPool};

use crate::domain::model::{
    ChainError, Change, Follows, MAX_CHAIN, PermissionError, PolicyChain, PolicyId, PolicyLevel,
    PolicyOwner, Rule, SetBy, Target, TargetKind,
};
use crate::domain::ports::{PermissionStore, SourceWrite, Write, WriteTo};

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
    /// Stored policies do not form a chain; setting a source refuses
    /// anything that would, so only hand-edited data can.
    #[error("invalid stored policy chain")]
    Chain(#[from] ChainError),
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

/// The lock every change to any policy's source takes first, before a
/// policy's: the cycle and depth checks then see a graph nobody else can
/// change until they commit.
const SOURCES_LOCK: &str = "agent_permission_policy:sources";

/// How far a chain or follower walk goes: one level past the limit, which
/// tells a chain that is too long from one that just fits.
const WALK_DEPTH: i32 = MAX_CHAIN as i32;

/// The isolation a gate's read runs at: its two statements (the chain with
/// its rules, then the overlay) see one snapshot, so a write committing
/// between them can't pair the policy before it with the overlay after it.
/// Read only, so it never blocks a writer.
const SNAPSHOT: &str = "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY";

/// A source change walks the policy's followers, whose count grows with how
/// many agents follow it (about 12 ms for ten thousand); bound it anyway.
async fn bound_source_walk(connection: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(connection)
        .await?;
    Ok(())
}

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
        PolicyOwner::Team(team) => {
            sqlx::query_scalar!(
                r#"
                SELECT id FROM agent_permission_policy
                WHERE team_id = $1
                "#,
                team,
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
        PolicyOwner::Team(team) => {
            sqlx::query_scalar!(
                r#"
                INSERT INTO agent_permission_policy (id, kind, team_id)
                VALUES ($1, 'team', $2)
                ON CONFLICT (team_id) WHERE team_id IS NOT NULL DO NOTHING
                RETURNING id
                "#,
                id.as_uuid(),
                team,
            )
            .fetch_optional(connection)
            .await?
        }
    };
    Ok(inserted.map(PolicyId::from_uuid))
}

/// Create the owned agent `agent`'s policy under `id`, following `source`,
/// unless it already has one; `None` when it did.
async fn insert_following_policy(
    connection: &mut PgConnection,
    agent: BotId,
    id: PolicyId,
    source: PolicyId,
) -> Result<Option<PolicyId>, sqlx::Error> {
    let inserted = sqlx::query_scalar!(
        r#"
        INSERT INTO agent_permission_policy (id, kind, bot_id, follows, source_policy_id, source_set_at)
        VALUES ($1, 'agent', $2, true, $3, now())
        ON CONFLICT (bot_id) WHERE bot_id IS NOT NULL DO NOTHING
        RETURNING id
        "#,
        id.as_uuid(),
        agent.as_uuid(),
        source.as_uuid(),
    )
    .fetch_optional(connection)
    .await?;
    Ok(inserted.map(PolicyId::from_uuid))
}

/// Whose policy a stored row is.
/// A stored policy row's owner columns.
struct OwnerColumns {
    bot_id: Option<macro_uuid::Uuid>,
    user_id: Option<String>,
    persona_id: Option<macro_uuid::Uuid>,
    team_id: Option<macro_uuid::Uuid>,
}

fn owner(kind: &str, columns: OwnerColumns) -> Result<PolicyOwner, PgPermissionStoreError> {
    let corrupt = || PgPermissionStoreError::Corrupt(format!("policy owner {kind}"));
    let OwnerColumns {
        bot_id,
        user_id,
        persona_id,
        team_id,
    } = columns;
    match (kind, bot_id, user_id, persona_id, team_id) {
        ("agent", Some(bot), None, None, None) => Ok(PolicyOwner::Agent(BotId::new_from_uuid(bot))),
        ("persona", None, Some(user), Some(persona), None) => Ok(PolicyOwner::Persona {
            persona: BotId::new_from_uuid(persona),
            user: MacroUserIdStr::try_from(user).map_err(|_| corrupt())?,
        }),
        ("team", None, None, None, Some(team)) => Ok(PolicyOwner::Team(team)),
        _ => Err(corrupt()),
    }
}

/// `policy`, every policy it follows and each one's rules, in one statement
/// (one snapshot, at any isolation). The walk stops one level past
/// `MAX_CHAIN` or at a policy already on it, which [`PolicyChain::new`] then
/// refuses.
async fn read_chain(
    connection: &mut PgConnection,
    policy: PolicyId,
) -> Result<Option<PolicyChain>, PgPermissionStoreError> {
    let rows = sqlx::query!(
        r#"
        WITH RECURSIVE chain (id, kind, bot_id, user_id, persona_id, team_id, follows, source_policy_id, depth, path) AS (
            SELECT p.id, p.kind, p.bot_id, p.user_id, p.persona_id, p.team_id, p.follows,
                   p.source_policy_id, 1, ARRAY[p.id]
            FROM agent_permission_policy p
            WHERE p.id = $1
          UNION ALL
            SELECT p.id, p.kind, p.bot_id, p.user_id, p.persona_id, p.team_id, p.follows,
                   p.source_policy_id, c.depth + 1, c.path || p.id
            FROM chain c
            JOIN agent_permission_policy p ON p.id = c.source_policy_id
            WHERE c.depth <= $2 AND p.id <> ALL (c.path)
        )
        SELECT c.id AS "id!", c.kind AS "kind!", c.bot_id, c.user_id, c.persona_id, c.team_id,
               c.follows AS "follows!", c.source_policy_id, c.depth AS "depth!",
               r.kind AS "rule_kind?", r.target AS "target?", r.state AS "state?",
               r.via_agent AS "via_agent?", r.restriction_only AS "restriction_only?",
               r.updated_at AS "updated_at?"
        FROM chain c
        LEFT JOIN agent_permission_rule r ON r.policy_id = c.id
        ORDER BY c.depth
        "#,
        policy.as_uuid(),
        WALK_DEPTH,
    )
    .fetch_all(connection)
    .await?;

    let mut levels: Vec<(i32, PolicyLevel)> = Vec::new();
    for row in rows {
        if levels.last().is_none_or(|(depth, _)| *depth != row.depth) {
            let follows = match (row.follows, row.source_policy_id) {
                (false, _) => Follows::Own,
                (true, Some(source)) => Follows::Source(PolicyId::from_uuid(source)),
                (true, None) => Follows::Lost,
            };
            levels.push((
                row.depth,
                PolicyLevel {
                    id: PolicyId::from_uuid(row.id),
                    owner: owner(
                        &row.kind,
                        OwnerColumns {
                            bot_id: row.bot_id,
                            user_id: row.user_id,
                            persona_id: row.persona_id,
                            team_id: row.team_id,
                        },
                    )?,
                    follows,
                    rules: Vec::new(),
                },
            ));
        }
        if let (
            Some(kind),
            Some(target),
            Some(state),
            Some(via_agent),
            Some(restriction_only),
            Some(updated_at),
            Some((_, level)),
        ) = (
            row.rule_kind,
            row.target,
            row.state,
            row.via_agent,
            row.restriction_only,
            row.updated_at,
            levels.last_mut(),
        ) {
            level.rules.push(rule(
                &kind,
                &target,
                &state,
                (via_agent, restriction_only),
                updated_at,
            )?);
        }
    }
    if levels.is_empty() {
        return Ok(None);
    }
    let levels = levels.into_iter().map(|(_, level)| level).collect();
    Ok(Some(PolicyChain::new(levels)?))
}

/// The ids on `source`'s chain, itself first, walked no further than one
/// level past `MAX_CHAIN`; empty when there is no such policy.
async fn chain_ids(
    connection: &mut PgConnection,
    source: PolicyId,
) -> Result<Vec<PolicyId>, sqlx::Error> {
    let ids = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE chain (id, source_policy_id, depth, path) AS (
            SELECT p.id, p.source_policy_id, 1, ARRAY[p.id]
            FROM agent_permission_policy p
            WHERE p.id = $1
          UNION ALL
            SELECT p.id, p.source_policy_id, c.depth + 1, c.path || p.id
            FROM chain c
            JOIN agent_permission_policy p ON p.id = c.source_policy_id
            WHERE c.depth <= $2 AND p.id <> ALL (c.path)
        )
        SELECT id AS "id!" FROM chain ORDER BY depth
        "#,
        source.as_uuid(),
        WALK_DEPTH,
    )
    .fetch_all(connection)
    .await?;
    Ok(ids.into_iter().map(PolicyId::from_uuid).collect())
}

/// The most policies on any path of followers ending at `policy`, itself
/// included, counted no further than `levels`; 0 when there is no such
/// policy. The walk visits every follower within `levels`, so a caller that
/// needs only to know whether the height passes a bound walks no further.
async fn read_followers_height(
    connection: &mut PgConnection,
    policy: PolicyId,
    levels: i32,
) -> Result<usize, sqlx::Error> {
    let height = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE tree (id, depth) AS (
            SELECT p.id, 1
            FROM agent_permission_policy p
            WHERE p.id = $1
          UNION ALL
            SELECT p.id, t.depth + 1
            FROM tree t
            JOIN agent_permission_policy p ON p.source_policy_id = t.id
            WHERE t.depth < $2
        )
        SELECT max(depth) FROM tree
        "#,
        policy.as_uuid(),
        levels,
    )
    .fetch_one(connection)
    .await?;
    Ok(height
        .and_then(|height| usize::try_from(height).ok())
        .unwrap_or(0))
}

/// Why a source can't be set, checked under the sources lock.
async fn check_source(
    connection: &mut PgConnection,
    policy: PolicyId,
    source: PolicyId,
) -> Result<Result<bool, PermissionError>, sqlx::Error> {
    let follower = sqlx::query!(
        "SELECT kind, follows FROM agent_permission_policy WHERE id = $1",
        policy.as_uuid(),
    )
    .fetch_optional(&mut *connection)
    .await?;
    let Some(follower) = follower else {
        return Ok(Err(PermissionError::NotFound));
    };
    // Only an owned agent's policy follows; persona and team policies are
    // roots, so a default source never needs these checks.
    if follower.kind != "agent" || policy == source {
        return Ok(Err(PermissionError::SourceNotAllowed));
    }
    let up = chain_ids(connection, source).await?;
    if up.is_empty() {
        return Ok(Err(PermissionError::NotFound));
    }
    if up.contains(&policy) {
        return Ok(Err(PermissionError::SourceCycle));
    }
    // Only whether the follower tree is taller than the room left matters:
    // walk one level past it, no further.
    let room = MAX_CHAIN.saturating_sub(up.len());
    let down = match i32::try_from(room + 1) {
        Ok(levels) if room > 0 => read_followers_height(connection, policy, levels).await?,
        Ok(_) | Err(_) => MAX_CHAIN + 1,
    };
    if down + up.len() > MAX_CHAIN {
        return Ok(Err(PermissionError::SourceTooDeep));
    }
    Ok(Ok(follower.follows))
}

/// Rows as parallel arrays for `UNNEST`.
#[derive(Default)]
struct Rows {
    kinds: Vec<String>,
    targets: Vec<String>,
    states: Vec<String>,
    via_agent: Vec<bool>,
    restriction_only: Vec<bool>,
}

impl Rows {
    fn new(rules: &[Rule]) -> Self {
        let mut rows = Rows::default();
        for rule in rules {
            let kind: &'static str = rule.target.kind().into();
            let state: &'static str = rule.state.into();
            rows.kinds.push(kind.to_owned());
            rows.targets.push(rule.target.key());
            rows.states.push(state.to_owned());
            rows.via_agent.push(rule.via_agent);
            rows.restriction_only.push(rule.restriction_only);
        }
        rows
    }
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

    #[tracing::instrument(skip_all, err)]
    async fn find_policy(&self, owner: &PolicyOwner) -> Result<Option<PolicyId>, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        Ok(find_policy(&mut connection, owner).await?)
    }

    #[tracing::instrument(skip_all, fields(agent_id = %agent, source_policy_id = %source), err)]
    async fn ensure_following_policy(
        &self,
        agent: BotId,
        source: PolicyId,
    ) -> Result<PolicyId, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        if let Some(id) =
            insert_following_policy(&mut connection, agent, PolicyId::generate(), source).await?
        {
            return Ok(id);
        }
        // It had one already, perhaps made by a concurrent call.
        find_policy(&mut connection, &PolicyOwner::Agent(agent))
            .await?
            .ok_or_else(|| PgPermissionStoreError::Corrupt("policy vanished on create".to_owned()))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn chain(&self, policy: PolicyId) -> Result<Option<PolicyChain>, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        read_chain(&mut connection, policy).await
    }

    #[tracing::instrument(skip_all, err)]
    async fn session_rules(&self, session: AgentSessionId) -> Result<Vec<Rule>, Self::Err> {
        let mut connection = self.pool.acquire().await?;
        overlay_rules(&mut connection, session).await
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn chain_with_session(
        &self,
        policy: PolicyId,
        session: AgentSessionId,
    ) -> Result<Option<(PolicyChain, Vec<Rule>)>, Self::Err> {
        let mut snapshot = self.pool.begin_with(SNAPSHOT).await?;
        let chain = read_chain(&mut snapshot, policy).await?;
        let overlay = overlay_rules(&mut snapshot, session).await?;
        snapshot.commit().await?;
        Ok(chain.map(|chain| (chain, overlay)))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %write.policy), err)]
    async fn write<Plan>(
        &self,
        write: Write<'_>,
        plan: Plan,
    ) -> Result<Result<(), PermissionError>, Self::Err>
    where
        Plan: FnOnce(&PolicyChain, &[Rule]) -> Result<Vec<Change>, PermissionError> + Send,
    {
        let mut transaction = self.pool.begin().await?;

        // Policy first, then session: every writer locks in this order.
        lock(&mut transaction, &lock_key(Some(write.policy), None)).await?;
        if let Some(session) = write.session {
            lock(&mut transaction, &lock_key(None, Some(session))).await?;
        }

        let Some(chain) = read_chain(&mut transaction, write.policy).await? else {
            return Ok(Err(PermissionError::NotFound));
        };
        let overlay = match write.session {
            Some(session) => overlay_rules(&mut transaction, session).await?,
            None => Vec::new(),
        };
        let changes = match plan(&chain, &overlay) {
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

    #[tracing::instrument(
        skip_all,
        fields(policy_id = %write.policy, source_policy_id = %source),
        err
    )]
    async fn set_source(
        &self,
        write: SourceWrite<'_>,
        source: PolicyId,
    ) -> Result<Result<(), PermissionError>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        bound_source_walk(&mut transaction).await?;
        // Sources first, then the policy: nothing takes the sources lock
        // after a policy's, so no two writers wait on each other.
        lock(&mut transaction, SOURCES_LOCK).await?;
        lock(&mut transaction, &lock_key(Some(write.policy), None)).await?;

        let followed = match check_source(&mut transaction, write.policy, source).await? {
            Ok(followed) => followed,
            Err(refused) => return Ok(Err(refused)),
        };
        sqlx::query!(
            r#"
            UPDATE agent_permission_policy
            SET follows = true,
                source_policy_id = $2,
                source_set_by = $3,
                source_set_at = now()
            WHERE id = $1
            "#,
            write.policy.as_uuid(),
            source.as_uuid(),
            write.by.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;
        // A policy that owned its settings now takes the source's: the
        // person-made ones go, its restrictions stay as local restrictions.
        if !followed {
            sqlx::query!(
                r#"
                DELETE FROM agent_permission_rule
                WHERE policy_id = $1 AND NOT restriction_only
                "#,
                write.policy.as_uuid(),
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(Ok(()))
    }

    #[tracing::instrument(skip_all, fields(policy_id = %write.policy, rules_written = tracing::field::Empty), err)]
    async fn detach<Plan>(
        &self,
        write: SourceWrite<'_>,
        plan: Plan,
    ) -> Result<Result<usize, PermissionError>, Self::Err>
    where
        Plan: FnOnce(&PolicyChain) -> Result<Vec<Rule>, PermissionError> + Send,
    {
        let mut transaction = self.pool.begin().await?;
        bound_source_walk(&mut transaction).await?;
        lock(&mut transaction, SOURCES_LOCK).await?;
        lock(&mut transaction, &lock_key(Some(write.policy), None)).await?;

        let Some(chain) = read_chain(&mut transaction, write.policy).await? else {
            return Ok(Err(PermissionError::NotFound));
        };
        let rules = match plan(&chain) {
            Ok(rules) => rules,
            Err(refused) => return Ok(Err(refused)),
        };

        let rows = Rows::new(&rules);
        sqlx::query!(
            "DELETE FROM agent_permission_rule WHERE policy_id = $1",
            write.policy.as_uuid(),
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO agent_permission_rule
                (policy_id, kind, target, state, updated_by, via_agent, restriction_only)
            SELECT $1, kind, target, state, $7, via_agent, restriction_only
            FROM UNNEST($2::text[], $3::text[], $4::text[], $5::bool[], $6::bool[])
                AS row (kind, target, state, via_agent, restriction_only)
            "#,
            write.policy.as_uuid(),
            &rows.kinds,
            &rows.targets,
            &rows.states,
            &rows.via_agent,
            &rows.restriction_only,
            write.by.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            UPDATE agent_permission_policy
            SET follows = false,
                source_policy_id = NULL,
                source_set_by = $2,
                source_set_at = now()
            WHERE id = $1
            "#,
            write.policy.as_uuid(),
            write.by.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        tracing::Span::current().record("rules_written", rules.len());
        Ok(Ok(rules.len()))
    }

    #[tracing::instrument(skip_all, fields(agents = agents.len()), err)]
    async fn find_agent_policies(
        &self,
        agents: &[BotId],
    ) -> Result<Vec<Option<PolicyId>>, Self::Err> {
        if agents.is_empty() {
            return Ok(Vec::new());
        }
        let bots: Vec<macro_uuid::Uuid> = agents.iter().map(|agent| agent.as_uuid()).collect();
        let mut connection = self.pool.acquire().await?;
        let rows = sqlx::query!(
            r#"
            SELECT id, bot_id AS "bot_id!" FROM agent_permission_policy
            WHERE bot_id = ANY($1)
            "#,
            &bots,
        )
        .fetch_all(&mut *connection)
        .await?;
        Ok(agents
            .iter()
            .map(|agent| {
                rows.iter()
                    .find(|row| row.bot_id == agent.as_uuid())
                    .map(|row| PolicyId::from_uuid(row.id))
            })
            .collect())
    }

    #[tracing::instrument(skip_all, fields(agents = agents.len()), err)]
    async fn ensure_following_policies(
        &self,
        agents: &[(BotId, PolicyId)],
    ) -> Result<Vec<PolicyId>, Self::Err> {
        if agents.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<macro_uuid::Uuid> = agents
            .iter()
            .map(|_| PolicyId::generate().as_uuid())
            .collect();
        let bots: Vec<macro_uuid::Uuid> = agents.iter().map(|(bot, _)| bot.as_uuid()).collect();
        let sources: Vec<macro_uuid::Uuid> =
            agents.iter().map(|(_, source)| source.as_uuid()).collect();
        let mut connection = self.pool.acquire().await?;
        sqlx::query!(
            r#"
            INSERT INTO agent_permission_policy
                (id, kind, bot_id, follows, source_policy_id, source_set_at)
            SELECT id, 'agent', bot_id, true, source_policy_id, now()
            FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[]) AS agent (id, bot_id, source_policy_id)
            ON CONFLICT (bot_id) WHERE bot_id IS NOT NULL DO NOTHING
            "#,
            &ids,
            &bots,
            &sources,
        )
        .execute(&mut *connection)
        .await?;
        let rows = sqlx::query!(
            r#"
            SELECT id, bot_id AS "bot_id!" FROM agent_permission_policy
            WHERE bot_id = ANY($1)
            "#,
            &bots,
        )
        .fetch_all(&mut *connection)
        .await?;
        agents
            .iter()
            .map(|(bot, _)| {
                rows.iter()
                    .find(|row| row.bot_id == bot.as_uuid())
                    .map(|row| PolicyId::from_uuid(row.id))
                    .ok_or_else(|| {
                        PgPermissionStoreError::Corrupt("policy vanished on create".to_owned())
                    })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(policies = policies.len()), err)]
    async fn chain_ids(&self, policies: &[PolicyId]) -> Result<Vec<Vec<PolicyId>>, Self::Err> {
        if policies.is_empty() {
            return Ok(Vec::new());
        }
        let starts: Vec<macro_uuid::Uuid> = policies.iter().map(PolicyId::as_uuid).collect();
        let mut connection = self.pool.acquire().await?;
        let rows = sqlx::query!(
            r#"
            WITH RECURSIVE chain (start, id, source_policy_id, depth, path) AS (
                SELECT p.id, p.id, p.source_policy_id, 1, ARRAY[p.id]
                FROM agent_permission_policy p
                WHERE p.id = ANY($1)
              UNION ALL
                SELECT c.start, p.id, p.source_policy_id, c.depth + 1, c.path || p.id
                FROM chain c
                JOIN agent_permission_policy p ON p.id = c.source_policy_id
                WHERE c.depth <= $2 AND p.id <> ALL (c.path)
            )
            SELECT start AS "start!", id AS "id!" FROM chain ORDER BY start, depth
            "#,
            &starts,
            WALK_DEPTH,
        )
        .fetch_all(&mut *connection)
        .await?;
        Ok(policies
            .iter()
            .map(|policy| {
                rows.iter()
                    .filter(|row| row.start == policy.as_uuid())
                    .map(|row| PolicyId::from_uuid(row.id))
                    .collect()
            })
            .collect())
    }

    #[tracing::instrument(skip_all, fields(policy_id = %policy), err)]
    async fn followers_height(&self, policy: PolicyId) -> Result<usize, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        bound_source_walk(&mut transaction).await?;
        let height = read_followers_height(&mut transaction, policy, WALK_DEPTH + 1).await?;
        transaction.commit().await?;
        Ok(height)
    }
}
