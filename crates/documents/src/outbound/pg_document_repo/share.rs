//! SQL operations for the document team-share toggle.
//!
//! The single source of truth for "shared with the owner's team" is the
//! `"SharePermission"."teamShareAccessLevel"` column; every write here updates
//! that column and mirrors it onto the owner's team `entity_access` row via
//! [`entity_access_db_utils::set_team_entity_access`] in the same transaction.

use entity_access_db_utils::{AccessLevel, EntityType};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::DocumentTeamShare;

fn document_uuid(document_id: &str) -> Result<Uuid, sqlx::Error> {
    macro_uuid::string_to_uuid(document_id).map_err(|e| sqlx::Error::Protocol(e.to_string()))
}

/// Resolve the document owner's team. Returns `None` when the document does
/// not exist or the owner does not belong to a team.
async fn owner_team_id(
    conn: &mut PgConnection,
    document_id: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let Some(owner) =
        sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = $1"#, document_id)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Ok(None);
    };

    share_permission_db_utils::get_user_team_id(conn, &owner).await
}

/// Read the document's `"teamShareAccessLevel"`; `None` when the document is
/// not shared with the owner's team (or has no share permission row).
async fn team_share_access_level(
    conn: &mut PgConnection,
    document_id: &str,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let level = sqlx::query_scalar!(
        r#"
        SELECT sp."teamShareAccessLevel" as "team_share_access_level?: AccessLevel"
        FROM "SharePermission" sp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = sp.id
        WHERE dp."documentId" = $1
        "#,
        document_id,
    )
    .fetch_optional(conn)
    .await?;

    Ok(level.flatten())
}

/// Set the document's `"teamShareAccessLevel"` column (`None` clears it).
async fn set_team_share_access_level(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    access_level: Option<AccessLevel>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE "SharePermission" sp
        SET "teamShareAccessLevel" = $2, "updatedAt" = NOW()
        FROM "DocumentPermission" dp
        WHERE dp."sharePermissionId" = sp.id
          AND dp."documentId" = $1
        "#,
        document_id,
        access_level as _,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Share a document with the given team at Comment level, without downgrading
/// an existing team share. Used when a task is created with "share with team".
#[tracing::instrument(err, skip(pool))]
pub async fn share_with_team(
    pool: &PgPool,
    team_id: &Uuid,
    document_id: &str,
) -> Result<(), sqlx::Error> {
    let document_uuid = document_uuid(document_id)?;
    let mut transaction = pool.begin().await?;

    let access_level = sqlx::query_scalar!(
        r#"
        UPDATE "SharePermission" sp
        SET "teamShareAccessLevel" = COALESCE(sp."teamShareAccessLevel", 'comment'::"AccessLevel"),
            "updatedAt" = NOW()
        FROM "DocumentPermission" dp
        WHERE dp."sharePermissionId" = sp.id
          AND dp."documentId" = $1
        RETURNING sp."teamShareAccessLevel" as "team_share_access_level!: AccessLevel"
        "#,
        document_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    entity_access_db_utils::set_team_entity_access(
        &mut transaction,
        &document_uuid,
        EntityType::Document,
        team_id,
        Some(access_level),
    )
    .await?;

    transaction.commit().await?;
    Ok(())
}

/// Get the team-share state of a document, resolved against the owner's team.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_share(
    pool: &PgPool,
    document_id: &str,
) -> Result<DocumentTeamShare, sqlx::Error> {
    let mut conn = pool.acquire().await?;

    let team_id = owner_team_id(&mut conn, document_id).await?;
    let access_level = team_share_access_level(&mut conn, document_id).await?;

    Ok(DocumentTeamShare {
        team_id,
        shared_with_team: access_level.is_some(),
    })
}

/// Grant or revoke the document owner's team's access on the document.
///
/// Granting sets `"teamShareAccessLevel"` to Edit so teammates can
/// collaboratively maintain team snippets; revoking clears it. Both mirror the
/// team-source `entity_access` row (project-granted rows are left untouched).
/// Returns the new state, or the unshared state (with nothing written) when the
/// owner has no team and a share was requested.
#[tracing::instrument(err, skip(pool))]
pub async fn set_team_share(
    pool: &PgPool,
    document_id: &str,
    share: bool,
) -> Result<DocumentTeamShare, sqlx::Error> {
    let document_uuid = document_uuid(document_id)?;
    let mut transaction = pool.begin().await?;

    let Some(team_id) = owner_team_id(transaction.as_mut(), document_id).await? else {
        if !share {
            // Nobody to revoke from, but keep the column honest.
            set_team_share_access_level(&mut transaction, document_id, None).await?;
            transaction.commit().await?;
        }
        return Ok(DocumentTeamShare {
            team_id: None,
            shared_with_team: false,
        });
    };

    let access_level = share.then_some(AccessLevel::Edit);
    set_team_share_access_level(&mut transaction, document_id, access_level).await?;
    entity_access_db_utils::set_team_entity_access(
        &mut transaction,
        &document_uuid,
        EntityType::Document,
        &team_id,
        access_level,
    )
    .await?;

    transaction.commit().await?;

    Ok(DocumentTeamShare {
        team_id: Some(team_id),
        shared_with_team: share,
    })
}
