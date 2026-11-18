//! Re-import policy: finished ledger rows only deduplicate live Macro copies.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{ImportEntity, ImportSource, ImportStatus, TeamClaim};
use crate::domain::ports::{
    ImportRepo, ImportedTargetReader, NotionPlanRepo, PlanRow, Result, SharedEntity,
};

fn target(row: &ImportEntity) -> Option<SharedEntity> {
    let id = row.entity_id.as_deref()?.parse().ok()?;
    match row.entity_type.as_deref()? {
        "md" | "task" => Some(SharedEntity::Document(id)),
        "project" => Some(SharedEntity::Folder(id)),
        "database" => Some(SharedEntity::Database(id)),
        _ => None,
    }
}

/// In-progress writes may not have created their target yet. Only finished
/// copies can be invalidated; transient host failures leave their claim intact.
#[tracing::instrument(skip(repo, reader, row, user), fields(import_id = %row.id), err)]
pub(crate) async fn live<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
) -> Result<bool> {
    if row.status != ImportStatus::Imported {
        return Ok(true);
    }
    let Some(target) = target(row) else {
        // Unknown historical entity kinds are outside workspace re-import policy.
        return Ok(true);
    };
    if reader.target_exists(user, target).await? {
        return Ok(true);
    }
    if let Some(entity_id) = &row.entity_id {
        repo.renew_deleted_copy(user, row.id, entity_id).await?;
    }
    Ok(false)
}

/// Refresh the owner's finished copies before staging the next inventory.
#[tracing::instrument(skip(repo, reader, user, rows), fields(objects = rows.len()), err)]
pub(crate) async fn replace_plan<R: ImportRepo + NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    source: ImportSource,
    rows: &[PlanRow],
) -> Result<Vec<ImportEntity>> {
    for row in rows {
        if let Some(own) = repo
            .get_own_by_foreign_id(user, source, &row.foreign_id)
            .await?
        {
            live(repo, reader, user, &own).await?;
        }
    }
    repo.replace_plan(user, source, rows).await
}

/// Teammates' finished copies are linkable only while their targets are live.
#[tracing::instrument(skip(repo, reader, user, foreign_ids), fields(objects = foreign_ids.len()), err)]
pub(crate) async fn team_copies<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    foreign_ids: &[String],
) -> Result<Vec<ImportEntity>> {
    let mut copies = Vec::new();
    for copy in repo.team_copies(user, foreign_ids).await? {
        if live(repo, reader, user, &copy).await? {
            copies.push(copy);
        }
    }
    Ok(copies)
}

/// Recheck immediately before linking, including deletion after plan approval.
#[tracing::instrument(skip(repo, reader, user), err)]
pub(crate) async fn claim_team_object<R: ImportRepo + NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    import_id: Uuid,
    team: Uuid,
    claim: bool,
) -> Result<TeamClaim> {
    for _ in 0..3 {
        let outcome = repo.claim_team_object(user, import_id, team, claim).await?;
        let TeamClaim::Linked {
            entity_id,
            entity_type,
        } = &outcome
        else {
            return Ok(outcome);
        };
        let id = Uuid::parse_str(entity_id).ok();
        let target = match (entity_type.as_str(), id) {
            ("md" | "task", Some(id)) => Some(SharedEntity::Document(id)),
            ("project", Some(id)) => Some(SharedEntity::Folder(id)),
            ("database", Some(id)) => Some(SharedEntity::Database(id)),
            _ => None,
        };
        if let Some(target) = target
            && !reader.target_exists(user, target).await?
        {
            let Some(own) = repo.get(user, import_id).await? else {
                return Ok(TeamClaim::Free);
            };
            for holder in repo.team_copies(user, &[own.foreign_id]).await? {
                if holder.entity_id.as_deref() == Some(entity_id.as_str()) {
                    repo.renew_deleted_copy(user, holder.id, entity_id).await?;
                }
            }
        } else {
            return Ok(outcome);
        }
    }
    Err(crate::domain::ports::ImportError::NotReady(
        "The team's copy changed; import again.",
    ))
}
