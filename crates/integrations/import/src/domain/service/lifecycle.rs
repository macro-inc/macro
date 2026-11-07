//! Finished import generations deduplicate only physical, live Macro copies.

use futures::{StreamExt, TryStreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{ImportEntity, ImportSource, ImportStatus, TeamClaim};
use crate::domain::ports::{
    ImportError, ImportRepo, ImportedTarget, ImportedTargetReader, NotionPlanRepo, PlanRow, Result,
};

/// Limit pool pressure during large inventories. Renewals stay sequential so
/// a parent and its children never acquire generation locks in opposite order.
const READ_CONCURRENCY: usize = 8;
/// Report a disappeared finished copy while allowing unrelated writes to finish.
pub(crate) const DELETED_DURING_WRITE: &str =
    "The copied object was deleted. Plan again to import a new copy.";

fn target(row: &ImportEntity) -> Option<ImportedTarget> {
    ImportedTarget::from_entity(row.entity_id.as_deref()?, row.entity_type.as_deref()?)
}

async fn read_live<T: ImportedTargetReader>(reader: &T, row: &ImportEntity) -> Result<bool> {
    if row.status != ImportStatus::Imported {
        return Ok(true);
    }
    let Some(target) = target(row) else {
        return Ok(true);
    };
    Ok(reader.target_exists(target).await?)
}

async fn keep_or_renew<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
    live: bool,
    reason: Option<&str>,
) -> Result<bool> {
    if live {
        return Ok(true);
    }
    let (Some(target), Some(entity_id)) = (target(row), row.entity_id.as_deref()) else {
        return Ok(true);
    };
    let renewed = repo
        .renew_deleted_copy(user, row.id, entity_id, reason, || async {
            Ok(!reader.target_exists(target).await?)
        })
        .await?;
    // The generation may have changed, or its physical target may have been
    // restored while waiting for the ledger lock. Never discard a live copy.
    if renewed {
        Ok(false)
    } else {
        Ok(reader.target_exists(target).await?)
    }
}

/// Only finished copies can be invalidated. Active leases and read failures
/// preserve their generation. Unknown historical entity kinds stay untouched.
#[tracing::instrument(skip(repo, reader, row, user), fields(import_id = %row.id), err)]
pub(crate) async fn live<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
) -> Result<bool> {
    keep_or_renew(repo, reader, user, row, read_live(reader, row).await?, None).await
}

/// A deleted finished object is staged with a reported failure, not a run error.
#[tracing::instrument(skip(repo, reader, row, user), fields(import_id = %row.id), err)]
pub(crate) async fn live_for_write<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
) -> Result<bool> {
    keep_or_renew(
        repo,
        reader,
        user,
        row,
        read_live(reader, row).await?,
        Some(DELETED_DURING_WRITE),
    )
    .await
}

/// Inspect the owner's inventory concurrently, then renew deleted generations
/// in order before staging the next plan.
#[tracing::instrument(skip(repo, reader, user, rows), fields(objects = rows.len()), err)]
pub(crate) async fn replace_plan<R: ImportRepo + NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    source: ImportSource,
    rows: &[PlanRow],
) -> Result<Vec<ImportEntity>> {
    let foreign_ids: Vec<_> = rows.iter().map(|row| row.foreign_id.clone()).collect();
    let checks: Vec<_> = stream::iter(foreign_ids)
        .map(|foreign_id| async move {
            let own = repo
                .get_own_by_foreign_id(user, source, &foreign_id)
                .await?;
            let result = match own {
                Some(own) => {
                    let live = read_live(reader, &own).await?;
                    Some((own, live))
                }
                None => None,
            };
            Ok::<_, ImportError>(result)
        })
        .buffered(READ_CONCURRENCY)
        .try_collect()
        .await?;
    for (own, live) in checks.into_iter().flatten() {
        keep_or_renew(repo, reader, user, &own, live, None).await?;
    }
    repo.replace_plan(user, source, rows).await
}

/// Physical facts are read with bounded concurrency; mutations retain a stable
/// lock order even when a whole deleted folder tree appears in an inventory.
#[tracing::instrument(skip(repo, reader, user, foreign_ids), fields(objects = foreign_ids.len()), err)]
pub(crate) async fn team_copies<R: NotionPlanRepo, T: ImportedTargetReader>(
    repo: &R,
    reader: &T,
    user: &MacroUserIdStr<'static>,
    foreign_ids: &[String],
) -> Result<Vec<ImportEntity>> {
    let checks: Vec<_> = stream::iter(repo.team_copies(user, foreign_ids).await?)
        .map(|row| async move {
            let live = read_live(reader, &row).await?;
            Ok::<_, ImportError>((row, live))
        })
        .buffered(READ_CONCURRENCY)
        .try_collect()
        .await?;
    let mut copies = Vec::new();
    for (row, live) in checks {
        if keep_or_renew(repo, reader, user, &row, live, None).await? {
            copies.push(row);
        }
    }
    Ok(copies)
}

/// Recheck immediately before linking, including deletion after approval.
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
        if let Some(target) = ImportedTarget::from_entity(entity_id, entity_type)
            && !reader.target_exists(target).await?
        {
            let Some(own) = repo.get(user, import_id).await? else {
                return Ok(TeamClaim::Free);
            };
            for holder in repo.team_copies(user, &[own.foreign_id]).await? {
                if holder.entity_id.as_deref() == Some(entity_id.as_str()) {
                    live(repo, reader, user, &holder).await?;
                }
            }
        } else {
            return Ok(outcome);
        }
    }
    Err(ImportError::NotReady(
        "The team's copy changed; import again.",
    ))
}
