//! Transaction-aware canonical explicit team sharing.
//!
//! Acquire [`acquire_guard`] before accompanying metadata/ownership/topology writes.
//! All public operations acquire it again (transaction advisory locks are reentrant),
//! read fresh authoritative facts, and never commit the caller's transaction. On any
//! error the caller must roll back the whole transaction, including metadata changes.
//! Ordinary reads may use a short transaction and [`load_facts`] before domain policy.

pub use entity_access_db_utils::team_share::acquire_guard;
use entity_access_db_utils::team_share::{
    delete_direct, direct_level, ensure_owner_direct, upsert_direct,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use macro_uuid::Uuid;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::{
    access_level::AccessLevel,
    team_share::{
        AuthorizedTeamShareCommand, TeamShareCreation, TeamShareFacts, TeamShareGrant,
        TeamShareLevel, TeamShareMaintenance,
    },
};
use rootcause::prelude::*;
use sqlx::{PgConnection, Postgres, Transaction};

#[cfg(test)]
mod test;

/// Conditional-write failures remain distinguishable from database/reporting failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TeamShareError {
    /// No authoritative entity exists (permission associations alone are insufficient).
    #[error("team-share entity not found")]
    NotFound,
    /// Domain-authorized ownership, membership, or canonical state changed.
    #[error("team-share facts changed")]
    ChangedFacts,
    /// A normal mutation would overwrite an unexplained direct grant.
    #[error("untracked direct team grant conflicts with team sharing")]
    UntrackedGrant,
    /// Reconciliation requires a matching reviewed direct grant and owner team.
    #[error("team-share adoption candidate no longer matches")]
    InvalidAdoption,
    /// The entity kind or identifier is unsupported.
    #[error("invalid team-share entity")]
    InvalidEntity,
    /// Stored permission state is incomplete/invalid, or its revision is exhausted.
    #[error("invalid canonical team-share state")]
    InvalidState,
    /// Database or persisted-identity parsing failure; the report retains the cause.
    #[error("team-share persistence failed")]
    Infrastructure,
}

/// Typed report returned by canonical persistence operations.
pub type TeamShareResult<T> = Result<T, Report<TeamShareError>>;

/// Historical canonical consent for later conditional lifecycle compensation.
/// `revision` is the pre-cleanup revision; a successful clear writes revision + 1.
/// Restoration must check that revision, NULL state, owner eligibility and current
/// topology under the guard; this snapshot alone is not permission to restore.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamShareCleanupSnapshot {
    /// Explicit sharing root, not a descendant receiving inherited access.
    pub root: Entity<'static>,
    /// Actual owner at snapshot time, for ownership-change eligibility checks.
    pub owner: MacroUserIdStr<'static>,
    /// Historical managed team, retained after membership removal.
    pub managed_team_id: Uuid,
    /// Exact historical level.
    pub level: TeamShareLevel,
    /// Revision before cleanup.
    pub revision: i64,
}

/// Capture only canonical consent, never infer it from direct or inherited grants.
pub fn cleanup_snapshot(facts: &TeamShareFacts) -> Option<TeamShareCleanupSnapshot> {
    facts.current.map(|grant| TeamShareCleanupSnapshot {
        root: facts.entity.clone(),
        owner: facts.owner.clone(),
        managed_team_id: grant.team_id,
        level: grant.level,
        revision: facts.revision,
    })
}

struct State {
    facts: TeamShareFacts,
    permission_id: Option<String>,
}

fn entity_uuid(entity: &Entity<'_>) -> TeamShareResult<Uuid> {
    if !matches!(
        entity.entity_type,
        EntityType::Document
            | EntityType::Project
            | EntityType::Chat
            | EntityType::EmailThread
            | EntityType::Call
    ) {
        return Err(report!(TeamShareError::InvalidEntity));
    }
    Uuid::parse_str(&entity.entity_id).context(TeamShareError::InvalidEntity)
}

/// Load actual owner, current membership and canonical state under the shared guard.
/// Threads without permissions read as NULL/revision zero without creating any rows.
/// Tasks and snippets use Document, and active calls take precedence during archive.
pub async fn load_facts(
    transaction: &mut Transaction<'_, Postgres>,
    entity: &Entity<'_>,
) -> TeamShareResult<TeamShareFacts> {
    acquire_guard(transaction)
        .await
        .context(TeamShareError::Infrastructure)?;
    Ok(load_state(transaction.as_mut(), entity).await?.facts)
}

async fn load_state(connection: &mut PgConnection, entity: &Entity<'_>) -> TeamShareResult<State> {
    let uuid = entity_uuid(entity)?;
    let row = sqlx::query!(
        r#"WITH entity AS (
            SELECT d.owner, dp."sharePermissionId" AS permission_id
            FROM "Document" d LEFT JOIN "DocumentPermission" dp ON dp."documentId" = d.id
            WHERE $2 = 'document' AND d.id = $1
            UNION ALL
            SELECT p."userId", pp."sharePermissionId"
            FROM "Project" p LEFT JOIN "ProjectPermission" pp ON pp."projectId" = p.id
            WHERE $2 = 'project' AND p.id = $1
            UNION ALL
            SELECT c."userId", cp."sharePermissionId"
            FROM "Chat" c LEFT JOIN "ChatPermission" cp ON cp."chatId" = c.id
            WHERE $2 = 'chat' AND c.id = $1
            UNION ALL
            SELECT l.macro_id, tp."sharePermissionId"
            FROM email_threads t JOIN email_links l ON l.id = t.link_id
            LEFT JOIN "EmailThreadPermission" tp ON tp."threadId" = t.id::text
            WHERE $2 = 'email_thread' AND t.id = $3
            UNION ALL
            SELECT c.created_by, c.share_permission_id FROM calls c
            WHERE $2 = 'call' AND c.id = $3
            UNION ALL
            SELECT c.created_by, c.share_permission_id FROM call_records c
            WHERE $2 = 'call' AND c.id = $3 AND NOT EXISTS (SELECT 1 FROM calls WHERE id = $3)
        )
        SELECT e.owner AS "owner!", e.permission_id,
            sp.id AS "stored_permission_id?",
            sp.team_share_access_level AS "level: AccessLevel",
            sp.team_share_team_id AS team_id, sp.team_share_revision AS "revision?",
            (SELECT tu.team_id FROM team_user tu WHERE tu.user_id = e.owner
             ORDER BY tu.team_role DESC LIMIT 1) AS owner_team_id
        FROM entity e LEFT JOIN "SharePermission" sp ON sp.id = e.permission_id"#,
        entity.entity_id.as_ref(),
        entity.entity_type.as_ref(),
        uuid,
    )
    .fetch_optional(connection)
    .await
    .context(TeamShareError::Infrastructure)?
    .ok_or_else(|| report!(TeamShareError::NotFound))?;

    if row.stored_permission_id.is_none()
        && (row.permission_id.is_some() || entity.entity_type != EntityType::EmailThread)
    {
        return Err(report!(TeamShareError::InvalidState));
    }
    let current = match (row.level, row.team_id) {
        (Some(level), Some(team_id)) => Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::try_from(level).context(TeamShareError::InvalidState)?,
        }),
        (None, None) => None,
        _ => return Err(report!(TeamShareError::InvalidState)),
    };
    let revision = row.revision.unwrap_or(0);
    if revision < 0 {
        return Err(report!(TeamShareError::InvalidState));
    }
    Ok(State {
        facts: TeamShareFacts {
            entity: entity.clone().into_owned(),
            owner: MacroUserIdStr::parse_from_str(&row.owner)
                .context(TeamShareError::Infrastructure)?
                .into_owned(),
            owner_team_id: row.owner_team_id,
            current,
            revision,
        },
        permission_id: row.permission_id,
    })
}

async fn recheck(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &TeamShareFacts,
) -> TeamShareResult<State> {
    acquire_guard(transaction)
        .await
        .context(TeamShareError::Infrastructure)?;
    let state = load_state(transaction.as_mut(), &expected.entity).await?;
    if state.facts != *expected {
        return Err(report!(TeamShareError::ChangedFacts));
    }
    Ok(state)
}

/// Apply an actual-owner-authorized supplied operation. Omission has no command and
/// must not call this function. Even same-value sets and repeated clears advance revision.
pub async fn apply(
    transaction: &mut Transaction<'_, Postgres>,
    command: &AuthorizedTeamShareCommand,
) -> TeamShareResult<()> {
    let state = recheck(transaction, command.expected()).await?;
    reject_untracked(transaction.as_mut(), &state.facts, command.target()).await?;
    write_state(
        transaction,
        state,
        command.target(),
        command.next_revision(),
    )
    .await
}

async fn reject_untracked(
    connection: &mut PgConnection,
    facts: &TeamShareFacts,
    target: Option<TeamShareGrant>,
) -> TeamShareResult<()> {
    let Some(target) = target else {
        return Ok(());
    };
    if facts.current.map(|g| g.team_id) == Some(target.team_id) {
        return Ok(());
    }
    let existing = direct_level(
        connection,
        &entity_uuid(&facts.entity)?,
        facts.entity.entity_type,
        target.team_id,
    )
    .await
    .context(TeamShareError::Infrastructure)?;
    if existing.is_some() {
        return Err(report!(TeamShareError::UntrackedGrant));
    }
    Ok(())
}

fn next_revision(facts: &TeamShareFacts) -> TeamShareResult<i64> {
    facts
        .revision
        .checked_add(1)
        .ok_or_else(|| report!(TeamShareError::InvalidState))
}

/// Clear by trusted lifecycle intent, without requiring an acting user or current
/// membership. Compare freshly loaded facts and retain the historical team attribution.
pub async fn maintain(
    transaction: &mut Transaction<'_, Postgres>,
    intent: &TeamShareMaintenance,
) -> TeamShareResult<()> {
    match intent {
        TeamShareMaintenance::Clear { expected } => {
            let state = recheck(transaction, expected).await?;
            let revision = next_revision(&state.facts)?;
            write_state(transaction, state, None, revision).await
        }
    }
}

/// Initialize a newly inserted entity in the caller's guarded creation transaction.
/// Never use this for existing entities or copies with inherited source consent.
/// Unshared creation does not advance revision; explicit task/call consent does.
pub async fn initialize(
    transaction: &mut Transaction<'_, Postgres>,
    entity: &Entity<'_>,
    intent: TeamShareCreation,
) -> TeamShareResult<()> {
    acquire_guard(transaction)
        .await
        .context(TeamShareError::Infrastructure)?;
    let state = load_state(transaction.as_mut(), entity).await?;
    if state.facts.current.is_some() || state.facts.revision != 0 {
        return Err(report!(TeamShareError::ChangedFacts));
    }
    let target = intent
        .resolve(state.facts.owner_team_id)
        .context(TeamShareError::InvalidState)?;
    if target.is_none() {
        return Ok(());
    }
    reject_untracked(transaction.as_mut(), &state.facts, target).await?;
    write_state(transaction, state, target, 1).await
}

/// Explicit reconciliation-only adoption of a reviewed historical direct grant.
/// Normal writes never adopt unknown rows. Both canonical facts and the exact
/// candidate level/team are rechecked; inherited rows cannot qualify for adoption.
pub async fn adopt(
    transaction: &mut Transaction<'_, Postgres>,
    expected: &TeamShareFacts,
    reviewed: TeamShareGrant,
) -> TeamShareResult<()> {
    let state = recheck(transaction, expected).await?;
    if state.facts.current.is_some() || state.facts.owner_team_id != Some(reviewed.team_id) {
        return Err(report!(TeamShareError::InvalidAdoption));
    }
    let existing = direct_level(
        transaction.as_mut(),
        &entity_uuid(&expected.entity)?,
        expected.entity.entity_type,
        reviewed.team_id,
    )
    .await
    .context(TeamShareError::Infrastructure)?;
    if existing != Some(reviewed.level.into()) {
        return Err(report!(TeamShareError::InvalidAdoption));
    }
    let revision = next_revision(&state.facts)?;
    write_state(transaction, state, Some(reviewed), revision).await
}

async fn write_state(
    transaction: &mut Transaction<'_, Postgres>,
    state: State,
    target: Option<TeamShareGrant>,
    revision: i64,
) -> TeamShareResult<()> {
    let entity = &state.facts.entity;
    let uuid = entity_uuid(entity)?;
    let permission_id = match state.permission_id {
        Some(id) => id,
        None => {
            ensure_thread_share_permission_in_transaction(transaction, &entity.entity_id).await?
        }
    };
    sqlx::query!(
        r#"UPDATE "SharePermission" SET team_share_access_level = $2,
            team_share_team_id = $3, team_share_revision = $4, "updatedAt" = NOW()
        WHERE id = $1"#,
        permission_id,
        target.map(|g| AccessLevel::from(g.level)) as Option<AccessLevel>,
        target.map(|g| g.team_id),
        revision,
    )
    .execute(transaction.as_mut())
    .await
    .context(TeamShareError::Infrastructure)?;

    if let Some(previous) = state.facts.current
        && target.map(|g| g.team_id) != Some(previous.team_id)
    {
        delete_direct(
            transaction.as_mut(),
            &uuid,
            entity.entity_type,
            previous.team_id,
        )
        .await
        .context(TeamShareError::Infrastructure)?;
    }
    if let Some(target) = target {
        upsert_direct(
            transaction.as_mut(),
            &uuid,
            entity.entity_type,
            target.team_id,
            target.level.into(),
        )
        .await
        .context(TeamShareError::Infrastructure)?;
    }
    Ok(())
}

/// Lazily create a thread permission and owner grant in an existing transaction.
/// The shared guard serializes the absence check, association insert and owner grant.
/// Owner identity comes from email_links, not a supplied ID or the permission row.
/// Link sharing and canonical team sharing start NULL; no team defaults are applied.
pub async fn ensure_thread_share_permission_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: &str,
) -> TeamShareResult<String> {
    acquire_guard(transaction)
        .await
        .context(TeamShareError::Infrastructure)?;
    let uuid = Uuid::parse_str(thread_id).context(TeamShareError::InvalidEntity)?;
    let entity = EntityType::EmailThread.with_entity_string(uuid.to_string());
    let state = load_state(transaction.as_mut(), &entity).await?;
    if let Some(id) = state.permission_id {
        return Ok(id);
    }
    let owner_granted = ensure_owner_direct(
        transaction.as_mut(),
        &uuid,
        EntityType::EmailThread,
        &state.facts.owner,
    )
    .await
    .context(TeamShareError::Infrastructure)?;
    if !owner_granted {
        return Err(report!(TeamShareError::InvalidState));
    }
    let id = macro_uuid::generate_uuid_v7().to_string();
    sqlx::query!(r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#, id)
        .execute(transaction.as_mut())
        .await
        .context(TeamShareError::Infrastructure)?;
    sqlx::query!(
        r#"INSERT INTO "EmailThreadPermission" ("threadId", "sharePermissionId", "userId") VALUES ($1, $2, $3)"#,
        uuid.to_string(),
        id,
        state.facts.owner.as_ref(),
    )
    .execute(transaction.as_mut())
    .await
    .context(TeamShareError::Infrastructure)?;
    Ok(id)
}
