//! PostgreSQL implementation of the EntityAccessManagementRepository trait.

#[cfg(test)]
mod test;

use entity_access_db_utils::SimpleEntity;
use entity_kind::EntityType;
use sqlx::{PgPool, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::domain::ports::EntityAccessManagementRepository;

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
        entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;

        entity_access_db_utils::project_grants::inherit_project_grants(
            &mut transaction,
            entity_id,
            entity_type,
            project_id,
        )
        .await?;

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
        entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;

        entity_access_db_utils::project_grants::drop_project_grants(
            &mut transaction,
            entity_id,
            entity_type,
            old_project_id,
        )
        .await?;
        transaction.commit().await?;

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
        entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;

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
            let source_entities = entity_access_db_utils::project_grants::project_grant_sources(
                &mut transaction,
                &new_walked_up_project_ids,
            )
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
