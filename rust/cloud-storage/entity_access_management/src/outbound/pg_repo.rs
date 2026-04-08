//! PostgreSQL implementation of the EntityAccessManagementRepository trait.

#[cfg(test)]
mod test;

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

/// PostgreSQL-backed implementation of [`EntityManagementRepository`]
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
    /// Walks up the project tree and grabs all projects including the project provided id
    #[tracing::instrument(skip(self, transaction), err)]
    async fn walk_up_project_tree(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        project_id: &uuid::Uuid,
    ) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
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
        .map(|p| Uuid::parse_str(&p.id).unwrap()) // SAFETY: the project_id is always a uuid, we just haven't migrated the type to be that in the db schema
        .fetch_all(transaction.as_mut())
        .await?;

        Ok(results)
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
        todo!()
    }
}
