use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochSeconds,
    upsert::{project::UpsertProjectArgs, properties::IndexedProperty},
};
use properties::outbound::entity_properties_get_query::get_entity_properties_for_index;
use sqs_client::search::project::{RemoveProject, UpsertProject};

/// Fetch the project's indexed properties, flattened for the search index.
async fn fetch_indexed_properties(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<Vec<IndexedProperty>> {
    let properties = get_entity_properties_for_index(db, project_id, EntityType::Project)
        .await
        .context("failed to fetch project properties for search index")?;
    Ok(properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect())
}

/// Handles upserting a project into the opensearch index. Re-reads the
/// project row so the indexed doc always reflects the current state; a
/// missing or soft-deleted row turns the upsert into a removal.
#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn upsert_project(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &UpsertProject,
) -> anyhow::Result<()> {
    let index_override = message.index_override.as_deref();

    let project = macro_db_client::projects::get_project::get_project_for_search(
        db,
        message.project_id.as_str(),
    )
    .await
    .context("failed to get project for search")?;

    let Some(project) = project else {
        tracing::trace!("project row is gone, removing from search index");
        opensearch_client
            .delete_project(message.project_id.as_str(), index_override)
            .await
            .context("failed to delete missing project from search")?;
        return Ok(());
    };

    if project.deleted_at.is_some() {
        tracing::trace!("project is deleted, removing from search index");
        opensearch_client
            .delete_project(message.project_id.as_str(), index_override)
            .await
            .context("failed to delete project from search")?;
        return Ok(());
    }

    let properties = fetch_indexed_properties(db, &message.project_id).await?;

    let created_at = project.created_at.context("project missing createdAt")?;
    let updated_at = project.updated_at.context("project missing updatedAt")?;

    opensearch_client
        .upsert_project(
            &UpsertProjectArgs {
                project_id: project.id,
                name: project.name,
                owner_id: project.user_id,
                parent_project_id: project.parent_id,
                created_at_seconds: EpochSeconds::new(created_at.timestamp())?,
                updated_at_seconds: EpochSeconds::new(updated_at.timestamp())?,
                properties,
            },
            index_override,
        )
        .await
        .context("failed to upsert project")?;

    Ok(())
}

/// Handles the removal of a project from the opensearch index
#[tracing::instrument(skip(opensearch_client), err)]
pub async fn remove_project(
    opensearch_client: &OpensearchClient,
    message: &RemoveProject,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_project(
            message.project_id.as_str(),
            message.index_override.as_deref(),
        )
        .await?;

    Ok(())
}
