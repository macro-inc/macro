use macro_user_id::user_id::MacroUserIdStr;
use model::document::{
    BomPart, DocumentMetadata, IDWithTimeStamps, SaveBomPart, VersionIDWithTimeStamps,
    VersionIDWithTimeStampsNoSha,
};
use sqlx::{Postgres, Transaction};

/// Copies a given docx document (Document + DocumentBom + BomParts).
#[tracing::instrument(skip(transaction))]
pub async fn copy_docx_document(
    transaction: &mut Transaction<'_, Postgres>,
    original_document: &DocumentMetadata,
    user_id: MacroUserIdStr<'static>,
    new_document_name: &str,
) -> Result<DocumentMetadata, sqlx::Error> {
    let original_document_id = &original_document.document_id;
    let original_document_version_id = original_document.document_version_id;

    let document = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
        INSERT INTO "Document" (owner, name, "fileType", "documentFamilyId", "branchedFromId", "branchedFromVersionId", "projectId")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
        "#,
        user_id.as_ref(),
        new_document_name,
        original_document.file_type,
        original_document.document_family_id,
        original_document_id,
        original_document_version_id,
        original_document.project_id,
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to copy document");
        map_insert_document_error(err)
    })?;

    let document_bom = sqlx::query_as!(
        VersionIDWithTimeStampsNoSha,
        r#"
        INSERT INTO "DocumentBom" ("documentId")
        VALUES ($1)
        RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
        "#,
        &document.id,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Copy bom parts from the original document
    let document_bom_parts: Vec<BomPart> =
        serde_json::from_value(original_document.document_bom.as_ref().unwrap().clone())
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    let saved_bom_parts = create_bom_parts(
        transaction,
        document_bom.id,
        document_bom_parts
            .into_iter()
            .map(|b| SaveBomPart {
                sha: b.sha,
                path: b.path,
            })
            .collect(),
    )
    .await?;

    let saved_bom_parts =
        serde_json::to_value(saved_bom_parts).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    Ok(DocumentMetadata {
        document_id: document.id.clone(),
        owner: user_id,
        document_name: new_document_name.to_string(),
        file_type: original_document.file_type.clone(),
        sha: None,
        modification_data: None,
        branched_from_id: Some(original_document_id.to_string()),
        branched_from_version_id: Some(original_document_version_id),
        document_family_id: original_document.document_family_id,
        project_id: original_document.project_id.clone(),
        project_name: original_document.project_name.clone(),
        document_version_id: document_bom.id,
        document_bom: Some(saved_bom_parts),
        created_at: document.created_at,
        updated_at: document.updated_at,
        sub_type: None,
        deleted_at: None,
    })
}

/// Copies a given non-docx document (Document + DocumentInstance + modification data + sub_type).
#[tracing::instrument(skip(transaction))]
pub async fn copy_non_docx_document(
    transaction: &mut Transaction<'_, Postgres>,
    original_document: &DocumentMetadata,
    user_id: MacroUserIdStr<'static>,
    new_document_name: &str,
) -> Result<DocumentMetadata, sqlx::Error> {
    let original_document_id = &original_document.document_id;
    let original_document_version_id = original_document.document_version_id;

    let sha = original_document.sha.as_deref().ok_or_else(|| {
        tracing::error!("unable to copy document, sha is missing");
        sqlx::Error::Protocol("unable to copy document, sha is missing".to_string())
    })?;

    let document = sqlx::query_as!(
        IDWithTimeStamps,
        r#"
        INSERT INTO "Document" (owner, name, "fileType", "documentFamilyId", "branchedFromId", "branchedFromVersionId", "projectId")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
        "#,
        user_id.as_ref(),
        new_document_name,
        original_document.file_type,
        original_document.document_family_id,
        original_document_id,
        original_document_version_id,
        original_document.project_id,
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to copy document");
        map_insert_document_error(err)
    })?;

    let document_instance = sqlx::query_as!(
        VersionIDWithTimeStamps,
        r#"
        INSERT INTO "DocumentInstance" ("documentId", "sha")
        VALUES ($1, $2)
        RETURNING id, sha, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
        "#,
        &document.id,
        sha,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Copy modification data if present
    let original_document_modification = sqlx::query!(
        r#"
        SELECT "modificationData" as modification_data
        FROM "DocumentInstanceModificationData"
        WHERE "documentInstanceId" = $1
        "#,
        original_document_version_id
    )
    .fetch_optional(transaction.as_mut())
    .await?;

    let original_modification_data = if let Some(modification) = original_document_modification {
        sqlx::query!(
                r#"
            INSERT INTO "DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
            VALUES ($1, $2);
            "#,
                document_instance.id,
                modification.modification_data
            )
            .execute(transaction.as_mut())
            .await?;

        Some(modification.modification_data)
    } else {
        None
    };

    // Copy sub_type if the original has one (task, snippet, ...)
    if let Some(sub_type) = original_document.sub_type {
        sqlx::query!(
            r#"
            INSERT INTO document_sub_type (document_id, sub_type)
            VALUES ($1, $2)
            "#,
            document.id,
            sub_type as _,
        )
        .execute(transaction.as_mut())
        .await?;
    }

    Ok(DocumentMetadata {
        document_id: document.id.clone(),
        owner: user_id,
        document_name: new_document_name.to_string(),
        file_type: original_document.file_type.clone(),
        sha: Some(document_instance.sha),
        branched_from_id: Some(original_document_id.to_string()),
        branched_from_version_id: Some(original_document_version_id),
        document_family_id: original_document.document_family_id,
        document_version_id: document_instance.id,
        document_bom: None,
        project_id: original_document.project_id.clone(),
        project_name: original_document.project_name.clone(),
        modification_data: original_modification_data,
        created_at: document.created_at,
        updated_at: document.updated_at,
        sub_type: original_document.sub_type,
        deleted_at: None,
    })
}

/// Copies PDF-specific parts (DocumentText and DocumentProcessResult).
#[tracing::instrument(skip(transaction))]
pub async fn copy_pdf_parts(
    transaction: &mut Transaction<'_, Postgres>,
    new_document_id: &str,
    original_document_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO "DocumentText" ("documentId", "content", "tokenCount")
        SELECT $1, content, "tokenCount" FROM "DocumentText"
        WHERE "documentId" = $2
        "#,
        new_document_id,
        original_document_id
    )
    .execute(transaction.as_mut())
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "DocumentProcessResult" ("documentId", "content", "jobType")
        SELECT $1, content, 'pdf_preprocess' FROM "DocumentProcessResult"
        WHERE "documentId" = $2 and "jobType" = 'pdf_preprocess'
        "#,
        new_document_id,
        original_document_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Creates bom parts for a document bom.
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn create_bom_parts(
    transaction: &mut Transaction<'_, Postgres>,
    document_bom_id: i64,
    bom_parts: Vec<SaveBomPart>,
) -> Result<Vec<BomPart>, sqlx::Error> {
    if bom_parts.is_empty() {
        return Ok(Vec::new());
    }

    let mut query =
        "INSERT INTO \"BomPart\" (\"documentBomId\", \"sha\", \"path\") VALUES ".to_string();
    let mut set_parts: Vec<String> = Vec::new();
    let mut parameters: Vec<String> = Vec::new();

    for bom_part in &bom_parts {
        let param_number = parameters.len() + 2;
        set_parts.push(format!("($1, ${}, ${})", param_number, param_number + 1));
        parameters.push(bom_part.sha.clone());
        parameters.push(bom_part.path.clone());
    }

    query += &set_parts.join(", ");
    query += ";";

    let mut query = sqlx::query_as::<_, BomPart>(&query);
    query = query.bind(document_bom_id);

    for param in parameters {
        query = query.bind(param);
    }

    let saved_bom_parts: Vec<BomPart> = query
        .fetch_all(transaction.as_mut())
        .await
        .map_err(|e| sqlx::Error::Protocol(format!("failed to create bom parts: {e}")))?;

    Ok(saved_bom_parts)
}

fn map_insert_document_error(err: sqlx::Error) -> sqlx::Error {
    let no_user_found = "error returned from database: insert or update on table \"Document\" violates foreign key constraint \"Document_owner_fkey\"";
    let err_string = err.to_string();
    if err_string.contains(no_user_found) {
        return sqlx::Error::Protocol("no user found".to_string());
    }
    sqlx::Error::Protocol("unable to copy document".to_string())
}
