#[derive(Clone, Debug)]
pub struct ProjectModifiedArgs<T>
where
    T: Clone + std::fmt::Debug + ToString + std::marker::Send + Sync,
{
    /// The new project id of the item or the project that was modified
    pub project_id: Option<T>,
    /// The old project id if the item was moved
    pub old_project_id: Option<T>,
    /// The user who performed the action
    pub user_id: String,
}

#[tracing::instrument(skip(db))]
pub async fn update_project_modified<T>(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_modified_args: ProjectModifiedArgs<T>,
) where
    T: Clone + std::fmt::Debug + ToString + std::marker::Send + Sync,
{
    tracing::trace!("updating project modified date");

    let project_id = project_modified_args
        .project_id
        .as_ref()
        .map(|s| s.to_string());
    let old_project_id = project_modified_args
        .old_project_id
        .as_ref()
        .map(|s| s.to_string());

    tokio::spawn({
        let db = db.clone();
        async move {
            if let Some(old_project_id) = old_project_id
                && !old_project_id.is_empty()
            {
                tracing::trace!(project_id=?old_project_id, "updating project modified date");
                let _ = update_project_modified_date(&db, &old_project_id).await.inspect_err(|e| {
                        tracing::error!(error=?e, project_id=?old_project_id, "unable to update project modified date");
                    });
            }

            if let Some(project_id) = project_id
                && !project_id.is_empty()
            {
                tracing::trace!(project_id=?project_id, "updating project modified date");

                let _ = update_project_modified_date(&db, &project_id).await.inspect_err(|e| {
                        tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date");
                    });
            }
        }
    });
}

async fn update_project_modified_date(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE "Project" SET "updatedAt" = NOW() WHERE id = $1"#,
        project_id,
    )
    .execute(db)
    .await?;

    Ok(())
}
