//! Project inheritance in the caller's transaction, using persisted topology.
//!
//! Acquire [`crate::team_share::acquire_guard`] BEFORE changing parent assignments,
//! then call [`synchronize_entity`] before committing. These helpers reacquire the
//! guard, never commit, and require rollback of the entire transaction on failure.
//! Calls have no project membership and are intentionally unsupported.

use crate::{AccessLevel, EntityAccessSourceType, EntityType, SimpleEntity};
use macro_uuid::Uuid;
use sqlx::{Postgres, QueryBuilder, Transaction};

#[cfg(test)]
mod test;

/// A direct project grant, attributed to the project that explicitly supplied it.
#[derive(Clone, Debug)]
pub struct ProjectSourceEntity {
    /// Explicit sharing project, not an intermediate inheriting project.
    pub project_id: Uuid,
    /// User, channel, or team receiving access.
    pub source_id: String,
    /// Kind of recipient.
    pub source_type: EntityAccessSourceType,
    /// Exact access level to inherit.
    pub access_level: AccessLevel,
}

/// Read direct grants only; inherited grants must never become new sharing roots.
pub async fn get_all_source_entities_for_projects(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[Uuid],
) -> Result<Vec<ProjectSourceEntity>, sqlx::Error> {
    sqlx::query!(
        r#"SELECT entity_id, source_id,
            source_type as "source_type:EntityAccessSourceType",
            access_level as "access_level:AccessLevel"
        FROM entity_access
        WHERE entity_id = ANY($1) AND entity_type = 'project'
          AND granted_from_project_id IS NULL"#,
        project_ids,
    )
    .map(|r| ProjectSourceEntity {
        project_id: r.entity_id,
        source_id: r.source_id,
        source_type: r.source_type,
        access_level: r.access_level,
    })
    .fetch_all(transaction.as_mut())
    .await
}

/// Reconcile an entity (and, for projects, its entire subtree) from current parents.
/// Stale add/remove/move arguments are deliberately unnecessary. Direct grants are
/// untouched; each current ancestor's independent contribution is retained/refreshed.
pub async fn synchronize_entity(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Result<(), sqlx::Error> {
    if !matches!(
        entity_type,
        EntityType::Project | EntityType::Document | EntityType::Chat | EntityType::EmailThread
    ) {
        return Err(sqlx::Error::InvalidArgument(format!(
            "no project membership for {entity_type:?}"
        )));
    }
    crate::team_share::acquire_guard(transaction).await?;
    let entities = if entity_type == EntityType::Project {
        crate::get_nested_project_entities(transaction, entity_id).await?
    } else {
        vec![SimpleEntity {
            entity_id: entity_id.to_string(),
            entity_type: entity_type.to_string(),
        }]
    };
    for entity in entities {
        // Legacy text IDs cannot have UUID-keyed entity_access rows.
        let Ok(id) = Uuid::parse_str(&entity.entity_id) else {
            continue;
        };
        let parent = sqlx::query_scalar!(
            r#"SELECT "parentId" AS parent_id FROM "Project" WHERE $2 = 'project' AND id = $1
            UNION ALL SELECT "projectId" FROM "Document" WHERE $2 = 'document' AND id = $1
            UNION ALL SELECT "projectId" FROM "Chat" WHERE $2 = 'chat' AND id = $1
            UNION ALL SELECT project_id FROM email_threads WHERE $2 = 'email_thread' AND id = $3"#,
            entity.entity_id,
            entity.entity_type,
            id,
        )
        .fetch_optional(transaction.as_mut())
        .await?
        .flatten();
        let ancestors = match parent {
            Some(parent) => {
                let parent =
                    Uuid::parse_str(&parent).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
                crate::walk_up_project_tree(transaction, &parent).await?
            }
            None => Vec::new(),
        };
        let sources = get_all_source_entities_for_projects(transaction, &ancestors).await?;
        // Remove obsolete contributions only. Upsert surviving ones to handle downgrades.
        sqlx::query!(
            r#"DELETE FROM entity_access inherited
            WHERE inherited.entity_id = $1 AND inherited.entity_type = $2
              AND inherited.granted_from_project_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM entity_access direct
                WHERE direct.entity_id = ANY($3) AND direct.entity_type = 'project'
                  AND direct.granted_from_project_id IS NULL
                  AND direct.entity_id::text = inherited.granted_from_project_id
                  AND direct.source_id = inherited.source_id
                  AND direct.source_type = inherited.source_type
              )"#,
            id,
            entity.entity_type,
            &ancestors,
        )
        .execute(transaction.as_mut())
        .await?;
        upsert_inherited(transaction, &[(id, entity.entity_type)], &sources).await?;
    }
    Ok(())
}

/// Synchronize only one explicitly sharing project's contribution for one managed team.
/// Passing NULL revokes that contribution everywhere, including formerly nested items.
/// Other roots, teams and direct descendant grants are never changed. The canonical
/// permission writer supplies the level/team after rechecking its authoritative facts.
pub async fn synchronize_project_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &Uuid,
    managed_team_id: Uuid,
    level: Option<AccessLevel>,
) -> Result<(), sqlx::Error> {
    crate::team_share::acquire_guard(transaction).await?;
    let root = project_id.to_string();
    let entities: Vec<_> = crate::get_nested_project_entities(transaction, project_id)
        .await?
        .into_iter()
        .filter(|e| !(e.entity_type == "project" && e.entity_id == root))
        .filter_map(|e| {
            Uuid::parse_str(&e.entity_id)
                .ok()
                .map(|id| (id, e.entity_type))
        })
        .collect();
    let ids: Vec<_> = entities.iter().map(|(id, _)| *id).collect();
    let types: Vec<_> = entities.iter().map(|(_, kind)| kind.clone()).collect();
    sqlx::query!(
        r#"DELETE FROM entity_access ea
        WHERE granted_from_project_id = $1 AND source_type = 'team' AND source_id = $2
          AND entity_type IN ('project', 'document', 'chat', 'email_thread')
          AND ($3 OR NOT EXISTS (
            SELECT 1 FROM UNNEST($4::uuid[], $5::text[]) AS current(entity_id, entity_type)
            WHERE current.entity_id = ea.entity_id AND current.entity_type = ea.entity_type
          ))"#,
        root,
        managed_team_id.to_string(),
        level.is_none(),
        &ids,
        &types,
    )
    .execute(transaction.as_mut())
    .await?;
    if let Some(access_level) = level {
        upsert_inherited(
            transaction,
            &entities,
            &[ProjectSourceEntity {
                project_id: *project_id,
                source_id: managed_team_id.to_string(),
                source_type: EntityAccessSourceType::Team,
                access_level,
            }],
        )
        .await?;
    }
    Ok(())
}

async fn upsert_inherited(
    transaction: &mut Transaction<'_, Postgres>,
    entities: &[(Uuid, String)],
    sources: &[ProjectSourceEntity],
) -> Result<(), sqlx::Error> {
    // Bound each batch below PostgreSQL's parameter limit (six parameters per row).
    let rows: Vec<_> = entities
        .iter()
        .flat_map(|entity| sources.iter().map(move |source| (entity, source)))
        .collect();
    for batch in rows.chunks(1000) {
        let mut query = QueryBuilder::<Postgres>::new(
            "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
        );
        query.push_values(batch, |mut row, ((id, kind), source)| {
            row.push_bind(id)
                .push_bind(kind)
                .push_bind(&source.source_id)
                .push_bind(source.source_type)
                .push_bind(source.access_level)
                .push_bind(source.project_id.to_string());
        });
        query.push(" ON CONFLICT (entity_id, entity_type, source_id, source_type, granted_from_project_id) WHERE granted_from_project_id IS NOT NULL DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()");
        query.build().execute(transaction.as_mut()).await?;
    }
    Ok(())
}
