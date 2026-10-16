//! Transactional facts and direct user grants for the shared access workflow.
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_owner::Owner;
use models_permissions::{
    share_permission::access_level::AccessLevel,
    sharing::{SharingFacts, SharingTeamRole},
};
use sqlx::{Postgres, Transaction};

#[cfg(test)]
mod test;

/// Load the live sharing target, locking its owning row through the transaction.
/// Unknown kinds fail closed. This is a facts reader; reviewer policy is a domain concern.
pub async fn facts(
    tx: &mut Transaction<'_, Postgres>,
    id: &macro_uuid::Uuid,
    kind: EntityType,
) -> anyhow::Result<Option<SharingFacts>> {
    let id_text = id.to_string();
    let identity: Option<(String, String, Option<String>)> = match kind {
        EntityType::Document => sqlx::query!(r#"SELECT owner, name, "fileType" AS file_type FROM "Document" WHERE id = $1 AND "deletedAt" IS NULL FOR SHARE"#, id_text)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner, r.name, r.file_type)),
        EntityType::Chat => sqlx::query!(r#"SELECT "userId" AS owner, name FROM "Chat" WHERE id = $1 AND "deletedAt" IS NULL FOR SHARE"#, id_text)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner, r.name, None)),
        EntityType::Project => sqlx::query!(r#"SELECT "userId" AS owner, name FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL FOR SHARE"#, id_text)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner, r.name, None)),
        EntityType::AgentSession => sqlx::query!("SELECT owner_id, name FROM agent_session WHERE id = $1 FOR SHARE", id)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner_id, r.name, None)),
        EntityType::Initiative => sqlx::query!("SELECT owner_user_id, name FROM initiative WHERE id = $1 FOR SHARE", id)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner_user_id, r.name, None)),
        EntityType::Database => sqlx::query!("SELECT user_id AS owner_id, name FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL FOR SHARE", id)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.owner_id, r.name, None)),
        EntityType::EmailThread => sqlx::query!("SELECT l.macro_id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE t.id = $1 FOR SHARE OF t, l", id)
            .fetch_optional(tx.as_mut()).await?.map(|r| (r.macro_id, "Email thread".into(), None)),
        EntityType::Call => {
            let live = sqlx::query!("SELECT created_by FROM calls WHERE id = $1 FOR SHARE", id).fetch_optional(tx.as_mut()).await?;
            if let Some(r) = live { Some((r.created_by, "Call".into(), None)) }
            else { sqlx::query!("SELECT created_by, custom_name FROM call_records WHERE id = $1 FOR SHARE", id)
                .fetch_optional(tx.as_mut()).await?.map(|r| (r.created_by, r.custom_name.unwrap_or_else(|| "Call".into()), None)) }
        }
        _ => None,
    };
    let Some((owner, name, file_type)) = identity else {
        return Ok(None);
    };
    let owner = Owner::from_principal_str(&owner)?;
    let sponsor = if let Owner::Bot(bot) = &owner {
        sqlx::query!("SELECT owner_user_id, team_id FROM bots WHERE id = $1 AND deleted_at IS NULL FOR SHARE", bot.as_uuid())
            .fetch_optional(tx.as_mut()).await?.map(|row| -> anyhow::Result<Option<Owner>> {
                match (row.owner_user_id, row.team_id) {
                    (Some(user), None) => Ok(Some(Owner::User(MacroUserIdStr::try_from(user)?))),
                    (None, Some(team)) => Ok(Some(Owner::Team(team))),
                    _ => Ok(None),
                }
            }).transpose()?.flatten()
    } else {
        None
    };
    let team_members = if let Owner::Team(team) = sponsor.as_ref().unwrap_or(&owner) {
        sqlx::query!("SELECT user_id, team_role AS \"team_role: SharingTeamRole\" FROM team_user WHERE team_id = $1 FOR SHARE", team)
            .fetch_all(tx.as_mut()).await?.into_iter().map(|r| Ok((MacroUserIdStr::try_from(r.user_id)?, r.team_role))).collect::<anyhow::Result<Vec<_>>>()?
    } else {
        Vec::new()
    };
    Ok(Some(SharingFacts {
        owner,
        sponsor,
        team_members,
        name,
        file_type,
    }))
}

/// List direct non-owner user grants. Inherited, channel and team grants are excluded.
pub async fn list(
    tx: &mut Transaction<'_, Postgres>,
    id: &macro_uuid::Uuid,
    kind: EntityType,
) -> anyhow::Result<Vec<(String, AccessLevel)>> {
    Ok(sqlx::query!(r#"SELECT source_id, access_level AS "access_level: AccessLevel" FROM entity_access WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'user' AND granted_from_project_id IS NULL AND access_level <> 'owner' ORDER BY source_id"#, id, kind.as_ref())
        .fetch_all(tx.as_mut()).await?.into_iter().map(|r| (r.source_id, r.access_level)).collect())
}

/// Write a direct grant and its folder descendants. `upgrade_only` preserves stronger grants.
/// Owner grants are never changed; removal affects only this grant's inheritance path.
pub async fn set(
    tx: &mut Transaction<'_, Postgres>,
    id: &macro_uuid::Uuid,
    kind: EntityType,
    user: &MacroUserIdStr<'_>,
    level: Option<AccessLevel>,
    upgrade_only: bool,
) -> anyhow::Result<()> {
    if let Some(level) = level {
        sqlx::query!(r#"INSERT INTO entity_access(entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, $2, $3, 'user', $4)
            ON CONFLICT (entity_id, entity_type, source_id, source_type) WHERE granted_from_project_id IS NULL
            DO UPDATE SET access_level = CASE WHEN $5 THEN GREATEST(entity_access.access_level, EXCLUDED.access_level) ELSE EXCLUDED.access_level END, updated_at = now()
            WHERE entity_access.access_level <> 'owner'"#, id, kind.as_ref(), user.as_ref(), level as _, upgrade_only).execute(tx.as_mut()).await?;
    } else {
        super::delete_user_entity_access_rows(tx, id, kind, std::slice::from_ref(user)).await?;
    }
    if kind != EntityType::Project {
        return Ok(());
    }
    let descendants = super::get_nested_project_entities(tx, id).await?;
    let project_id = id.to_string();
    // Remove only grants inherited from this folder. Explicit and other ancestor paths survive.
    sqlx::query!("DELETE FROM entity_access WHERE source_type = 'user' AND source_id = $1 AND granted_from_project_id = $2", user.as_ref(), project_id).execute(tx.as_mut()).await?;
    if level.is_some() {
        let effective = sqlx::query_scalar!(r#"SELECT access_level AS "access_level: AccessLevel" FROM entity_access WHERE entity_id = $1 AND entity_type = 'project' AND source_type = 'user' AND source_id = $2 AND granted_from_project_id IS NULL"#, id, user.as_ref()).fetch_one(tx.as_mut()).await?;
        for child in descendants {
            if child.entity_id == project_id && child.entity_type == "project" {
                continue;
            }
            // Legacy documents inherit through their project at read time.
            let Ok(child_id) = child.entity_id.parse::<macro_uuid::Uuid>() else {
                continue;
            };
            sqlx::query!(r#"INSERT INTO entity_access(entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
                VALUES ($1, $2, $3, 'user', $4, $5)
                ON CONFLICT (entity_id, entity_type, source_id, source_type, granted_from_project_id) WHERE granted_from_project_id IS NOT NULL
                DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now()"#, child_id, child.entity_type, user.as_ref(), effective as _, project_id).execute(tx.as_mut()).await?;
        }
    }
    Ok(())
}
