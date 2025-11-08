use super::insert_bom_parts;
use crate::history::upsert_user_history;
use crate::share_permission::create::{create_document_permission, create_project_permission};
use model::document::{BasicDocument, FileType};
use model::document::{ID, SaveBomPart, VersionID};
use model::project::Project;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Postgres, Transaction};

/// Creates a project under a transaction and does not commit the transaction
#[tracing::instrument(skip(transaction))]
pub async fn create_project_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    project_name: &str,
    parent_id: Option<String>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<Project> {
    let project = sqlx::query_as!(
        Project,
        r#"
        INSERT INTO "Project" ("name", "userId", "parentId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, name, "userId"::text as user_id, "createdAt"::timestamptz as created_at, "deletedAt"::timestamptz as deleted_at,
        "updatedAt"::timestamptz as updated_at, "parentId" as parent_id
        "#,
        project_name,
        user_id,
        parent_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Create share permission
    create_project_permission(transaction, &project.id, share_permission).await?;
    upsert_user_history(transaction, user_id, &project.id, "project").await?;

    crate::item_access::insert::insert_user_item_access(
        transaction,
        user_id,
        &project.id,
        "project",
        AccessLevel::Owner,
        None,
    )
    .await?;

    Ok(project)
}

/// Creates documents under a project
/// This does not include creating the docx file as that requires special handling
#[tracing::instrument(skip(transaction, document_names))]
pub async fn create_onboarding_documents(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    project_id: &str,
    share_permission: &SharePermissionV2,
    document_names: Vec<(String, String)>,
) -> anyhow::Result<Vec<BasicDocument>> {
    if document_names
        .iter()
        .any(|(_, file_type)| file_type == FileType::Docx.as_str())
    {
        return Err(anyhow::Error::msg(
            "docx is not supported for onboarding documents",
        ));
    }

    let document_values = document_names
        .iter()
        .map(|(name, file_type)| {
            format!(
                "('{}', '{}', '{}', '{}')",
                user_id, name, file_type, project_id
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    let documents_query = format!(
        r#"
        INSERT INTO "Document" (owner, name, "fileType", "projectId")
        VALUES {}
        RETURNING id;
        "#,
        document_values
    );

    let query = sqlx::query_as::<_, ID>(&documents_query);
    let document_records = query.fetch_all(transaction.as_mut()).await?;
    let document_ids: Vec<String> = document_records.into_iter().map(|row| row.id).collect();
    tracing::trace!(document_ids=?document_ids, "got document ids");

    let document_values = document_ids
        .iter()
        .map(|id| format!("('{}', '{}')", id, "sha"))
        .collect::<Vec<_>>()
        .join(",");

    let document_versions_query = format!(
        r#"
        INSERT INTO "DocumentInstance" ("documentId", "sha")
        VALUES {}
        RETURNING id;
        "#,
        document_values
    );

    let query = sqlx::query_as::<_, VersionID>(&document_versions_query);
    let document_versions = query.fetch_all(transaction.as_mut()).await?;

    let document_versions: Vec<i64> = document_versions.into_iter().map(|row| row.id).collect();
    tracing::trace!(document_versions=?document_versions, "got document versions");

    let history_values = document_ids
        .iter()
        .map(|id| format!("('{}', '{}', '{}')", user_id, id, "document"))
        .collect::<Vec<_>>()
        .join(",");
    let user_history = format!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType")
        VALUES {}
        RETURNING "itemId" as id;
        "#,
        history_values
    );
    let query = sqlx::query(&user_history);
    query.execute(transaction.as_mut()).await?;

    for document_id in &document_ids {
        create_document_permission(transaction, document_id, share_permission).await?;
    }

    let mut documents = Vec::new();

    document_ids
        .iter()
        .zip(document_versions.iter())
        .zip(document_names.iter())
        .for_each(|((document_id, document_version_id), document_names)| {
            documents.push(BasicDocument {
                document_id: document_id.to_string(),
                document_version_id: *document_version_id,
                owner: user_id.to_string(),
                document_name: document_names.0.to_string(),
                file_type: Some(document_names.1.to_string()),
                sha: None,
                project_id: Some(project_id.to_string()),
                document_family_id: None,
                branched_from_id: None,
                branched_from_version_id: None,
                created_at: None,
                updated_at: None,
                deleted_at: None,
            });
        });

    Ok(documents)
}

/// Creates onboarding docx under a project
#[tracing::instrument(skip(transaction))]
pub async fn create_onboarding_docx(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    project_id: &str,
    share_permission: &SharePermissionV2,
    document_name: &str,
    bom_parts: Vec<SaveBomPart>,
) -> anyhow::Result<BasicDocument> {
    let document = sqlx::query_as!(
        ID,
        r#"
            INSERT INTO "Document" (owner, name, "fileType", "projectId")
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        "#,
        user_id,
        document_name,
        "docx", // hard coded file type as it's create blank docx
        project_id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let document_bom = sqlx::query!(
        r#"
            INSERT INTO "DocumentBom" ("documentId")
            VALUES ($1)
            RETURNING id;
            "#,
        &document.id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    create_document_permission(transaction, &document.id, share_permission).await?;

    insert_bom_parts(transaction, &document.id, document_bom.id, bom_parts).await?;

    // Add item to user history for creator
    upsert_user_history(transaction, user_id, &document.id, "document").await?;

    Ok(BasicDocument {
        document_id: document.id,
        document_version_id: document_bom.id,
        owner: user_id.to_string(),
        document_name: document_name.to_string(),
        file_type: Some(FileType::Docx.as_str().to_string()),
        sha: None,
        project_id: Some(project_id.to_string()),
        document_family_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
    })
}
