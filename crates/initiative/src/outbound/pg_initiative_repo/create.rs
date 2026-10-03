use entity_access_db_utils::{
    AccessLevel, EntityAccessSourceType, EntityType, delete_entity_access_rows,
    insert_entity_access_row,
};
use model_entity::Entity;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareCreation,
};
use share_permission_db_utils::team_share;
use sqlx::{PgPool, Postgres, Transaction};

use super::{AdapterError, GrantTargets, map_sqlx, require_detail};
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
    let targets = GrantTargets::new(args.id);

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
            owner_user_id,
            share_permission_id
        )
        VALUES ($1, $2, $3, $4)
        "#,
        id,
        args.name,
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

    super::members::grant_members_edit(&mut tx, &targets, &args.member_ids).await?;

    team_share::initialize(&mut tx, &targets.initiative_entity(), team_share)
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

    if args.team_share.is_some() {
        team_share::acquire_guard(&mut tx)
            .await
            .map_err(AdapterError::Sqlx)
            .map_err(map_sqlx)?;
    }

    let share_permission_id = patch_initiative_row(&mut tx, &args).await?;
    let targets = GrantTargets::new(args.id);

    super::members::apply_member_diff(
        &mut tx,
        &targets,
        &args.member_ids_added,
        &args.member_ids_removed,
    )
    .await?;

    if let Some(update) = &args.share_permission {
        super::share::apply_share_patch(
            &mut tx,
            super::share::ShareTarget::initiative(&targets, &share_permission_id),
            update,
        )
        .await?;
    }

    if let Some(command) = &args.team_share {
        let requested = args
            .share_permission
            .as_ref()
            .and_then(|permission| permission.team_share_access_level);
        let matches_edit = |command: &AuthorizedTeamShareCommand, entity: Entity<'static>| {
            command.expected().entity == entity
                && requested == Some(command.target().map(|grant| grant.level.into()))
        };
        if !matches_edit(command, targets.initiative_entity()) {
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

    let deleted = sqlx::query!(
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
        deleted.share_permission_id,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    // Its tasks leave the project with it. The literal is
    // SystemPropertyKey::PROJECT_UUID, matching the partial index.
    sqlx::query!(
        r#"
        DELETE FROM entity_properties
        WHERE property_definition_id = '00000001-0000-0000-0000-000000000014'
          AND values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1::text))
        "#,
        uuid.to_string(),
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

/// Returns the initiative's share permission id.
async fn patch_initiative_row(
    tx: &mut Transaction<'_, Postgres>,
    args: &UpdateInitiativeRepoArgs,
) -> Result<String, InitiativeError> {
    let row = sqlx::query!(
        r#"
        UPDATE initiative
        SET
            name = CASE WHEN $2 THEN $3 ELSE name END,
            updated_at = now()
        WHERE id = $1
        RETURNING share_permission_id
        "#,
        args.id.as_uuid(),
        args.name.is_some(),
        args.name.as_deref(),
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?
    .ok_or(InitiativeError::NotFound)?;
    Ok(row.share_permission_id)
}
