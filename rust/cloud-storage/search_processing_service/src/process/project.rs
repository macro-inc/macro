use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::project::UpsertProjectArgs,
};
use sqs_client::search::project::{BulkRemoveProjectMessage, ProjectMessage};

/// Handles the processing of project messages
#[tracing::instrument(skip(opensearch_client, db))]
pub async fn insert_project(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &ProjectMessage,
) -> anyhow::Result<()> {
    let project =
        macro_db_client::projects::get_project::get_project_by_id(db.clone(), &message.project_id)
            .await;

    let project = match project {
        Ok(project) => project,
        Err(e) => match e {
            sqlx::Error::RowNotFound => {
                return Ok(());
            }
            _ => {
                anyhow::bail!("unable to get project info")
            }
        },
    };

    let upsert_project_args = UpsertProjectArgs {
        project_id: project.id,
        user_id: project.user_id,
        created_at_seconds: EpochSeconds::new(project.created_at.unwrap_or_default().timestamp())?,
        updated_at_seconds: EpochSeconds::new(project.updated_at.unwrap_or_default().timestamp())?,
        project_name: project.name,
    };

    opensearch_client
        .upsert_project(&upsert_project_args)
        .await?;

    Ok(())
}

/// Handles the removeal of projects
#[tracing::instrument(skip(opensearch_client))]
pub async fn remove_project(
    opensearch_client: &OpensearchClient,
    message: &ProjectMessage,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_project(&message.project_id)
        .await?;

    Ok(())
}

/// Bulk remove projects
#[tracing::instrument(skip(opensearch_client))]
pub async fn remove_project_bulk(
    opensearch_client: &OpensearchClient,
    message: &BulkRemoveProjectMessage,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_project_bulk(&message.project_ids)
        .await?;

    Ok(())
}
