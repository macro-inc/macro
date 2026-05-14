use document_sub_type::DocumentSubType;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{FileType, VersionIDWithTimeStamps};
use models_permissions::share_permission::SharePermissionV2;

/// Inserts a record into the document table
/// Returns the document id
#[tracing::instrument(skip(transaction), err)]
pub async fn insert_document_row<'a>(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: Option<&uuid::Uuid>,
    user_id: &MacroUserIdStr<'a>,
    document_name: &str,
    file_type: Option<FileType>,
    project_id: Option<&uuid::Uuid>,
    created_at: &chrono::DateTime<chrono::Utc>,
) -> Result<uuid::Uuid, sqlx::Error> {
    // Generate id if one is not provided
    let id = macro_uuid::generate_uuid_v7();
    let document_id: uuid::Uuid = if let Some(id) = document_id { *id } else { id };

    // Insert document (with or without user-provided ID)
    let result = sqlx::query!(
                r#"
                INSERT INTO "Document" (id, owner, name, "fileType", "projectId", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $6)
                "#,
                &document_id.to_string(),
                user_id.as_ref(),
                document_name,
                file_type.map(|ft| ft.as_str().to_string()),
                project_id.map(|s| s.to_string()),
                created_at.naive_utc()
            )
            .execute(transaction.as_mut())
            .await;

    match result {
        Ok(_) => id.to_string().clone(),
        Err(sqlx::Error::Database(ref db_err)) if db_err.is_unique_violation() => {
            return Err(sqlx::Error::Protocol(format!(
                "document with ID already exists: {id}"
            )));
        }
        Err(e) => return Err(e),
    };

    Ok(document_id)
}

/// sets the document sub type if necessary
#[tracing::instrument(skip(transaction), err)]
pub async fn set_document_sub_type(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &uuid::Uuid,
    is_task: bool,
) -> Result<Option<DocumentSubType>, sqlx::Error> {
    // Insert document sub-type (for tasks)
    if is_task {
        sqlx::query!(
            r#"
                INSERT INTO document_sub_type (document_id, sub_type)
                VALUES ($1, $2)
                "#,
            &document_id.to_string(),
            DocumentSubType::Task as _
        )
        .execute(transaction.as_mut())
        .await?;

        Ok(Some(DocumentSubType::Task))
    } else {
        Ok(None)
    }
}

pub async fn set_document_version(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &uuid::Uuid,
    file_type: Option<FileType>,
    sha: String,
    created_at: &chrono::DateTime<chrono::Utc>,
) -> Result<VersionIDWithTimeStamps, sqlx::Error> {
    match file_type {
            Some(FileType::Docx) => {
                let row = sqlx::query!(
                    r#"
                    INSERT INTO "DocumentBom" ("documentId", "createdAt", "updatedAt")
                    VALUES ($1, $2, $2)
                    RETURNING id, "createdAt"::timestamptz as "created_at", "updatedAt"::timestamptz as "updated_at"
                    "#,
                    &document_id.to_string(),
                    created_at.naive_utc(),
                )
                .fetch_one(transaction.as_mut())
                .await?;

                Ok(VersionIDWithTimeStamps {
                    id: row.id,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    sha: sha.clone(),
                })
            }
            _ => {
                sqlx::query_as!(
                    VersionIDWithTimeStamps,
                    r#"
                    INSERT INTO "DocumentInstance" ("documentId", "sha", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, $3)
                    RETURNING id, sha, "createdAt"::timestamptz as "created_at", "updatedAt"::timestamptz as "updated_at"
                    "#,
                    &document_id.to_string(),
                    sha,
                    created_at.naive_utc()
                )
                .fetch_one(transaction.as_mut())
                .await
            }
        }
}

/// Sets share permission for the document
#[tracing::instrument(skip(transaction), err)]
pub async fn set_share_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &uuid::Uuid,
    file_type: Option<FileType>,
) -> Result<SharePermissionV2, sqlx::Error> {
    // Create share permission
    let share_permission = SharePermissionV2::new_document_share_permission(file_type);
    let share_permission_row = sqlx::query!(
            r#"
            INSERT INTO "SharePermission" ("isPublic", "publicAccessLevel", "createdAt", "updatedAt")
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id
            "#,
            share_permission.is_public,
            share_permission.public_access_level.map(|s| s.to_string()),
        )
        .fetch_one(transaction.as_mut())
        .await?;

    // Link share permission to document
    sqlx::query!(
        r#"
            INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
            VALUES ($1, $2)
            "#,
        &document_id.to_string(),
        share_permission_row.id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(share_permission)
}

/// Set user history
#[tracing::instrument(skip(transaction), err)]
pub async fn insert_history<'a>(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &uuid::Uuid,
    user_id: &MacroUserIdStr<'a>,
    created_at: &chrono::DateTime<chrono::Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
                INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $4)
                ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
                SET "updatedAt" = $4
                "#,
        user_id.as_ref(),
        &document_id.to_string(),
        "document",
        created_at.naive_utc()
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
                INSERT INTO "ItemLastAccessed" ("item_id", "item_type", "last_accessed")
                VALUES ($1, $2, $3)
                ON CONFLICT ("item_id", "item_type") DO UPDATE
                SET "last_accessed" = $3
                "#,
        &document_id.to_string(),
        "document",
        created_at.naive_utc()
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
