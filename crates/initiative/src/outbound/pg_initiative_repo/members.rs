use entity_access_db_utils::{
    AccessLevel, EntityType, delete_user_entity_access_rows, upsert_user_entity_access_bulk,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{AdapterError, map_sqlx};
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
    id: Uuid,
    member_ids: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    upsert_user_entity_access_bulk(
        tx.as_mut(),
        member_ids,
        &id,
        EntityType::Initiative,
        AccessLevel::Edit,
    )
    .await
    .map_err(|error| InitiativeError::Internal(rootcause::report!("{error}")))
}

pub(super) async fn apply_member_diff(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    added: &[MacroUserIdStr<'static>],
    removed: &[MacroUserIdStr<'static>],
) -> Result<(), InitiativeError> {
    if !removed.is_empty() {
        let removed_ids: Vec<String> = removed.iter().map(|id| id.to_string()).collect();
        sqlx::query!(
            r#"
            DELETE FROM initiative_member
            WHERE initiative_id = $1 AND user_id = ANY($2)
            "#,
            id,
            &removed_ids,
        )
        .execute(tx.as_mut())
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
        delete_user_entity_access_rows(tx, &id, EntityType::Initiative, removed)
            .await
            .map_err(AdapterError::Sqlx)
            .map_err(map_sqlx)?;
    }

    if !added.is_empty() {
        let added_ids: Vec<String> = added.iter().map(|id| id.to_string()).collect();
        sqlx::query!(
            r#"
            INSERT INTO initiative_member (initiative_id, user_id)
            SELECT $1, UNNEST($2::text[])
            ON CONFLICT DO NOTHING
            "#,
            id,
            &added_ids,
        )
        .execute(tx.as_mut())
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
        grant_members_edit(tx, id, added).await?;
    }

    Ok(())
}
