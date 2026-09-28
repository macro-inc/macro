use entity_access_db_utils::{
    AccessLevel, delete_user_entity_access_rows, upsert_user_entity_access_bulk,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{AdapterError, GrantTargets, map_sqlx, parse_description_document_id};
use crate::domain::models::{InitiativeError, InitiativeId};

pub(super) async fn grant_assignees(
    pool: &PgPool,
    id: InitiativeId,
    user_ids: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    if user_ids.is_empty() {
        return Ok(());
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let row = sqlx::query!(
        "SELECT description_document_id, owner_user_id FROM initiative WHERE id = $1 FOR UPDATE",
        id.as_uuid(),
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?
    .ok_or(InitiativeError::NotFound)?;
    let description_id = parse_description_document_id(id.as_uuid(), &row.description_document_id)?;
    let collaborators = user_ids
        .iter()
        .filter(|user_id| user_id.as_ref() != row.owner_user_id)
        .cloned()
        .collect::<Vec<_>>();
    // Assignment grants remain after the property is cleared, just like task sharing.
    // Record those grants as collaborators so the owner can explicitly revoke them.
    apply_member_diff(
        &mut tx,
        &GrantTargets::new(id, description_id),
        &collaborators,
        &[],
    )
    .await?;
    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    Ok(())
}

pub(super) async fn insert_members(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    member_ids: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    if member_ids.is_empty() {
        return Ok(());
    }
    let member_ids: Vec<String> = member_ids.iter().map(|id| id.to_string()).collect();
    sqlx::query!(
        r#"
        INSERT INTO initiative_member (initiative_id, user_id)
        SELECT $1, UNNEST($2::text[])
        "#,
        id,
        &member_ids,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;
    Ok(())
}

pub(super) async fn grant_members_edit(
    tx: &mut Transaction<'_, Postgres>,
    targets: &GrantTargets,
    member_ids: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    for (entity_id, entity_type) in targets.each() {
        upsert_user_entity_access_bulk(
            tx.as_mut(),
            member_ids,
            &entity_id,
            entity_type,
            AccessLevel::Edit,
        )
        .await
        .map_err(|error| InitiativeError::Internal(rootcause::report!("{error}")))?;
    }
    Ok(())
}

pub(super) async fn apply_member_diff(
    tx: &mut Transaction<'_, Postgres>,
    targets: &GrantTargets,
    added: &[MacroUserIdStr<'static>],
    removed: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    let initiative_id = targets.initiative_id();
    if !removed.is_empty() {
        let removed_ids: Vec<String> = removed.iter().map(|id| id.to_string()).collect();
        sqlx::query!(
            r#"
            DELETE FROM initiative_member
            WHERE initiative_id = $1 AND user_id = ANY($2)
            "#,
            initiative_id,
            &removed_ids,
        )
        .execute(tx.as_mut())
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
        for (entity_id, entity_type) in targets.each() {
            delete_user_entity_access_rows(tx, &entity_id, entity_type, removed)
                .await
                .map_err(AdapterError::Sqlx)
                .map_err(map_sqlx)?;
        }
    }

    if !added.is_empty() {
        let added_ids: Vec<String> = added.iter().map(|id| id.to_string()).collect();
        sqlx::query!(
            r#"
            INSERT INTO initiative_member (initiative_id, user_id)
            SELECT $1, UNNEST($2::text[])
            ON CONFLICT DO NOTHING
            "#,
            initiative_id,
            &added_ids,
        )
        .execute(tx.as_mut())
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
        grant_members_edit(tx, targets, added).await?;
    }

    Ok(())
}
