#![deny(missing_docs)]

//! entity_access_db_utils crate contains common db queries that are required when manipulating entity_access table.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
pub use model_entity::EntityType;
pub use models_entity_access_management::EntityAccessSourceType;
pub use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Executor, Postgres, QueryBuilder, Transaction};

/// Inserts a row into the entity access table
/// *NOTE*: The transaction does not get committed automatically
#[tracing::instrument(skip(transaction), err)]
pub async fn insert_entity_access_row(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    source_id: &str,
    source_type: EntityAccessSourceType,
    access_level: AccessLevel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, $2, $3, $4, $5)
        "#,
        entity_id,
        entity_type.as_ref(),
        source_id,
        source_type as _,
        access_level as _,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Deletes all entity_access rows for a given (entity_id, entity_type).
/// *NOTE*: The transaction does not get committed automatically.
#[tracing::instrument(skip(transaction), err)]
pub async fn delete_entity_access_rows(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2
        "#,
        entity_id,
        entity_type.as_ref(),
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Bulk upserts entity access for users
#[tracing::instrument(skip(executor), err)]
pub async fn upsert_user_entity_access_bulk<'e, E>(
    executor: E,
    user_ids: &[MacroUserIdStr<'_>],
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    access_level: AccessLevel,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    if user_ids.is_empty() {
        return Ok(());
    }

    let macro_ids: Vec<String> = user_ids.iter().map(|s| s.to_string()).collect();

    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT $1, $2, u.user_id, 'user', $3
        FROM UNNEST($4::text[]) as u(user_id)
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        AND access_level != 'owner' -- this prevents us from overriding the owner user
        DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
        "#,
        entity_id,
        entity_type.as_ref(),
        access_level as _,
        macro_ids.as_slice(),
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Simple entity wrapper
#[derive(Clone, Debug)]
pub struct SimpleEntity {
    /// The entity id
    pub entity_id: String,
    /// The entity type
    pub entity_type: String,
}

/// Gets all nested entities for a given project
/// Includes the project itself
#[tracing::instrument(skip(transaction), err)]
pub async fn get_nested_project_entities(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &macro_uuid::Uuid,
) -> Result<Vec<SimpleEntity>, sqlx::Error> {
    let results = sqlx::query!(
            r#"
            WITH RECURSIVE child_projects AS (
                SELECT id FROM "Project" WHERE id = $1

                UNION ALL

                SELECT p.id FROM "Project" p
                INNER JOIN child_projects cp ON p."parentId" = cp.id
            )
            SELECT id as "entity_id!", 'project' as "entity_type!" FROM child_projects

            UNION ALL

            SELECT d.id as "entity_id!", 'document' as "entity_type!" FROM "Document" d
            WHERE d."projectId" IN (SELECT id FROM child_projects)

            UNION ALL

            SELECT c.id as "entity_id!", 'chat' as "entity_type!" FROM "Chat" c
            WHERE c."projectId" IN (SELECT id FROM child_projects)

            UNION ALL

            SELECT et.id::text as "entity_id!", 'email_thread' as "entity_type!" FROM email_threads et
            WHERE et.project_id IN (SELECT id FROM child_projects)
            "#,
            &project_id.to_string()
        )
        .map(|r| SimpleEntity {
            entity_id: r.entity_id,
            entity_type: r.entity_type,
        })
        .fetch_all(transaction.as_mut())
        .await?;

    Ok(results)
}

/// Walks up the project tree and grabs all projects including the project provided id
#[tracing::instrument(skip(transaction), err)]
pub async fn walk_up_project_tree(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &macro_uuid::Uuid,
) -> Result<Vec<macro_uuid::Uuid>, sqlx::Error> {
    let results = sqlx::query!(
        r#"
            WITH RECURSIVE parent_projects AS (
                -- Base case: the project itself
                SELECT id, name, "parentId"
                FROM "Project"
                WHERE id = $1

                UNION ALL

                -- Recursive case: walk up to the parent
                SELECT p.id, p.name, p."parentId"
                FROM "Project" p
                INNER JOIN parent_projects pp ON p.id = pp."parentId"
            )
            SELECT id as "id!"
            FROM parent_projects
            "#,
        &project_id.to_string()
    )
    .map(|p| macro_uuid::string_to_uuid(&p.id).unwrap()) // SAFETY: the project_id is always a uuid, we just haven't migrated the type to be that in the db schema
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(results)
}

/// Updates the entity_access table according to the UpdateChannelSharePermission request.
/// *NOTE*: This strictly updates `entity_access` table. It does not update any other tables.
#[tracing::instrument(skip(transaction), err)]
pub async fn update_entity_access_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &macro_uuid::Uuid,
    entity_type: EntityType,
    channel_perms: &[UpdateChannelSharePermission],
) -> Result<(), sqlx::Error> {
    let mut upsert_channel_ids = Vec::new();
    let mut remove_channel_ids = Vec::new();

    for perm in channel_perms {
        match perm.operation {
            UpdateOperation::Add | UpdateOperation::Replace => {
                upsert_channel_ids.push((
                    perm.channel_id.clone(),
                    perm.access_level.unwrap_or(AccessLevel::View),
                ));
            }
            UpdateOperation::Remove => {
                remove_channel_ids.push(perm.channel_id.clone());
            }
        }
    }

    // We need to remove all required items from entity_access for the given entity id for all channels
    if !remove_channel_ids.is_empty() {
        match entity_type {
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::StaticFile
            | EntityType::ForeignEntity => {
                unreachable!()
            }
            EntityType::Project => {
                // Get all items in project
                let project_items = get_nested_project_entities(transaction, entity_id).await?;

                sqlx::query!(
                    r#"
                    DELETE FROM entity_access
                    WHERE (source_id = ANY($1) AND source_type = 'channel')
                    AND (entity_id = ANY($2) OR granted_from_project_id = ANY($3))
                    "#,
                    &remove_channel_ids,
                    &project_items
                        .iter()
                        .map(|p| macro_uuid::string_to_uuid(&p.entity_id).unwrap())
                        .collect::<Vec<macro_uuid::Uuid>>(),
                    &project_items
                        .iter()
                        .filter_map(|p| {
                            if p.entity_type == "project" {
                                Some(p.entity_id.clone())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<String>>(),
                )
                .execute(transaction.as_mut())
                .await?;
            }
            EntityType::Chat
            | EntityType::Document
            | EntityType::EmailThread
            | EntityType::Call => {
                sqlx::query!(
                    r#"
                    DELETE FROM entity_access
                    WHERE entity_id = $1 AND entity_type = $2
                    AND source_id = ANY($3) AND source_type = 'channel'
                    "#,
                    entity_id,
                    entity_type.as_ref(),
                    &remove_channel_ids,
                )
                .execute(transaction.as_mut())
                .await?;
            }
        }
    }

    // We need to upsert all required items into entity_access for all channels with the desired access level
    if !upsert_channel_ids.is_empty() {
        match entity_type {
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::StaticFile
            | EntityType::ForeignEntity => {
                unreachable!()
            }
            EntityType::Project => {
                // (a) Direct grant on the project itself (granted_from_project_id IS NULL)
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) ",
                );
                qb.push_values(&upsert_channel_ids, |mut b, (channel_id, access_level)| {
                    b.push_bind(entity_id)
                        .push_bind("project")
                        .push_bind(channel_id)
                        .push_bind(EntityAccessSourceType::Channel)
                        .push_bind(*access_level);
                });
                qb.push(
                    " ON CONFLICT (entity_id, entity_type, source_id, source_type) \
                      WHERE granted_from_project_id IS NULL \
                      DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()",
                );
                qb.build().execute(transaction.as_mut()).await?;

                // (b) Inherited grants on every nested entity (granted_from_project_id = project_id)
                let project_items = get_nested_project_entities(transaction, entity_id).await?;
                let granted_from = entity_id.to_string();

                // Cross-join nested entities × upsert channel perms, excluding the
                // project itself (already covered by step (a) under a different
                // partial unique index).
                let rows: Vec<_> = project_items
                    .iter()
                    .filter(|e| !(e.entity_type == "project" && e.entity_id == granted_from))
                    .filter_map(|e| {
                        macro_uuid::string_to_uuid(&e.entity_id)
                            .ok()
                            .map(|id| (id, e.entity_type.clone()))
                    })
                    .flat_map(|(nested_id, nested_type)| {
                        upsert_channel_ids
                            .iter()
                            .map(move |(channel_id, access_level)| {
                                (
                                    nested_id,
                                    nested_type.clone(),
                                    channel_id.clone(),
                                    *access_level,
                                )
                            })
                    })
                    .collect();

                if !rows.is_empty() {
                    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
                    );
                    qb.push_values(
                        &rows,
                        |mut b, (nested_id, nested_type, channel_id, access_level)| {
                            b.push_bind(nested_id)
                                .push_bind(nested_type)
                                .push_bind(channel_id)
                                .push_bind(EntityAccessSourceType::Channel)
                                .push_bind(*access_level)
                                .push_bind(&granted_from);
                        },
                    );
                    qb.push(
                        " ON CONFLICT (entity_id, entity_type, source_id, source_type, granted_from_project_id) \
                          WHERE granted_from_project_id IS NOT NULL \
                          DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()",
                    );
                    qb.build().execute(transaction.as_mut()).await?;
                }
            }
            EntityType::Chat
            | EntityType::Document
            | EntityType::EmailThread
            | EntityType::Call => {
                let entity_type_str = entity_type.as_ref();

                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) ",
                );
                qb.push_values(&upsert_channel_ids, |mut b, (channel_id, access_level)| {
                    b.push_bind(entity_id)
                        .push_bind(entity_type_str)
                        .push_bind(channel_id)
                        .push_bind(EntityAccessSourceType::Channel)
                        .push_bind(*access_level);
                });
                qb.push(
                    " ON CONFLICT (entity_id, entity_type, source_id, source_type) \
                      WHERE granted_from_project_id IS NULL \
                      DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()",
                );
                qb.build().execute(transaction.as_mut()).await?;
            }
        }
    }

    Ok(())
}
