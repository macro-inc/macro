use entity_access_db_utils::{
    AccessLevel, delete_user_entity_access_rows, upsert_user_entity_access_bulk,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{AdapterError, GrantTargets, map_sqlx};
use crate::domain::models::InitiativeError;

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
