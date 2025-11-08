use sqlx::{Pool, Postgres};

use crate::share_permission;
use model::project::Project;

pub async fn update_project_modified_date(
    db: &Pool<Postgres>,
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

#[tracing::instrument(skip(transaction))]
pub async fn edit_project_v2(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    user_id: &str,
    project_id: &str,
    project_name: Option<&str>,
    parent_id: Option<&str>,
    share_permission: Option<&models_permissions::share_permission::UpdateSharePermissionRequestV2>,
) -> anyhow::Result<Project> {
    let mut query = "UPDATE \"Project\" SET ".to_string();
    let mut parameters: Vec<Option<&str>> = Vec::new();
    let mut set_parts = Vec::new();

    if let Some(name) = project_name {
        set_parts.push("\"name\" = $".to_string() + &(set_parts.len() + 2).to_string());
        parameters.push(Some(name));
    }

    if let Some(parent_id) = parent_id {
        set_parts.push("\"parentId\" = $".to_string() + &(set_parts.len() + 2).to_string());
        if parent_id.is_empty() {
            parameters.push(None);
        } else {
            parameters.push(Some(parent_id));
        }
    }

    query += &set_parts.join(", ");
    if !set_parts.is_empty() {
        query += ", ";
    }
    query += "\"updatedAt\" = NOW() WHERE id = $1 RETURNING id, name, \"userId\"::text as user_id, \"parentId\" as parent_id, \"createdAt\"::timestamptz as created_at, \"updatedAt\"::timestamptz as updated_at, \"deletedAt\"::timestamptz as deleted_at";

    let mut query = sqlx::query_as::<_, Project>(&query);
    query = query.bind(project_id);
    for param in parameters {
        query = query.bind(param);
    }

    let updated_project = query.fetch_one(transaction.as_mut()).await?;

    if let Some(share_permission) = share_permission {
        share_permission::edit::edit_project_permission(transaction, project_id, share_permission)
            .await?;
    }

    Ok(updated_project)
}
