use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use crate::share_permission;

#[tracing::instrument(skip(transaction))]
pub async fn edit_document(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &str,
    document_name: Option<&str>,
    project_id: Option<&str>,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
) -> anyhow::Result<()> {
    let mut query = "UPDATE \"Document\" SET ".to_string();
    let mut parameters: Vec<Option<&str>> = Vec::new();
    let mut set_parts = Vec::new();

    if let Some(name) = document_name {
        set_parts.push("\"name\" = $".to_string() + &(parameters.len() + 2).to_string());
        parameters.push(Some(name));
    }

    if let Some(project_id) = project_id {
        set_parts.push("\"projectId\" = $".to_string() + &(parameters.len() + 2).to_string());
        if project_id.is_empty() {
            parameters.push(None);
        } else {
            parameters.push(Some(project_id));
        }
    }

    query += &set_parts.join(", ");

    if !set_parts.is_empty() {
        query += ", ";
    }

    query += "\"updatedAt\" = NOW() WHERE id = $1";

    let mut query = sqlx::query(&query);
    query = query.bind(document_id);

    for param in parameters {
        query = query.bind(param);
    }

    query.execute(transaction.as_mut()).await?;

    if let Some(share_permission) = share_permission {
        tracing::trace!("editing share permissions for document");

        share_permission::edit::edit_document_permission(
            transaction,
            document_id,
            share_permission,
        )
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use models_permissions::share_permission::UpdateSharePermissionRequestV2;

    use crate::document::get_document;

    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_edit_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        edit_document(
            &mut transaction,
            "document-one",
            Some("new-name"),
            Some("new-project"),
            Some(&UpdateSharePermissionRequestV2 {
                is_public: Some(true),
                public_access_level: Some(AccessLevel::Edit),
                channel_share_permissions: None,
            }),
        )
        .await?;

        transaction.commit().await?;

        let mut transaction = pool.begin().await?;
        let document_metadata = get_document(&pool, "document-one").await?;

        assert!(!document_metadata.document_id.is_empty());
        assert!(document_metadata.document_version_id > 0);
        assert_eq!(document_metadata.document_name, "new-name".to_string());
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        assert_eq!(
            document_metadata.project_id,
            Some("new-project".to_string())
        );
        edit_document(&mut transaction, "document-one", None, None, None).await?;
        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("basic_user_with_lots_of_documents")
    ))]
    async fn test_remove_document_from_project(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_metadata = get_document(&pool, "document-one").await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(
            document_metadata.project_id,
            Some("project-one".to_string())
        );

        let mut transaction = pool.begin().await?;
        edit_document(&mut transaction, "document-one", None, Some(""), None).await?;
        transaction.commit().await?;

        let document_metadata = get_document(&pool, "document-one").await?;

        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.project_id, None);

        Ok(())
    }
}
