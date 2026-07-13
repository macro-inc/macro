//! PostgreSQL implementation of the EntityAccessManagementRepository trait.

#[cfg(test)]
mod test;

use entity_access_db_utils::SimpleEntity;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{PgPool, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::domain::{models::EntityAccessSourceType, ports::EntityAccessManagementRepository};

/// A source entity we need to update permissions for
#[derive(Clone, Debug)]
struct ProjectSourceEntity {
    /// The project entity that was shared
    pub project_id: uuid::Uuid,
    /// This could be a user, channel or a team
    pub source_id: String,
    /// The source type
    pub source_type: EntityAccessSourceType,
    /// The access level for the source entity
    pub access_level: AccessLevel,
}

/// PostgreSQL-backed implementation of [`EntityAccessManagementRepository`]
#[derive(Clone)]
pub struct PgRepository {
    pool: PgPool,
}

impl PgRepository {
    /// Create a new PgRepository
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl PgRepository {
    /// Gets all nested entities for a given project
    /// Includes the project itself
    #[tracing::instrument(skip(self, transaction), err)]
    async fn get_nested_project_entities(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        project_id: &uuid::Uuid,
    ) -> Result<Vec<SimpleEntity>, sqlx::Error> {
        entity_access_db_utils::get_nested_project_entities(transaction, project_id).await
    }

    /// Walks up the project tree and grabs all projects including the project provided id
    #[tracing::instrument(skip(self, transaction), err)]
    async fn walk_up_project_tree(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        project_id: &uuid::Uuid,
    ) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
        entity_access_db_utils::walk_up_project_tree(transaction, project_id).await
    }

    /// Given a list of project ids, this will return a list of all source entities (source_id/source_type/access_level) entries that we need to insert rows for the new entity
    #[tracing::instrument(skip(self, transaction), err)]
    async fn get_all_source_entities_for_projects(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        project_ids: &[uuid::Uuid],
    ) -> Result<Vec<ProjectSourceEntity>, sqlx::Error> {
        // Grab every instance of any project_ids being shared
        // This will allow us to insert records for all these source entities for the new id
        let result = sqlx::query!(
            r#"
            SELECT
            entity_id,
            source_id,
            source_type as "source_type:EntityAccessSourceType",
            access_level as "access_level:AccessLevel"
            FROM entity_access
            WHERE entity_id = ANY($1) AND entity_type = 'project' AND granted_from_project_id IS NULL
            "#,
            project_ids,
        )
        .map(|r| ProjectSourceEntity {
            project_id: r.entity_id,
            source_id: r.source_id,
            source_type: r.source_type,
            access_level: r.access_level,
        })
        .fetch_all(transaction.as_mut())
        .await?;

        Ok(result)
    }
}

impl EntityAccessManagementRepository for PgRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn add_entity_to_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        project_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        let walked_up_project_ids = self
            .walk_up_project_tree(&mut transaction, project_id)
            .await?;

        let source_entities = self
            .get_all_source_entities_for_projects(&mut transaction, &walked_up_project_ids)
            .await?;

        if !source_entities.is_empty() {
            let entity_type_str: &str = entity_type.into();

            let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
            );

            qb.push_values(&source_entities, |mut b, source| {
                b.push_bind(entity_id)
                    .push_bind(entity_type_str)
                    .push_bind(&source.source_id)
                    .push_bind(source.source_type)
                    .push_bind(source.access_level)
                    .push_bind(source.project_id.to_string());
            });

            qb.push(" ON CONFLICT DO NOTHING");
            qb.build().execute(transaction.as_mut()).await?;
        }

        transaction.commit().await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_entity_from_project(
        &self,
        entity_id: &uuid::Uuid,
        entity_type: EntityType,
        old_project_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        let walked_up_project_ids = self
            .walk_up_project_tree(&mut transaction, old_project_id)
            .await?;

        if !walked_up_project_ids.is_empty() {
            let entity_type_str: &str = entity_type.into();
            sqlx::query!(
                r#"
                DELETE FROM entity_access
                WHERE entity_id = $1
                AND entity_type = $2
                AND granted_from_project_id = ANY($3)
                "#,
                entity_id,
                entity_type_str,
                &walked_up_project_ids
                    .into_iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>(),
            )
            .execute(transaction.as_mut())
            .await?;

            transaction.commit().await?;
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn move_project(
        &self,
        project_id: &uuid::Uuid,
        old_project_id: Option<&uuid::Uuid>,
        new_project_id: Option<&uuid::Uuid>,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        // The project entities we will need to update (including the project itself)
        let project_entities = self
            .get_nested_project_entities(&mut transaction, project_id)
            .await?;

        // Get all project items including the project itself
        // If there is an old_project_id we need to remove all project item shares for the old_project_id and above
        if let Some(old_project_id) = old_project_id {
            // Walk project tree
            let old_walked_up_project_ids = self
                .walk_up_project_tree(&mut transaction, old_project_id)
                .await?;

            // Delete all entities in the project for projects shared
            if !old_walked_up_project_ids.is_empty() {
                sqlx::query!(
                    r#"
                DELETE FROM entity_access
                WHERE entity_id = ANY($1)
                AND granted_from_project_id = ANY($2)
                "#,
                    &project_entities
                        .iter()
                        .filter_map(|s| Uuid::parse_str(&s.entity_id).ok())
                        .collect::<Vec<uuid::Uuid>>(),
                    &old_walked_up_project_ids
                        .into_iter()
                        .map(|s| s.to_string())
                        .collect::<Vec<String>>(),
                )
                .execute(transaction.as_mut())
                .await?;
            }
        }

        // If there is a new_project_id we need to add all project item shares for new_project_id and above
        if let Some(new_project_id) = new_project_id {
            let new_walked_up_project_ids = self
                .walk_up_project_tree(&mut transaction, new_project_id)
                .await?;

            // get all source entities for the new walked up projects
            let source_entities = self
                .get_all_source_entities_for_projects(&mut transaction, &new_walked_up_project_ids)
                .await?;

            if !source_entities.is_empty() {
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                    "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) ",
                );

                let rows: Vec<_> = project_entities
                    .iter()
                    .filter_map(|entity| {
                        Uuid::parse_str(&entity.entity_id)
                            .ok()
                            .map(|id| (id, &entity.entity_type))
                    })
                    .flat_map(|(entity_id, entity_type)| {
                        source_entities
                            .iter()
                            .map(move |source| (entity_id, entity_type, source))
                    })
                    .collect();

                qb.push_values(&rows, |mut b, (entity_id, entity_type, source)| {
                    b.push_bind(entity_id)
                        .push_bind(entity_type)
                        .push_bind(&source.source_id)
                        .push_bind(source.source_type)
                        .push_bind(source.access_level)
                        .push_bind(source.project_id.to_string());
                });

                qb.push(" ON CONFLICT DO NOTHING");
                qb.build().execute(transaction.as_mut()).await?;
            }
        }

        transaction.commit().await?;

        Ok(())
    }
}
