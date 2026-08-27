use document_sub_type::DocumentSubType;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentMetadata, FileType, VersionIDWithTimeStamps};
use models_permissions::share_permission::SharePermissionV2;

use crate::domain::models::CreateDocumentRepoArgs;

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
    sub_type: Option<DocumentSubType>,
) -> Result<Option<DocumentSubType>, sqlx::Error> {
    // Insert document sub-type (for tasks and snippets)
    if let Some(sub_type) = sub_type {
        sqlx::query!(
            r#"
                INSERT INTO document_sub_type (document_id, sub_type)
                VALUES ($1, $2)
                "#,
            &document_id.to_string(),
            sub_type as _
        )
        .execute(transaction.as_mut())
        .await?;

        Ok(Some(sub_type))
    } else {
        Ok(None)
    }
}

/// Allocates the next per-team task number and records the document association.
#[tracing::instrument(skip(transaction), err)]
pub async fn allocate_team_task_number(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    team_id: &uuid::Uuid,
    document_id: &uuid::Uuid,
) -> Result<i32, sqlx::Error> {
    let document_id = document_id.to_string();

    sqlx::query_scalar!(
        r#"
        WITH allocated AS (
            INSERT INTO team_task_counter (team_id, last_task_num)
            VALUES ($1, 1)
            ON CONFLICT (team_id) DO UPDATE
            SET last_task_num = team_task_counter.last_task_num + 1,
                updated_at = NOW()
            RETURNING last_task_num AS task_num
        )
        INSERT INTO team_task (team_id, document_id, task_num)
        SELECT $1, $2, task_num
        FROM allocated
        RETURNING task_num AS "task_num!"
        "#,
        team_id,
        document_id,
    )
    .fetch_one(transaction.as_mut())
    .await
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
///
/// The permission is resolved by the domain layer; this function persists it verbatim.
#[tracing::instrument(skip(transaction, share_permission), err)]
pub async fn set_share_permission(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &uuid::Uuid,
    share_permission: &SharePermissionV2,
) -> Result<(), sqlx::Error> {
    let link_share = share_permission.link_share.map(|value| value.to_string());
    let link_share_access_level = share_permission.link_share_access_level;

    let share_permission_row = sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            "linkShare",
            "linkShareAccessLevel",
            "createdAt",
            "updatedAt"
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id
        "#,
        link_share,
        link_share_access_level as _,
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

    Ok(())
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

pub async fn find_document_id_for_email_attachment<'e, E>(
    executor: E,
    email_attachment_id: uuid::Uuid,
) -> Result<Option<String>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar!(
        r#"
        SELECT de.document_id
        FROM document_email de
        JOIN "Document" d ON d.id = de.document_id
        WHERE de.email_attachment_id = $1
        ORDER BY (d."deletedAt" IS NULL) DESC, de.document_id
        LIMIT 1
        "#,
        email_attachment_id,
    )
    .fetch_optional(executor)
    .await
}

pub async fn find_live_email_document_id_by_sha<'e, E>(
    executor: E,
    owner: &str,
    sha: &str,
) -> Result<Option<String>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar!(
        r#"
        SELECT d.id
        FROM "Document" d
        INNER JOIN LATERAL (
            SELECT i.sha
            FROM "DocumentInstance" i
            WHERE i."documentId" = d.id
            ORDER BY i."createdAt" DESC
            LIMIT 1
        ) latest ON latest.sha = $2
        WHERE d.owner = $1
          AND d."deletedAt" IS NULL
          AND EXISTS (
              SELECT 1
              FROM document_email de
              WHERE de.document_id = d.id
          )
        ORDER BY d."createdAt" ASC, d.id ASC
        LIMIT 1
        "#,
        owner,
        sha,
    )
    .fetch_optional(executor)
    .await
}

pub async fn link_document_email(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &str,
    email_attachment_id: uuid::Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO "document_email" (document_id, email_attachment_id)
        VALUES ($1, $2)
        "#,
        document_id,
        email_attachment_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

pub async fn reuse_email_document(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner: &str,
    sha: &str,
    email_attachment_id: uuid::Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query!(
        r#"SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))"#,
        owner,
        sha,
    )
    .execute(transaction.as_mut())
    .await?;

    if let Some(document_id) =
        find_document_id_for_email_attachment(&mut **transaction, email_attachment_id).await?
    {
        return Ok(Some(document_id));
    }

    if let Some(document_id) =
        find_live_email_document_id_by_sha(&mut **transaction, owner, sha).await?
    {
        link_document_email(transaction, &document_id, email_attachment_id).await?;
        return Ok(Some(document_id));
    }

    Ok(None)
}

/// Inserts a new `Document` row and its associated create records.
///
/// Does not link email attachments. Callers that need that belong on
/// [`crate::domain::ports::DocumentRepo::import_email_attachment_document`].
#[tracing::instrument(skip(transaction, args, share_permission), err)]
pub async fn insert_new_document(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    args: CreateDocumentRepoArgs,
    share_permission: &SharePermissionV2,
) -> Result<DocumentMetadata, sqlx::Error> {
    let CreateDocumentRepoArgs {
        id,
        sha,
        document_name,
        user_id,
        file_type,
        project_id,
        team_id,
        created_at: provided_created_at,
        sub_type: requested_sub_type,
        skip_history,
        attribution: _,
    } = args;

    let now = chrono::Utc::now();
    let created_at = provided_created_at.as_ref().unwrap_or(&now);

    let project_name: Option<String> = if let Some(ref proj_id) = project_id {
        sqlx::query_scalar!(
            r#"SELECT name FROM "Project" WHERE id = $1"#,
            &proj_id.to_string(),
        )
        .fetch_optional(&mut **transaction)
        .await?
    } else {
        None
    };

    let document_id = insert_document_row(
        transaction,
        id.as_ref(),
        &user_id,
        &document_name,
        file_type,
        project_id.as_ref(),
        created_at,
    )
    .await?;

    let sub_type: Option<DocumentSubType> =
        set_document_sub_type(transaction, &document_id, requested_sub_type).await?;

    if sub_type == Some(DocumentSubType::Task)
        && let Some(team_id) = team_id.as_ref()
    {
        allocate_team_task_number(transaction, team_id, &document_id).await?;
    }

    let document_version =
        set_document_version(transaction, &document_id, file_type, sha, created_at).await?;

    set_share_permission(transaction, &document_id, share_permission).await?;

    if !skip_history {
        insert_history(transaction, &document_id, &user_id, created_at).await?;
    }

    entity_access_db_utils::insert_entity_access_row(
        transaction,
        &document_id,
        entity_access_db_utils::EntityType::Document,
        user_id.as_ref(),
        entity_access_db_utils::EntityAccessSourceType::User,
        entity_access_db_utils::AccessLevel::Owner,
    )
    .await?;

    Ok(DocumentMetadata::new_document(
        &document_id.to_string(),
        document_version.id,
        user_id,
        &document_name,
        file_type,
        &document_version.sha,
        None,
        None,
        None,
        project_id.map(|s| s.to_string()).as_deref(),
        project_name.as_deref(),
        document_version.created_at,
        document_version.updated_at,
        sub_type,
    ))
}
