use entity_access_db_utils::EntityType;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, TeamLinkShareDefault, UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
};
use rootcause::prelude::*;
use share_permission_db_utils::{InsertChannelSharePermissionResult, team_share};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{AdapterError, GrantTargets, map_sqlx, require_description_document_id};
use crate::domain::models::{
    DescriptionDocumentId, InitiativeError, InitiativeId, LockstepTeamShareFacts,
};

pub(super) struct ShareTarget<'a> {
    entity_id: Uuid,
    entity_type: EntityType,
    share_permission_id: &'a str,
}

impl<'a> ShareTarget<'a> {
    pub(super) fn initiative(targets: &GrantTargets, share_permission_id: &'a str) -> Self {
        Self {
            entity_id: targets.initiative_id(),
            entity_type: EntityType::Initiative,
            share_permission_id,
        }
    }

    pub(super) fn description(targets: &GrantTargets, share_permission_id: &'a str) -> Self {
        Self {
            entity_id: targets.description_id(),
            entity_type: EntityType::Document,
            share_permission_id,
        }
    }
}

pub(super) async fn insert_share_permission(
    tx: &mut Transaction<'_, Postgres>,
    permission: &SharePermissionV2,
) -> Result<String, InitiativeError> {
    let link_share = permission.link_share;
    let link_share_access_level =
        normalize_link_share_access_level(link_share, permission.link_share_access_level);
    let link_share = link_share.map(|value| value.to_string());

    let row = sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            "linkShare",
            "linkShareAccessLevel",
            "createdAt",
            "updatedAt"
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        link_share,
        link_share_access_level as _,
    )
    .fetch_one(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    for channel in permission.channel_share_permissions.iter().flatten() {
        share_permission_db_utils::insert_channel_share_permission(
            tx.as_mut(),
            &row.id,
            &channel.channel_id,
            channel.access_level,
        )
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    }

    Ok(row.id)
}

pub(super) async fn description_share_permission_id(
    tx: &mut Transaction<'_, Postgres>,
    id: DescriptionDocumentId,
) -> Result<String, InitiativeError> {
    sqlx::query_scalar!(
        r#"
        SELECT "sharePermissionId"
        FROM "DocumentPermission"
        WHERE "documentId" = $1
        "#,
        id.to_string(),
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?
    .ok_or_else(|| {
        InitiativeError::Internal(report!("description document {id} has no share permission"))
    })
}

pub(super) async fn apply_share_patch(
    tx: &mut Transaction<'_, Postgres>,
    target: ShareTarget<'_>,
    update: &UpdateSharePermissionRequestV2,
) -> Result<(), InitiativeError> {
    let update_link_share = update.link_share.is_some();
    let link_share = update.link_share.flatten();
    let (update_link_share_access_level, link_share_access_level) = match update.link_share {
        Some(Some(_)) => (
            true,
            Some(link_share_access_level_or_default(
                update.link_share_access_level.flatten(),
            )),
        ),
        Some(None) => (true, None),
        None => (
            update.link_share_access_level.is_some(),
            update.link_share_access_level.flatten(),
        ),
    };
    let link_share = link_share.map(|value| value.to_string());

    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET
            "linkShare" = CASE WHEN $2 THEN $3 ELSE "linkShare" END,
            "linkShareAccessLevel" = CASE
                WHEN $2 AND $3 IS NULL THEN NULL
                WHEN $2 THEN COALESCE($5::"AccessLevel", 'view')
                WHEN $4 AND "linkShare" IS NOT NULL THEN COALESCE($5::"AccessLevel", 'view')
                WHEN $4 THEN NULL
                ELSE "linkShareAccessLevel"
            END,
            "updatedAt" = NOW()
        WHERE id = $1
        "#,
        target.share_permission_id,
        update_link_share,
        link_share,
        update_link_share_access_level,
        link_share_access_level as _,
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    let Some(channel_updates) = update.channel_share_permissions.as_ref() else {
        return Ok(());
    };

    entity_access_db_utils::update_entity_access_channel_share_permissions(
        tx,
        &target.entity_id,
        target.entity_type,
        channel_updates,
    )
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;

    for channel in channel_updates {
        match channel.operation {
            UpdateOperation::Add => {
                let insert = share_permission_db_utils::insert_channel_share_permission(
                    tx.as_mut(),
                    target.share_permission_id,
                    &channel.channel_id,
                    channel.access_level.unwrap_or(AccessLevel::View),
                )
                .await
                .map_err(AdapterError::Sqlx)
                .map_err(map_sqlx)?;
                if insert == InsertChannelSharePermissionResult::AlreadyExists {
                    update_channel_share_access(
                        tx,
                        target.share_permission_id,
                        &channel.channel_id,
                        channel.access_level.unwrap_or(AccessLevel::View),
                    )
                    .await?;
                }
            }
            UpdateOperation::Remove => {
                sqlx::query!(
                    r#"
                    DELETE FROM "ChannelSharePermission"
                    WHERE share_permission_id = $1 AND channel_id = $2
                    "#,
                    target.share_permission_id,
                    channel.channel_id,
                )
                .execute(tx.as_mut())
                .await
                .map_err(AdapterError::Sqlx)
                .map_err(map_sqlx)?;
            }
            UpdateOperation::Replace => {
                let updated = update_channel_share_access(
                    tx,
                    target.share_permission_id,
                    &channel.channel_id,
                    channel.access_level.unwrap_or(AccessLevel::View),
                )
                .await?;
                if !updated {
                    share_permission_db_utils::insert_channel_share_permission(
                        tx.as_mut(),
                        target.share_permission_id,
                        &channel.channel_id,
                        channel.access_level.unwrap_or(AccessLevel::View),
                    )
                    .await
                    .map_err(AdapterError::Sqlx)
                    .map_err(map_sqlx)?;
                }
            }
        }
    }
    Ok(())
}

async fn update_channel_share_access(
    tx: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_id: &str,
    access_level: AccessLevel,
) -> Result<bool, InitiativeError> {
    let result = sqlx::query!(
        r#"
        UPDATE "ChannelSharePermission"
        SET access_level = $3::text::"AccessLevel"
        WHERE share_permission_id = $1 AND channel_id = $2
        "#,
        share_permission_id,
        channel_id,
        access_level.to_string(),
    )
    .execute(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?;
    Ok(result.rows_affected() > 0)
}

pub(super) async fn get_lockstep_team_share_facts(
    pool: &PgPool,
    id: InitiativeId,
) -> Result<LockstepTeamShareFacts, InitiativeError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    let description_document_id = sqlx::query_scalar!(
        r#"
        SELECT description_document_id
        FROM initiative
        WHERE id = $1
        "#,
        id.as_uuid(),
    )
    .fetch_optional(tx.as_mut())
    .await
    .map_err(AdapterError::Sqlx)
    .map_err(map_sqlx)?
    .ok_or(InitiativeError::NotFound)?;
    let targets = GrantTargets::new(
        id,
        require_description_document_id(id.as_uuid(), description_document_id)?,
    );
    let initiative = team_share::load_facts(&mut tx, &targets.initiative_entity())
        .await
        .map_err(AdapterError::TeamShare)
        .map_err(map_sqlx)?;
    let description = team_share::load_facts(&mut tx, &targets.description_entity())
        .await
        .map_err(AdapterError::TeamShare)
        .map_err(map_sqlx)?;
    tx.commit()
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)?;
    Ok(LockstepTeamShareFacts {
        initiative,
        description,
    })
}

pub(super) async fn get_team_default_link_share(
    pool: &PgPool,
    user_id: &macro_user_id::user_id::MacroUserIdStr<'static>,
) -> Result<Option<TeamLinkShareDefault>, InitiativeError> {
    share_permission_db_utils::get_team_default_link_share(pool, user_id.as_ref())
        .await
        .map_err(AdapterError::Sqlx)
        .map_err(map_sqlx)
}

fn link_share_access_level_or_default(link_share_access_level: Option<AccessLevel>) -> AccessLevel {
    link_share_access_level.unwrap_or_else(|| {
        tracing::warn!(
            "link_share was enabled but link share access level was not provided, setting to view"
        );
        AccessLevel::View
    })
}

fn normalize_link_share_access_level(
    link_share: Option<LinkShare>,
    link_share_access_level: Option<AccessLevel>,
) -> Option<AccessLevel> {
    link_share.map(|_| link_share_access_level_or_default(link_share_access_level))
}
