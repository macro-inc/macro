use document_sub_type::DocumentSubType;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::{
    BomPart, DocumentBasic, DocumentMetadata, FileType, SaveBomPart, VersionIDWithTimeStamps,
    VersionIDWithTimeStampsNoSha, VersionIDWithTimeStampsOptionalSha,
};
use sqlx::{PgPool, Postgres, Transaction};

/// Inserts the bom parts into the database for a docx document
#[tracing::instrument(skip(transaction, document_bom_parts))]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn insert_bom_parts(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    document_version_id: i64,
    document_bom_parts: Vec<SaveBomPart>,
) -> anyhow::Result<Vec<BomPart>> {
    let mut query =
        "INSERT INTO \"BomPart\" (\"documentBomId\", \"sha\", \"path\") VALUES".to_string();
    let mut set_parts = Vec::new();
    let mut parameters: Vec<String> = Vec::new();
    for bom_part in document_bom_parts {
        let param_number = parameters.len() + 2;
        set_parts.push(format!("($1, ${}, ${})", param_number, param_number + 1));

        parameters.push(bom_part.sha.clone());
        parameters.push(bom_part.path.clone());
    }

    query += &set_parts.join(", ");
    query += " RETURNING id, sha, path;";

    let mut query = sqlx::query_as::<_, BomPart>(&query);
    query = query.bind(document_version_id);
    for param in parameters {
        query = query.bind(param);
    }

    let parts: Vec<BomPart> = query.fetch_all(transaction.as_mut()).await?;

    Ok(parts)
}

/// Updates a document in the database
/// Also creates a new document instance/document bom for the updated document
#[tracing::instrument(skip(db))]
pub async fn save_document(
    db: &PgPool,
    document_id: &str,
    file_type: FileType,
    sha: Option<&str>,
    modification_data: Option<serde_json::Value>,
    document_bom_parts: Option<Vec<SaveBomPart>>,
) -> anyhow::Result<DocumentMetadata> {
    let mut transaction = db.begin().await?;

    let document = sqlx::query!(
        r#"
        UPDATE "Document" SET "updatedAt" = NOW()
        WHERE id = $1
        RETURNING id as "document_id", owner, "fileType" as file_type, name as document_name,
        "branchedFromId" as branched_from_id, "branchedFromVersionId" as branched_from_version_id,
        "documentFamilyId" as document_family_id,
        "projectId" as project_id,
        "deletedAt"::timestamptz as "deleted_at"
        "#,
        document_id
    )
    .try_map(|row| {
        Ok(DocumentBasic {
            document_id: row.document_id,
            document_name: row.document_name,
            owner: MacroUserIdStr::parse_from_str(&row.owner)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
            file_type: row.file_type,
            sub_type: None,
            branched_from_id: row.branched_from_id,
            branched_from_version_id: row.branched_from_version_id,
            document_family_id: row.document_family_id,
            project_id: row.project_id,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_one(&mut *transaction)
    .await?;

    let project_name = match document.project_id.as_ref() {
        Some(project_id) => {
            let project = sqlx::query!(
                r#"
                select name from "Project" where id = $1
                "#,
                &project_id,
            )
            .fetch_one(&mut *transaction)
            .await?;
            Some(project.name)
        }
        None => None,
    };

    let mut document_bom = None;

    let document_version: VersionIDWithTimeStampsOptionalSha = match file_type {
        FileType::Docx => {
            // Create new document bom
            let document_version = sqlx::query_as!(
                VersionIDWithTimeStampsNoSha,
            r#"
                INSERT INTO "DocumentBom" ("documentId")
                VALUES ($1)
                RETURNING id, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
            document_id,
            )
            .fetch_one(transaction.as_mut())
            .await?;

            // Create new document bom parts
            let document_bom_parts = insert_bom_parts(
                &mut transaction,
                document_id,
                document_version.id,
                document_bom_parts.expect("bom parts should be present for docx documents"),
            )
            .await?;
            let parts_json: serde_json::Value = serde_json::to_value(document_bom_parts)?;

            document_bom = Some(parts_json);

            VersionIDWithTimeStampsOptionalSha {
                id: document_version.id,
                sha: None,
                created_at: document_version.created_at,
                updated_at: document_version.updated_at,
            }
        }
        _ => {
            // For non-docx documents, we create a new document instance and
            // insert any modification data if it is provided.
            let document_instance: VersionIDWithTimeStamps = sqlx::query_as!(
                VersionIDWithTimeStamps,
            r#"
                INSERT INTO "DocumentInstance" ("documentId", "sha")
                VALUES ($1, $2)
                RETURNING id, sha, "createdAt"::timestamptz as created_at, "updatedAt"::timestamptz as updated_at;
            "#,
            document_id,
            sha.unwrap_or(""),
            )
            .fetch_one(&mut *transaction)
            .await?;

            if let Some(modification_data) = modification_data.as_ref() {
                // Insert modification data
                sqlx::query!(
                    r#"
                        INSERT INTO "DocumentInstanceModificationData" ("documentInstanceId", "modificationData")
                        VALUES ($1, $2);
                    "#,
                    document_instance.id,
                    modification_data,
                )
                .execute(&mut *transaction)
                .await?;
            }

            VersionIDWithTimeStampsOptionalSha {
                id: document_instance.id,
                sha: Some(document_instance.sha),
                created_at: document_instance.created_at,
                updated_at: document_instance.updated_at,
            }
        }
    };

    let sub_type: Option<DocumentSubType> = sqlx::query!(
        r#"
            SELECT sub_type as "sub_type: DocumentSubType" FROM document_sub_type WHERE document_id = $1
        "#,
        document_id
    )
    .map(|row| row.sub_type)
    .fetch_optional(&mut *transaction)
    .await?;

    if let Err(err) = transaction.commit().await {
        tracing::error!(error=?err, "unable to commit transaction");
        return Err(err.into());
    }

    Ok(DocumentMetadata {
        document_name: document.document_name,
        document_id: document_id.to_string(),
        document_version_id: document_version.id,
        owner: document.owner,
        file_type: document.file_type,
        sha: document_version.sha,
        modification_data,
        document_family_id: document.document_family_id,
        branched_from_id: document.branched_from_id,
        branched_from_version_id: document.branched_from_version_id,
        document_bom,
        project_id: document.project_id,
        project_name,
        created_at: document_version.created_at,
        updated_at: document_version.updated_at,
        sub_type,
        deleted_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_save_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_metadata = save_document(
            &pool,
            "document-one",
            FileType::Txt,
            Some("sha"),
            Some(serde_json::json!({})),
            None,
        )
        .await?;
        assert!(!document_metadata.document_id.is_empty());
        assert_eq!(document_metadata.document_version_id, 3);
        assert_eq!(document_metadata.file_type, Some("txt".to_string()));
        assert_eq!(document_metadata.owner.as_ref(), "macro|user@user.com");

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("docx_example")))]
    async fn test_save_docx_document(pool: Pool<Postgres>) {
        // document exists
        let document_metadata = save_document(
            &pool,
            "document-one",
            FileType::Docx,
            None,
            None,
            Some(vec![SaveBomPart {
                sha: "sha-1".to_string(),
                path: "path-1".to_string(),
            }]),
        )
        .await
        .unwrap();

        assert_eq!(document_metadata.document_id.is_empty(), false);
        assert_eq!(
            document_metadata.document_name,
            "test_document_name".to_string()
        );
        assert_eq!(document_metadata.document_version_id, 3);
        assert_eq!(document_metadata.owner.as_ref(), "macro|user@user.com");
        let bom_parts: Vec<BomPart> =
            serde_json::from_value(document_metadata.document_bom.unwrap()).unwrap();
        assert_eq!(bom_parts[0].sha, "sha-1");
        assert_eq!(bom_parts[0].path, "path-1");
    }
}
