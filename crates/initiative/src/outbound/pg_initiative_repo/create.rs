use entity_access_db_utils::{
    AccessLevel, EntityAccessSourceType, EntityType, delete_entity_access_rows,
    insert_entity_access_row,
};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::team_share::TeamShareCreation;
use share_permission_db_utils::team_share;
use sqlx::{PgPool, Postgres, Transaction};

use super::{AdapterError, description_to_db, entity_of, map_sqlx, require_detail};
use crate::domain::models::{
    CreateInitiativeRepoArgs, InitiativeDetail, InitiativeError, InitiativeId,
    UpdateInitiativeRepoArgs,
};

pub(super) async fn create(
    pool: &PgPool,
    args: CreateInitiativeRepoArgs,
    share_permission: SharePermissionV2,
    team_share: TeamShareCreation,
) -> Result<InitiativeDetail, InitiativeError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let id = args.id.as_uuid();
    let entity = entity_of(args.id);

    team_share::acquire_guard(&mut tx)
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    let share_permission_id =
        super::share::insert_share_permission(&mut tx, &share_permission).await?;

    sqlx::query!(
        r#"
        INSERT INTO initiative (
            id,
            name,
            description,
            owner_user_id,
            share_permission_id
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
        id,
        args.name,
        description_to_db(args.description.as_deref()),
        args.owner_id.as_ref(),
        share_permission_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    super::members::insert_members(&mut tx, id, &args.member_ids).await?;

    insert_entity_access_row(
        &mut tx,
        &id,
        EntityType::Initiative,
        args.owner_id.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    super::members::grant_members_edit(&mut tx, id, &args.member_ids).await?;

    team_share::initialize(&mut tx, &entity, team_share)
        .await
        .map_err(AdapterError::TeamShareCreate)
        .map_err(map_sqlx)?;

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    require_detail(pool, args.id).await
}

pub(super) async fn update(
    pool: &PgPool,
    args: UpdateInitiativeRepoArgs,
) -> Result<InitiativeDetail, InitiativeError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let id = args.id.as_uuid();

    if args.team_share.is_some() {
        team_share::acquire_guard(&mut tx)
            .await
            .map_err(AdapterError::Sqlx)
            .map_err(map_sqlx)?;
    }

    patch_initiative_row(&mut tx, &args).await?;
    super::members::apply_member_diff(
        &mut tx,
        id,
        &args.member_ids_added,
        &args.member_ids_removed,
    )
    .await?;

    if let Some(update) = &args.share_permission {
        super::share::patch_share_permission(&mut tx, id, update).await?;
    }

    if let Some(command) = &args.team_share {
        if command.expected().entity.entity_type != model_entity::EntityType::Initiative
            || command.expected().entity.entity_id != args.id.to_string()
            || args
                .share_permission
                .as_ref()
                .and_then(|permission| permission.team_share_access_level)
                != Some(command.target().map(|grant| grant.level.into()))
        {
            return Err(InitiativeError::BadRequest(
                "team-share command does not match edit".to_string(),
            ));
        }
        team_share::apply(&mut tx, command)
            .await
            .map_err(AdapterError::TeamShare)
            .map_err(map_sqlx)?;
    }

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    require_detail(pool, args.id).await
}

pub(super) async fn delete(pool: &PgPool, id: InitiativeId) -> Result<(), InitiativeError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let uuid = id.as_uuid();

    delete_entity_access_rows(&mut tx, &uuid, EntityType::Initiative)
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    let share_permission_id = sqlx::query_scalar!(
        r#"
        DELETE FROM initiative
        WHERE id = $1
        RETURNING share_permission_id
        "#,
        uuid,
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?
    .ok_or(InitiativeError::NotFound)?;

    sqlx::query!(
        r#"
        DELETE FROM "SharePermission"
        WHERE id = $1
        "#,
        share_permission_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    Ok(())
}

async fn patch_initiative_row(
    tx: &mut Transaction<'_, Postgres>,
    args: &UpdateInitiativeRepoArgs,
) -> Result<(), InitiativeError> {
    let description_value = args
        .description
        .as_ref()
        .map(|description| description_to_db(description.as_deref()))
        .unwrap_or("");
    let result = sqlx::query!(
        r#"
        UPDATE initiative
        SET
            name = CASE WHEN $2 THEN $3 ELSE name END,
            description = CASE WHEN $4 THEN $5 ELSE description END,
            updated_at = now()
        WHERE id = $1
        "#,
        args.id.as_uuid(),
        args.name.is_some(),
        args.name.as_deref(),
        args.description.is_some(),
        description_value,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;
    if result.rows_affected() == 0 {
        return Err(InitiativeError::NotFound);
    }
    Ok(())
}
