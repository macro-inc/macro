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

use super::{
    AdapterError, GrantTargets, description_location, map_sqlx, parse_description_document_id,
    require_detail,
};
use crate::domain::models::{
    CreateInitiativeRepoArgs, DeletedInitiative, DescriptionDocumentId, InitiativeDetail,
    InitiativeError, InitiativeId, UpdateInitiativeRepoArgs,
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
    let document = args.description_document_id;
    let targets = GrantTargets::new(args.id, Some(document));

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
            share_permission_id,
            description_surface_id,
            description_document_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        id,
        args.name,
        args.owner_id.as_ref(),
        share_permission_id,
        document.adopting_surface().as_uuid(),
        document.to_string(),
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    super::members::insert_members(&mut tx, id, &args.member_ids).await?;

    // Owner on the document was written when the documents side created it.
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

    team_share::initialize(
        &mut tx,
        &EntityType::Document.with_entity_string(document.to_string()),
        description_team_share(team_share),
    )
    .await
    .map_err(|error| InitiativeError::Internal(error.into()))?;

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    require_detail(pool, args.id).await
}

/// Team share on the document follows the initiative's create-time intent.
fn description_team_share(intent: TeamShareCreation) -> TeamShareCreation {
    match intent {
        TeamShareCreation::Initiative => TeamShareCreation::InitiativeDescription,
        other => other,
    }
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

    let patched = patch_initiative_row(&mut tx, &args).await?;
    let targets = GrantTargets::new(args.id, patched.description_document_id);

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
            super::share::ShareTarget::initiative(&targets, &patched.share_permission_id),
            update,
        )
        .await?;
        if let Some(document) = patched.description_document_id {
            let description_share_permission_id =
                super::share::description_share_permission_id(&mut tx, document).await?;
            super::share::apply_share_patch(
                &mut tx,
                super::share::ShareTarget::description(document, &description_share_permission_id),
                update,
            )
            .await?;
        }
    }

    if let Some(lockstep) = &args.team_share {
        let requested = args
            .share_permission
            .as_ref()
            .and_then(|permission| permission.team_share_access_level);
        let matches_edit = |command: &AuthorizedTeamShareCommand, entity: Entity<'static>| {
            command.expected().entity == entity
                && requested == Some(command.target().map(|grant| grant.level.into()))
        };
        // A linked document needs its own command; a document-less initiative has none.
        let description_matches = match (&lockstep.description, targets.description_entity()) {
            (Some(command), Some(entity)) => matches_edit(command, entity),
            (None, None) => true,
            _ => false,
        };
        if !matches_edit(&lockstep.initiative, targets.initiative_entity()) || !description_matches
        {
            return Err(InitiativeError::BadRequest(
                "team-share command does not match edit".to_string(),
            ));
        }
        team_share::apply(&mut tx, &lockstep.initiative)
            .await
            .map_err(AdapterError::TeamShare)
            .map_err(map_sqlx)?;
        if let Some(description) = &lockstep.description {
            team_share::apply(&mut tx, description)
                .await
                .map_err(AdapterError::TeamShare)
                .map_err(map_sqlx)?;
        }
    }

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    require_detail(pool, args.id).await
}

/// The document's rows and the description surface are untouched here. The service cleans
/// them up after this commits.
pub(super) async fn delete(
    pool: &PgPool,
    id: InitiativeId,
) -> Result<DeletedInitiative, InitiativeError> {
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
        RETURNING
            share_permission_id,
            description_surface_id,
            description_document_id AS "description_document_id?"
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

    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;

    Ok(DeletedInitiative {
        description: description_location(
            uuid,
            deleted.description_surface_id,
            deleted.description_document_id.as_deref(),
        )?,
    })
}

struct PatchedRow {
    share_permission_id: String,
    description_document_id: Option<DescriptionDocumentId>,
}

async fn patch_initiative_row(
    tx: &mut Transaction<'_, Postgres>,
    args: &UpdateInitiativeRepoArgs,
) -> Result<PatchedRow, InitiativeError> {
    let row = sqlx::query!(
        r#"
        UPDATE initiative
        SET
            name = CASE WHEN $2 THEN $3 ELSE name END,
            updated_at = now()
        WHERE id = $1
        RETURNING share_permission_id, description_document_id AS "description_document_id?"
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
    Ok(PatchedRow {
        share_permission_id: row.share_permission_id,
        description_document_id: parse_description_document_id(
            args.id.as_uuid(),
            row.description_document_id.as_deref(),
        )?,
    })
}
