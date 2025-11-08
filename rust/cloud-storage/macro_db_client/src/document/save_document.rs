use sqlx::{PgPool, Postgres, Transaction, types::Uuid};

use model::document::{
    BomPart, DocumentBasic, DocumentMetadata, FileType, SaveBomPart, VersionIDWithTimeStamps,
    VersionIDWithTimeStampsNoSha, VersionIDWithTimeStampsOptionalSha,
    modification_data::{PdfModificationData, ThreadPlaceable},
};

// A comprehensive function that inserts both comment and highlight data
async fn insert_all_comment_data(
    transaction: &mut Transaction<'_, Postgres>,
    document: &DocumentBasic,
    modification_data: serde_json::Value,
) -> anyhow::Result<()> {
    // Deserialize the modification data only once
    let pdf_modification_data: PdfModificationData = serde_json::from_value(modification_data)?;

    // Cache existing comment timestamps
    let existing_comments = sqlx::query!(
        r#"
        SELECT c.id, c."createdAt" as created_at, c."updatedAt" as updated_at
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        WHERE t."documentId" = $1
        "#,
        document.document_id
    )
    .fetch_all(transaction.as_mut())
    .await?;

    // Cache existing highlight timestamps
    let existing_highlights = sqlx::query!(
        r#"
        SELECT a.uuid, a."createdAt" as created_at, a."updatedAt" as updated_at
        FROM "PdfHighlightAnchor" a
        WHERE a."documentId" = $1
        "#,
        document.document_id
    )
    .fetch_all(transaction.as_mut())
    .await?;

    // Create a map of comment IDs to their timestamps
    let mut comment_timestamps = std::collections::HashMap::new();
    for comment in existing_comments {
        comment_timestamps.insert(comment.id, (comment.created_at, comment.updated_at));
    }

    // Create a map of highlight IDs to their timestamps
    let mut highlight_timestamps = std::collections::HashMap::new();
    for highlight in existing_highlights {
        highlight_timestamps.insert(highlight.uuid, (highlight.created_at, highlight.updated_at));
    }

    // Delete existing threads on document (comment and pdf anchors will cascade delete)
    let deleted_threads = sqlx::query!(
        r#"
        DELETE FROM "Thread" WHERE "documentId" = $1;
        "#,
        document.document_id,
    )
    .execute(transaction.as_mut())
    .await?;

    tracing::info!(
        "deleted {} existing threads on document {}",
        deleted_threads.rows_affected(),
        document.document_id
    );

    // delete existing highlights will cascade delete the rects
    let deleted_highlights = sqlx::query!(
        r#"
DELETE FROM "PdfHighlightAnchor" WHERE "documentId" = $1;
"#,
        document.document_id,
    )
    .execute(transaction.as_mut())
    .await?;

    tracing::info!(
        "deleted {} existing highlights on document {}",
        deleted_highlights.rows_affected(),
        document.document_id
    );

    // Process placeable threads
    let thread_placeables = pdf_modification_data
        .placeables
        .iter()
        .filter_map(|placeable| {
            if let model::document::modification_data::Payload::Thread(thread) = &placeable.payload
            {
                return Some(ThreadPlaceable {
                    allowable_edits: placeable.allowable_edits.clone(),
                    was_edited: placeable.was_edited,
                    was_deleted: placeable.was_deleted,
                    position: placeable.position.clone(),
                    should_lock_on_save: placeable.should_lock_on_save,
                    original_page: placeable.original_page,
                    original_index: placeable.original_index,
                    head_id: thread.head_id.clone(),
                    page: thread.page,
                    comments: thread.comments.clone(),
                    is_resolved: thread.is_resolved,
                });
            }
            None
        })
        .collect::<Vec<ThreadPlaceable>>();

    let now = chrono::Utc::now().naive_utc();

    // Insert placeable threads
    for thread in thread_placeables {
        let create_time = &now;
        let thread_id = sqlx::query_scalar!(
            r#"
            INSERT INTO "Thread" ("owner", "documentId", "createdAt", "updatedAt", "resolved")
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            "#,
            document.owner,
            document.document_id,
            create_time,
            create_time,
            thread.is_resolved,
        )
        .fetch_one(transaction.as_mut())
        .await?;

        let parsed_uuid_result = Uuid::try_parse(thread.head_id.as_str());
        if let Err(_e) = parsed_uuid_result {
            tracing::error!("head id is not a valid uuid");
            return Err(anyhow::anyhow!("head id is not a valid uuid"));
        }

        let _pdf_anchor_id = sqlx::query_scalar!(
            r#"
            INSERT INTO "PdfPlaceableCommentAnchor" ("uuid", "documentId", "owner", "page", "originalPage", "originalIndex", "shouldLockOnSave", "xPct", "yPct", "widthPct", "heightPct", "rotation", "threadId", "wasEdited", "wasDeleted", "allowableEdits")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING uuid
            "#,
            Uuid::parse_str(&thread.head_id).unwrap(),
            document.document_id,
            document.owner,
            thread.page,
            thread.original_page,
            thread.original_index,
            thread.should_lock_on_save,
            thread.position.x_pct,
            thread.position.y_pct,
            thread.position.width_pct,
            thread.position.height_pct,
            thread.position.rotation,
            thread_id,
            thread.was_edited,
            thread.was_deleted,
            serde_json::to_value(thread.allowable_edits).unwrap_or(serde_json::Value::Null),
        )
        .fetch_one(transaction.as_mut())
        .await?;

        // Insert comments for this thread
        for (i, comment) in thread.comments.iter().enumerate() {
            // Check if we have timestamp data for this comment ID
            let (created_at, updated_at) = if let Some(timestamps) =
                comment_timestamps.get(&comment.id.parse::<i64>().unwrap_or(-1))
            {
                // If we have existing timestamps, use them
                *timestamps
            } else {
                // Otherwise use current time for both
                (now, now)
            };

            let _comment_id = sqlx::query_scalar!(
                r#"
                INSERT INTO "Comment" ("threadId", "owner", "sender", "text", "createdAt", "updatedAt", "order")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
                "#,
                thread_id,
                document.owner,
                comment.sender,
                comment.content,
                created_at,
                updated_at,
                i as i32,
            )
            .fetch_one(transaction.as_mut())
            .await?;
        }
    }

    // Process highlights
    if let Some(highlights_map) = &pdf_modification_data.highlights {
        // Iterate through each page number and its highlights
        for highlights in highlights_map.values() {
            for highlight in highlights {
                // First create the highlight anchor
                let mut thread_id_opt: Option<i64> = None;

                // If highlight has a thread, create it first
                if let Some(thread) = &highlight.thread {
                    // Skip threads without comments
                    if !thread.comments.is_empty() {
                        // Calculate comment timestamps
                        let comment_dates = thread
                            .comments
                            .iter()
                            .map(|c| c.edit_date.naive_utc())
                            .collect::<Vec<_>>();
                        let first_comment_time = comment_dates.iter().min().unwrap_or(&now);
                        let last_comment_time = comment_dates.iter().max().unwrap_or(&now);

                        // Create thread
                        let thread_id = sqlx::query_scalar!(
                            r#"
                            INSERT INTO "Thread" ("owner", "documentId", "createdAt", "updatedAt", "resolved")
                            VALUES ($1, $2, $3, $4, $5)
                            RETURNING id
                            "#,
                            document.owner,
                            document.document_id,
                            first_comment_time,
                            last_comment_time,
                            thread.is_resolved,
                        )
                        .fetch_one(transaction.as_mut())
                        .await?;

                        thread_id_opt = Some(thread_id);

                        // Insert comments for this thread
                        for (i, comment) in thread.comments.iter().enumerate() {
                            // Check if we have timestamp data for this comment ID
                            let (created_at, updated_at) = if let Some(timestamps) =
                                comment_timestamps.get(&comment.id.parse::<i64>().unwrap_or(-1))
                            {
                                // If we have existing timestamps, use them
                                *timestamps
                            } else {
                                // Otherwise use the comment's edit date
                                let edit_date = comment.edit_date.naive_utc();
                                (edit_date, edit_date)
                            };

                            let _comment_id = sqlx::query_scalar!(
                                r#"
                                INSERT INTO "Comment" ("threadId", "owner", "sender", "text", "createdAt", "updatedAt", "order")
                                VALUES ($1, $2, $3, $4, $5, $6, $7)
                                RETURNING id
                                "#,
                                thread_id,
                                document.owner,
                                comment.sender,
                                comment.content,
                                created_at,
                                updated_at,
                                i as i32,
                            )
                            .fetch_one(transaction.as_mut())
                            .await?;
                        }
                    }
                }

                // Let Postgres generate a UUID if one isn't provided
                let highlight_anchor_uuid =
                    if let Some(highlight_uuid) = highlight.uuid.as_deref().map(Uuid::try_parse) {
                        if let Err(_e) = highlight_uuid {
                            return Err(anyhow::anyhow!("invalid highlight uuid"));
                        }
                        let highlight_uuid = highlight_uuid.unwrap();

                        // Check if we have timestamp data for this highlight UUID
                        let (created_at, updated_at) =
                            if let Some(timestamps) = highlight_timestamps.get(&highlight_uuid) {
                                // If we have existing timestamps, use them
                                *timestamps
                            } else {
                                // Otherwise use current time for both
                                (now, now)
                            };

                        // Use the provided UUID
                        sqlx::query_scalar!(
                            r#"
        INSERT INTO "PdfHighlightAnchor" (
            "uuid", "documentId", "owner", "page", "red", "green", "blue", "alpha", 
            "type", "text", "pageViewportWidth", "pageViewportHeight", 
            "threadId", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING uuid
        "#,
                            highlight_uuid,
                            document.document_id,
                            document.owner,
                            highlight.page_num as i32,
                            highlight.color.red,
                            highlight.color.green,
                            highlight.color.blue,
                            highlight.color.alpha.unwrap_or(1.0),
                            highlight.highlight_type as i32,
                            highlight.text,
                            highlight.page_viewport.as_ref().map_or(0.0, |wh| wh.width),
                            highlight.page_viewport.as_ref().map_or(0.0, |wh| wh.height),
                            thread_id_opt,
                            created_at,
                            updated_at,
                        )
                        .fetch_one(transaction.as_mut())
                        .await?
                    } else {
                        // Let Postgres generate a UUID
                        sqlx::query_scalar!(
                            r#"
        INSERT INTO "PdfHighlightAnchor" (
            "documentId", "owner", "page", "red", "green", "blue", "alpha", 
            "type", "text", "pageViewportWidth", "pageViewportHeight", 
            "threadId", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING uuid
        "#,
                            document.document_id,
                            document.owner,
                            highlight.page_num as i32,
                            highlight.color.red,
                            highlight.color.green,
                            highlight.color.blue,
                            highlight.color.alpha.unwrap_or(1.0),
                            highlight.highlight_type as i32,
                            highlight.text,
                            highlight.page_viewport.as_ref().map_or(0.0, |wh| wh.width),
                            highlight.page_viewport.as_ref().map_or(0.0, |wh| wh.height),
                            thread_id_opt,
                            now,
                            now,
                        )
                        .fetch_one(transaction.as_mut())
                        .await?
                    };

                // Create highlight rectangles
                for rect in &highlight.rects {
                    let _rect_id = sqlx::query!(
                        r#"
                        INSERT INTO "PdfHighlightRect" (
                            "top", "left", "width", "height", "pdfHighlightAnchorId"
                        )
                        VALUES ($1, $2, $3, $4, $5)
                        RETURNING id
                        "#,
                        rect.top,
                        rect.left,
                        rect.width,
                        rect.height,
                        highlight_anchor_uuid,
                    )
                    .fetch_one(transaction.as_mut())
                    .await?;
                }
            }
        }
    }

    Ok(())
}

pub async fn try_insert_comment_data(
    transaction: &mut Transaction<'_, Postgres>,
    document: &DocumentBasic,
    modification_data: serde_json::Value,
) -> anyhow::Result<()> {
    // Try to insert all comment data but don't fail the main transaction if it fails
    // Create a savepoint
    sqlx::query("SAVEPOINT comment_data_insertion")
        .execute(transaction.as_mut())
        .await?;
    let result = insert_all_comment_data(transaction, document, modification_data.clone()).await;
    // Based on the result, either commit or rollback the savepoint
    match result {
        Ok(_) => {
            // Commit the savepoint, will still only be committed if the parent transaction is committed
            sqlx::query("RELEASE SAVEPOINT comment_data_insertion")
                .execute(transaction.as_mut())
                .await?;
            Ok(())
        }
        Err(err) => {
            // Rollback to the savepoint in case of error
            tracing::error!(error=?err, "Error in try_insert_all_comment_data, rolling back to savepoint");
            println!("try insert comment error {:?}", err);
            sqlx::query("ROLLBACK TO SAVEPOINT comment_data_insertion")
                .execute(transaction.as_mut())
                .await?;
            Err(err)
        }
    }
}

/// Inserts the bom parts into the database for a docx document
#[tracing::instrument(skip(transaction, document_bom_parts))]
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

    let document = sqlx::query_as!(
        DocumentBasic,
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

                // update pdf placeable comment tables
                // if file_type == FileType::Pdf {
                //     try_insert_comment_data(&mut transaction, &document, modification_data.clone())
                //         .await
                //         .ok();
                // }
            }

            VersionIDWithTimeStampsOptionalSha {
                id: document_instance.id,
                sha: Some(document_instance.sha),
                created_at: document_instance.created_at,
                updated_at: document_instance.updated_at,
            }
        }
    };

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
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());

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
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
        let bom_parts: Vec<BomPart> =
            serde_json::from_value(document_metadata.document_bom.unwrap()).unwrap();
        assert_eq!(bom_parts[0].sha, "sha-1");
        assert_eq!(bom_parts[0].path, "path-1");
    }
}

// #[cfg(test)]
// mod document_pdf_placeable_comments_tests {
//     use super::*;
//     use chrono::Utc;
//     use model::document::modification_data::{
//         AllowableEdits, Comment, Payload, PdfModificationData, Placeable, PlaceablePosition, Thread,
//     };
//     use sqlx::{Pool, Postgres};
//     use std::collections::HashMap;
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_save_document_succeeds_when_comment_insert_fails(
//         pool: Pool<Postgres>,
//     ) -> anyhow::Result<()> {
//         // First, get the current count of threads for our document
//         let initial_threads = sqlx::query!(
//         r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-with-comments'"#
//     )
//     .fetch_one(&pool)
//     .await?
//     .count
//     .unwrap_or(0);
//
//         // Create a modification data with invalid thread structure that will cause insert_comment_data to fail
//         let invalid_thread = Placeable {
//             allowable_edits: AllowableEdits {
//                 allow_resize: true,
//                 allow_translate: true,
//                 allow_rotate: true,
//                 allow_delete: true,
//                 lock_aspect_ratio: false,
//             },
//             was_edited: false,
//             was_deleted: false,
//             page_range: vec![1],
//             position: PlaceablePosition {
//                 x_pct: 0.3,
//                 y_pct: 0.3,
//                 width_pct: 0.1,
//                 height_pct: 0.05,
//                 rotation: 0.0,
//             },
//             should_lock_on_save: true,
//             original_page: 1,
//             original_index: 0,
//             payload: Payload::Thread(Thread {
//                 // Invalid head_id type that will cause conversion error when parsed as BigInt
//                 head_id: "not-a-number".to_string(),
//                 page: 1,
//                 comments: vec![Comment {
//                     id: "comment-id".to_string(),
//                     sender: "badsender".to_string(),
//                     content: "this should not exist".to_string(),
//                     edit_date: Utc::now(),
//                 }],
//                 is_resolved: false,
//             }),
//         };
//
//         let invalid_data = PdfModificationData {
//             placeables: vec![invalid_thread],
//             highlights: Some(HashMap::new()),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // this will cause the insert to fail
//         sqlx::raw_sql(r#"ALTER TABLE "PdfPlaceableCommentAnchor" DROP COLUMN "wasEdited""#)
//             .execute(&pool)
//             .await?;
//
//         // Try to save document with the invalid thread data
//         let result = save_document(
//             pool.clone(),
//             "document-with-comments",
//             FileType::Pdf,
//             Some("sha-invalid-test"),
//             Some(serde_json::to_value(invalid_data)?),
//             None,
//         )
//         .await;
//
//         // Verify the save_document completed successfully despite the invalid comment data
//         assert!(
//             result.is_ok(),
//             "save_document should succeed even when insert_comment_data fails"
//         );
//
//         // Verify a new document instance was created
//         let new_instance = sqlx::query!(
//             r#"
//         SELECT di.id
//         FROM "DocumentInstance" di
//         WHERE di."documentId" = 'document-with-comments' AND di.sha = 'sha-invalid-test'
//         "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         assert!(
//             new_instance.id > 0,
//             "A new document instance should be created"
//         );
//
//         // Verify that the modification data was saved
//         let mod_data_exists = sqlx::query!(
//             r#"
//         SELECT COUNT(*) as count
//         FROM "DocumentInstanceModificationData" dim
//         WHERE dim."documentInstanceId" = $1
//         "#,
//             new_instance.id
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(mod_data_exists, 1, "Modification data should be saved");
//
//         // Now verify that the comment insertion actually failed by checking if any new threads were created
//         let final_threads = sqlx::query!(
//         r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-with-comments'"#
//     )
//     .fetch_one(&pool)
//     .await?
//     .count
//     .unwrap_or(0);
//
//         // The thread count should remain unchanged, confirming the insert operation failed
//         assert_eq!(
//             final_threads, initial_threads,
//             "Thread count should remain unchanged, confirming insert_comment_data failed"
//         );
//
//         // Also check if any new comments were added
//         let comments_for_new_instance = sqlx::query!(
//             r#"
//         SELECT COUNT(*) as count
//         FROM "Comment" c
//         JOIN "Thread" t ON c."threadId" = t.id
//         WHERE t."documentId" = 'document-with-comments' AND c.sender = 'badsender'
//         "#,
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(
//             comments_for_new_instance, 0,
//             "No new comments should be added, confirming insert_comment_data failed"
//         );
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_consistent_thread_and_pdf_data(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Query the document and threads from the database
//         let document = sqlx::query!(
//             r#"
//             SELECT d.id, d."fileType" as file_type
//             FROM "Document" d
//             WHERE d.id = 'document-with-comments'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // Verify document exists
//         assert_eq!(document.id, "document-with-comments");
//         assert_eq!(document.file_type, "pdf");
//
//         // Get all threads for this document
//         let threads = sqlx::query!(
//             r#"
//             SELECT t.id, t.resolved, t."createdAt"
//             FROM "Thread" t
//             WHERE t."documentId" = 'document-with-comments' AND t."deletedAt" IS NULL
//             ORDER BY t.id
//             "#
//         )
//         .fetch_all(&pool)
//         .await?;
//
//         // There should be 3 threads
//         assert_eq!(threads.len(), 3);
//
//         // Get the modification data
//         let modification_data = sqlx::query!(
//             r#"
//             SELECT dim."modificationData" as modification_data
//             FROM "DocumentInstanceModificationData" dim
//             JOIN "DocumentInstance" di ON dim."documentInstanceId" = di.id
//             WHERE di."documentId" = 'document-with-comments'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // Parse the modification data
//         let pdf_mod_data: PdfModificationData =
//             serde_json::from_value(modification_data.modification_data)?;
//
//         // Verify the number of placeables matches the number of threads
//         assert_eq!(pdf_mod_data.placeables.len(), threads.len());
//
//         // Verify each thread has matching data in the PDF modification data
//         for thread in threads {
//             // Get thread comments
//             let comments = sqlx::query!(
//                 r#"
//                 SELECT c.id, c.sender, c.text
//                 FROM "Comment" c
//                 WHERE c."threadId" = $1
//                 ORDER BY c.id
//                 "#,
//                 thread.id
//             )
//             .fetch_all(&pool)
//             .await?;
//
//             // Get anchor for this thread
//             let anchor = sqlx::query!(
//                 r#"
//                 SELECT pa.page, pa."originalPage" as original_page, pa."originalIndex" as original_index,
//                       pa."xPct" as x_pct, pa."yPct" as y_pct, pa."widthPct" as width_pct, pa."heightPct" as height_pct,
//                       pa."wasEdited" as was_edited, pa."wasDeleted" as was_deleted, pa."shouldLockOnSave" as should_lock_on_save
//                 FROM "PdfPlaceableCommentAnchor" pa
//                 WHERE pa."threadId" = $1
//                 "#,
//                 thread.id
//             )
//             .fetch_one(&pool)
//             .await?;
//
//             // Find matching placeable in modification data
//             // (we match by original page and index)
//             let matching_placeable = pdf_mod_data.placeables.iter().find(|p| {
//                 if let Payload::Thread(_thread_data) = &p.payload {
//                     p.original_page == anchor.original_page
//                         && p.original_index == anchor.original_index
//                 } else {
//                     false
//                 }
//             });
//
//             assert!(
//                 matching_placeable.is_some(),
//                 "No matching placeable found for thread {} at page {} index {}",
//                 thread.id,
//                 anchor.original_page,
//                 anchor.original_index
//             );
//
//             let placeable = matching_placeable.unwrap();
//
//             // Verify position data matches
//             assert_eq!(placeable.position.x_pct, anchor.x_pct);
//             assert_eq!(placeable.position.y_pct, anchor.y_pct);
//             assert_eq!(placeable.position.width_pct, anchor.width_pct);
//             assert_eq!(placeable.position.height_pct, anchor.height_pct);
//
//             assert_eq!(placeable.was_edited, anchor.was_edited);
//             assert_eq!(placeable.was_deleted, anchor.was_deleted);
//             assert_eq!(placeable.should_lock_on_save, anchor.should_lock_on_save);
//
//             // Verify thread data
//             if let Payload::Thread(thread_data) = &placeable.payload {
//                 assert_eq!(thread_data.page, anchor.page);
//
//                 // Verify the resolved status matches
//                 assert_eq!(
//                     thread_data.is_resolved, thread.resolved,
//                     "Thread {} resolved status mismatch",
//                     thread.id
//                 );
//
//                 // Verify number of comments matches
//                 assert_eq!(
//                     thread_data.comments.len(),
//                     comments.len(),
//                     "Thread {} comment count mismatch",
//                     thread.id
//                 );
//             } else {
//                 panic!("Expected Thread payload");
//             }
//         }
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_updating_comments(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Get the original thread count
//         let original_thread_count = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-for-updates'"#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(
//             original_thread_count, 1,
//             "Should start with exactly one thread"
//         );
//
//         // Create updated thread data
//         let updated_thread = Placeable {
//             allowable_edits: AllowableEdits {
//                 allow_resize: true,
//                 allow_translate: true,
//                 allow_rotate: true,
//                 allow_delete: true,
//                 lock_aspect_ratio: false,
//             },
//             was_edited: true,
//             was_deleted: false,
//             page_range: vec![1],
//             position: PlaceablePosition {
//                 x_pct: 0.4, // Changed position
//                 y_pct: 0.5, // Changed position
//                 width_pct: 0.12,
//                 height_pct: 0.06,
//                 rotation: 0.0,
//             },
//             should_lock_on_save: true,
//             original_page: 1,
//             original_index: 0,
//             payload: Payload::Thread(Thread {
//                 head_id: "11111111-1111-1111-1111-111111111111".to_string(),
//                 page: 1,
//                 comments: vec![
//                     Comment {
//                         id: "update-comment1".to_string(),
//                         sender: "user@user.com".to_string(),
//                         content: "Initial comment for thread".to_string(),
//                         edit_date: Utc::now(),
//                     },
//                     Comment {
//                         id: "update-comment2".to_string(),
//                         sender: "user2@user.com".to_string(),
//                         content: "New response".to_string(),
//                         edit_date: Utc::now(),
//                     },
//                 ],
//                 is_resolved: true, // Changed to resolved
//             }),
//         };
//
//         let updated_data = PdfModificationData {
//             placeables: vec![updated_thread],
//             highlights: Some(HashMap::new()),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // Save document with updated thread
//         save_document(
//             pool.clone(),
//             "document-for-updates",
//             FileType::Pdf,
//             Some("sha-updates-2"),
//             Some(serde_json::to_value(updated_data)?),
//             None,
//         )
//         .await?;
//
//         // Verify the thread was updated
//         let updated_threads = sqlx::query!(
//             r#"
//             SELECT t.id, t.resolved
//             FROM "Thread" t
//             WHERE t."documentId" = 'document-for-updates'
//             "#
//         )
//         .fetch_all(&pool)
//         .await?;
//
//         // Should still have one thread (old one deleted, new one created)
//         assert_eq!(updated_threads.len(), 1);
//
//         // The thread should now be resolved
//         assert_eq!(updated_threads[0].resolved, true);
//
//         let thread_id = updated_threads[0].id;
//
//         // Verify position was updated
//         let anchors = sqlx::query!(
//             r#"
//             SELECT pa."xPct" as x_pct, pa."yPct" as y_pct, pa."wasEdited" as was_edited
//             FROM "PdfPlaceableCommentAnchor" pa
//             WHERE pa."threadId" = $1
//             "#,
//             thread_id
//         )
//         .fetch_all(&pool)
//         .await?;
//
//         assert_eq!(anchors.len(), 1);
//         assert_eq!(anchors[0].x_pct, 0.4); // Updated position
//         assert_eq!(anchors[0].y_pct, 0.5); // Updated position
//         assert_eq!(anchors[0].was_edited, true);
//
//         // Verify comments were updated
//         let comments = sqlx::query!(
//             r#"
//             SELECT c.id, c.text
//             FROM "Comment" c
//             WHERE c."threadId" = $1
//             ORDER BY c.id
//             "#,
//             thread_id
//         )
//         .fetch_all(&pool)
//         .await?;
//
//         // Should have two comments now
//         assert_eq!(comments.len(), 2);
//         assert_eq!(comments[0].text, "Initial comment for thread");
//         assert_eq!(comments[1].text, "New response");
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_thread_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Verify initial state
//         let initial_threads = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-delete-test'"#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(initial_threads, 2, "Should start with exactly two threads");
//
//         // Get the original modification data
//         let original_data = sqlx::query!(
//             r#"
//             SELECT dim."modificationData" as modification_data
//             FROM "DocumentInstanceModificationData" dim
//             JOIN "DocumentInstance" di ON dim."documentInstanceId" = di.id
//             WHERE di."documentId" = 'document-delete-test'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         let mut pdf_mod_data: PdfModificationData =
//             serde_json::from_value(original_data.modification_data)?;
//
//         // Verify it only has one placeable
//         assert_eq!(pdf_mod_data.placeables.len(), 1);
//
//         // Save document with empty placeables (deleting all threads)
//         pdf_mod_data.placeables = vec![];
//
//         save_document(
//             pool.clone(),
//             "document-delete-test",
//             FileType::Pdf,
//             Some("sha-delete-2"),
//             Some(serde_json::to_value(pdf_mod_data)?),
//             None,
//         )
//         .await?;
//
//         // Verify all threads were deleted
//         let final_threads = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-delete-test'"#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(final_threads, 0, "All threads should be deleted");
//
//         // Verify anchors were also deleted (cascading delete)
//         let final_anchors = sqlx::query!(
//             r#"
//             SELECT COUNT(*) as count
//             FROM "PdfPlaceableCommentAnchor" pa
//             JOIN "Thread" t ON pa."threadId" = t.id
//             WHERE t."documentId" = 'document-delete-test'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(final_anchors, 0, "All anchors should be deleted");
//
//         // Verify comments were also deleted (cascading delete)
//         let final_comments = sqlx::query!(
//             r#"
//             SELECT COUNT(*) as count
//             FROM "Comment" c
//             JOIN "Thread" t ON c."threadId" = t.id
//             WHERE t."documentId" = 'document-delete-test'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(final_comments, 0, "All comments should be deleted");
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_mixed_thread_operations(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // This test simulates a complex update with multiple operations:
//         // 1. Adding a new thread
//         // 2. Updating an existing thread
//         // 3. Removing a thread
//
//         // First, let's get a document with multiple threads
//         let document_id = "document-with-comments";
//
//         // Create updated modification data:
//         // - Keep thread 1 (id 1001) with updates
//         // - Remove thread 2 (id 1002)
//         // - Keep thread 3 (id 1003) unchanged
//         // - Add a new thread
//
//         let placeables = vec![
//             // Updated thread 1
//             Placeable {
//                 allowable_edits: AllowableEdits {
//                     allow_resize: true,
//                     allow_translate: true,
//                     allow_rotate: true,
//                     allow_delete: true,
//                     lock_aspect_ratio: false,
//                 },
//                 was_edited: true,
//                 was_deleted: false,
//                 page_range: vec![1],
//                 position: PlaceablePosition {
//                     x_pct: 0.25, // Changed position
//                     y_pct: 0.35, // Changed position
//                     width_pct: 0.12,
//                     height_pct: 0.06,
//                     rotation: 0.0,
//                 },
//                 should_lock_on_save: true,
//                 original_page: 1,
//                 original_index: 0,
//                 payload: Payload::Thread(Thread {
//                     head_id: "11111111-1111-1111-1111-111111111111".to_string(),
//                     page: 1,
//                     comments: vec![
//                         Comment {
//                             id: "comment1".to_string(),
//                             sender: "user@user.com".to_string(),
//                             content: "Initial question on page 1".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                         Comment {
//                             id: "comment2".to_string(),
//                             sender: "user2@user.com".to_string(),
//                             content: "Response to question on page 1".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                         Comment {
//                             id: "comment3".to_string(),
//                             sender: "user@user.com".to_string(),
//                             content: "Follow up question".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                         Comment {
//                             id: "comment-new".to_string(),
//                             sender: "user2@user.com".to_string(),
//                             content: "Additional response".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                     ],
//                     is_resolved: true, // Changed to resolved
//                 }),
//             },
//             // Unchanged thread 3
//             Placeable {
//                 allowable_edits: AllowableEdits {
//                     allow_resize: true,
//                     allow_translate: true,
//                     allow_rotate: true,
//                     allow_delete: true,
//                     lock_aspect_ratio: false,
//                 },
//                 was_edited: true,
//                 was_deleted: false,
//                 page_range: vec![3],
//                 position: PlaceablePosition {
//                     x_pct: 0.7,
//                     y_pct: 0.4,
//                     width_pct: 0.12,
//                     height_pct: 0.06,
//                     rotation: 0.0,
//                 },
//                 should_lock_on_save: true,
//                 original_page: 3,
//                 original_index: 2,
//                 payload: Payload::Thread(Thread {
//                     head_id: "22222222-2222-2222-2222-222222222222".to_string(),
//                     page: 3,
//                     comments: vec![Comment {
//                         id: "comment7".to_string(),
//                         sender: "user2@user.com".to_string(),
//                         content: "Feedback on page 3".to_string(),
//                         edit_date: Utc::now(),
//                     }],
//                     is_resolved: false,
//                 }),
//             },
//             // New thread
//             Placeable {
//                 allowable_edits: AllowableEdits {
//                     allow_resize: true,
//                     allow_translate: true,
//                     allow_rotate: true,
//                     allow_delete: true,
//                     lock_aspect_ratio: false,
//                 },
//                 was_edited: false,
//                 was_deleted: false,
//                 page_range: vec![4],
//                 position: PlaceablePosition {
//                     x_pct: 0.3,
//                     y_pct: 0.3,
//                     width_pct: 0.1,
//                     height_pct: 0.05,
//                     rotation: 0.0,
//                 },
//                 should_lock_on_save: true,
//                 original_page: 4,
//                 original_index: -1, // New thread
//                 payload: Payload::Thread(Thread {
//                     head_id: "33333333-3333-3333-3333-333333333333".to_string(),
//                     page: 4,
//                     comments: vec![Comment {
//                         id: "new-comment".to_string(),
//                         sender: "user@user.com".to_string(),
//                         content: "Comment on a new page".to_string(),
//                         edit_date: Utc::now(),
//                     }],
//                     is_resolved: false,
//                 }),
//             },
//         ];
//
//         let updated_data = PdfModificationData {
//             placeables,
//             highlights: Some(HashMap::new()),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // Save document with the updated threads
//         save_document(
//             pool.clone(),
//             document_id,
//             FileType::Pdf,
//             Some("sha-mix-ops"),
//             Some(serde_json::to_value(updated_data)?),
//             None,
//         )
//         .await?;
//
//         // Verify the thread count
//         let final_threads = sqlx::query!(
//             r#"SELECT id, resolved FROM "Thread" WHERE "documentId" = $1 ORDER BY id"#,
//             document_id
//         )
//         .fetch_all(&pool)
//         .await?;
//
//         assert_eq!(
//             final_threads.len(),
//             3,
//             "Should still have three threads (one removed, one added)"
//         );
//
//         // Thread 1 should be resolved now
//         let thread1 = final_threads
//             .iter()
//             .find(|t| t.resolved)
//             .expect("Thread 1 should be resolved");
//
//         // Get comments for thread 1
//         let thread1_comments = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Comment" WHERE "threadId" = $1"#,
//             thread1.id
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(thread1_comments, 4, "Thread 1 should have 4 comments now");
//
//         // Verify we have a comment on page 4 (new thread)
//         let page4_thread = sqlx::query!(
//             r#"
//             SELECT t.id
//             FROM "Thread" t
//             JOIN "PdfPlaceableCommentAnchor" pa ON t.id = pa."threadId"
//             WHERE t."documentId" = $1 AND pa.page = 4
//             "#,
//             document_id
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // The new thread should exist
//         assert!(page4_thread.id > 0, "New thread on page 4 should exist");
//
//         // Verify thread 2 (resolved thread) was deleted
//         let thread2_exists = sqlx::query!(
//             r#"
//             SELECT COUNT(*) as count
//             FROM "Thread" t
//             JOIN "PdfPlaceableCommentAnchor" pa ON t.id = pa."threadId"
//             WHERE t."documentId" = $1 AND pa.page = 2 AND t.resolved = true
//             "#,
//             document_id
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(thread2_exists, 0, "Thread 2 should be deleted");
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_comment_timestamp_preservation(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Get a comment's original timestamps
//         let original_comment = sqlx::query!(
//             r#"
//             SELECT c.id, c."createdAt" as created_at, c."updatedAt" as updated_at
//             FROM "Comment" c
//             JOIN "Thread" t ON c."threadId" = t.id
//             WHERE t."documentId" = 'document-for-updates'
//             LIMIT 1
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // Capture original timestamps
//         let original_created_at = original_comment.created_at;
//         let original_updated_at = original_comment.updated_at;
//         let comment_id = original_comment.id;
//
//         // Wait a bit to ensure timestamps would differ if not preserved
//         tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
//
//         // Create updated thread data that reuses the same comment ID
//         let updated_thread = Placeable {
//             allowable_edits: AllowableEdits {
//                 allow_resize: true,
//                 allow_translate: true,
//                 allow_rotate: true,
//                 allow_delete: true,
//                 lock_aspect_ratio: false,
//             },
//             was_edited: true,
//             was_deleted: false,
//             page_range: vec![1],
//             position: PlaceablePosition {
//                 x_pct: 0.4,
//                 y_pct: 0.5,
//                 width_pct: 0.12,
//                 height_pct: 0.06,
//                 rotation: 0.0,
//             },
//             should_lock_on_save: true,
//             original_page: 1,
//             original_index: 0,
//             payload: Payload::Thread(Thread {
//                 head_id: "11111111-1111-1111-1111-111111111111".to_string(),
//                 page: 1,
//                 comments: vec![
//                     Comment {
//                         // Use the same comment ID to test timestamp preservation
//                         id: comment_id.to_string(),
//                         sender: "user@user.com".to_string(),
//                         content: "Updated content for preserved timestamps".to_string(),
//                         edit_date: Utc::now(),
//                     },
//                     Comment {
//                         id: "new-comment".to_string(),
//                         sender: "user2@user.com".to_string(),
//                         content: "New response".to_string(),
//                         edit_date: Utc::now(),
//                     },
//                 ],
//                 is_resolved: true,
//             }),
//         };
//
//         let updated_data = PdfModificationData {
//             placeables: vec![updated_thread],
//             highlights: Some(HashMap::new()),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // Save document with updated thread
//         save_document(
//             pool.clone(),
//             "document-for-updates",
//             FileType::Pdf,
//             Some("sha-timestamp-test"),
//             Some(serde_json::to_value(updated_data)?),
//             None,
//         )
//         .await?;
//
//         // Get the updated comment
//         let updated_comment = sqlx::query!(
//             r#"
//             SELECT c.id, c.text, c."createdAt" as created_at, c."updatedAt" as updated_at
//             FROM "Comment" c
//             JOIN "Thread" t ON c."threadId" = t.id
//             WHERE t."documentId" = 'document-for-updates' AND c.text = 'Updated content for preserved timestamps'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // Verify content was updated
//         assert_eq!(
//             updated_comment.text,
//             "Updated content for preserved timestamps"
//         );
//
//         // Verify timestamps were preserved
//         assert_eq!(
//             updated_comment.created_at.and_utc().timestamp(),
//             original_created_at.and_utc().timestamp(),
//             "Created_at timestamp should be preserved"
//         );
//
//         assert_eq!(
//             updated_comment.updated_at.and_utc().timestamp(),
//             original_updated_at.and_utc().timestamp(),
//             "Updated_at timestamp should be preserved"
//         );
//
//         // Verify the new comment has new timestamps
//         let new_comment = sqlx::query!(
//             r#"
//             SELECT c.id, c.text, c."createdAt" as created_at
//             FROM "Comment" c
//             JOIN "Thread" t ON c."threadId" = t.id
//             WHERE t."documentId" = 'document-for-updates' AND c.text = 'New response'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         // New comment should have newer timestamp
//         assert!(
//             new_comment.created_at.and_utc().timestamp()
//                 > original_created_at.and_utc().timestamp(),
//             "New comment should have newer timestamp"
//         );
//
//         Ok(())
//     }
// }

// #[cfg(test)]
// mod document_pdf_highlight_tests {
//     use super::*;
//     use chrono::Utc;
//     use model::document::modification_data::{
//         Color, Comment, Highlight, HighlightRect, PdfModificationData, Thread, WH,
//     };
//     use sqlx::{Pool, Postgres};
//     use std::collections::HashMap;
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_highlight_insertion(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Get initial count of highlights
//         let initial_highlights =
//             sqlx::query!(r#"SELECT COUNT(*) as count FROM "PdfHighlightAnchor""#)
//                 .fetch_one(&pool)
//                 .await?
//                 .count
//                 .unwrap_or(0);
//
//         assert_eq!(
//             initial_highlights, 3,
//             "Should start with correct number of highlights"
//         );
//
//         // Create test data with highlights
//         let mut highlight_map = HashMap::new();
//         highlight_map.insert(
//             1u32,
//             vec![Highlight {
//                 page_num: 1,
//                 rects: vec![
//                     HighlightRect {
//                         top: 100.0,
//                         left: 200.0,
//                         width: 300.0,
//                         height: 25.0,
//                     },
//                     HighlightRect {
//                         top: 130.0,
//                         left: 200.0,
//                         width: 250.0,
//                         height: 25.0,
//                     },
//                 ],
//                 color: Color {
//                     red: 255,
//                     green: 255,
//                     blue: 0,
//                     alpha: Some(0.5),
//                 },
//                 highlight_type: 1.into(), // HIGHLIGHT
//                 thread: None,             // No thread
//                 text: "This is a highlighted text".to_string(),
//                 page_viewport: Some(WH {
//                     width: 800.0,
//                     height: 600.0,
//                 }),
//                 has_temp_thread: None,
//                 uuid: Some("11111111-1111-1111-1111-111111111111".to_string()),
//             }],
//         );
//
//         let modification_data = PdfModificationData {
//             placeables: vec![],
//             highlights: Some(highlight_map),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // Save document with highlights
//         save_document(
//             pool.clone(),
//             "document-with-comments",
//             FileType::Pdf,
//             Some("sha-highlight-test"),
//             Some(serde_json::to_value(modification_data)?),
//             None,
//         )
//         .await?;
//
//         // Check if highlights were created
//         let final_highlights =
//             sqlx::query!(r#"SELECT COUNT(*) as count FROM "PdfHighlightAnchor""#)
//                 .fetch_one(&pool)
//                 .await?
//                 .count
//                 .unwrap_or(0);
//
//         assert!(
//             final_highlights == 1,
//             "Highlights should be created (with modification data overwrite)"
//         );
//
//         // Verify highlight rectangles were created
//         let highlight_rects = sqlx::query!(r#"SELECT COUNT(*) as count FROM "PdfHighlightRect""#)
//             .fetch_one(&pool)
//             .await?
//             .count
//             .unwrap_or(0);
//
//         assert!(highlight_rects == 2, "Should have 2 highlight rectangles");
//
//         // Verify highlight details
//         let highlight = sqlx::query!(
//             r#"
//             SELECT
//                 ha.page, ha.red, ha.green, ha.blue, ha.alpha, ha.type, ha.text,
//                 ha."pageViewportWidth", ha."pageViewportHeight"
//             FROM "PdfHighlightAnchor" ha
//             WHERE ha."documentId" = 'document-with-comments'
//             ORDER BY ha."createdAt" DESC
//             LIMIT 1
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         assert_eq!(highlight.page, 1);
//         assert_eq!(highlight.red, 255);
//         assert_eq!(highlight.green, 255);
//         assert_eq!(highlight.blue, 0);
//         assert_eq!(highlight.alpha, 0.5);
//         assert_eq!(highlight.r#type, 1);
//         assert_eq!(highlight.text, "This is a highlighted text");
//         assert_eq!(highlight.pageViewportWidth, 800.0);
//         assert_eq!(highlight.pageViewportHeight, 600.0);
//
//         Ok(())
//     }
//
//     #[sqlx::test(fixtures(
//         path = "../../fixtures",
//         scripts("document_pdf_comments_and_highlights")
//     ))]
//     async fn test_highlight_with_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
//         // Create test data with highlights that have threads
//         let mut highlight_map = HashMap::new();
//         highlight_map.insert(
//             2u32,
//             vec![Highlight {
//                 page_num: 2,
//                 rects: vec![HighlightRect {
//                     top: 150.0,
//                     left: 220.0,
//                     width: 280.0,
//                     height: 25.0,
//                 }],
//                 color: Color {
//                     red: 100,
//                     green: 200,
//                     blue: 255,
//                     alpha: Some(0.7),
//                 },
//                 highlight_type: 2.into(), // UNDERLINE
//                 thread: Some(Thread {
//                     head_id: "11111111-1111-1111-1111-111111111111".to_string(),
//                     page: 2,
//                     comments: vec![
//                         Comment {
//                             id: "highlight-comment-1".to_string(),
//                             sender: "user@user.com".to_string(),
//                             content: "Comment on highlighted text".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                         Comment {
//                             id: "highlight-comment-2".to_string(),
//                             sender: "user2@user.com".to_string(),
//                             content: "Reply to highlight comment".to_string(),
//                             edit_date: Utc::now(),
//                         },
//                     ],
//                     is_resolved: false,
//                 }),
//                 text: "Text with a thread attached".to_string(),
//                 page_viewport: Some(WH {
//                     width: 800.0,
//                     height: 600.0,
//                 }),
//                 has_temp_thread: None,
//                 uuid: Some("22222222-2222-2222-2222-222222222222".to_string()),
//             }],
//         );
//
//         let modification_data = PdfModificationData {
//             placeables: vec![],
//             highlights: Some(highlight_map),
//             bookmarks: vec![],
//             pinned_terms_names: vec![],
//         };
//
//         // Save document with highlights that have threads
//         save_document(
//             pool.clone(),
//             "document-with-comments",
//             FileType::Pdf,
//             Some("sha-highlight-thread-test"),
//             Some(serde_json::to_value(modification_data)?),
//             None,
//         )
//         .await?;
//
//         // Check if new threads were created
//         let final_threads = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Thread" WHERE "documentId" = 'document-with-comments'"#
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert!(
//             final_threads == 1,
//             "New thread should be created for highlights"
//         );
//
//         // Verify highlight with thread reference - FIXED: query by UUID instead of text
//         let highlight_with_thread = sqlx::query!(
//             r#"
//             SELECT ha.uuid, ha.text, ha."threadId"
//             FROM "PdfHighlightAnchor" ha
//             WHERE ha."documentId" = 'document-with-comments' AND ha.uuid = '22222222-2222-2222-2222-222222222222'
//             "#
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         assert!(
//             highlight_with_thread.threadId.is_some(),
//             "Highlight should have a thread ID"
//         );
//
//         // Get the thread to check if it's resolved
//         let thread = sqlx::query!(
//             r#"SELECT resolved FROM "Thread" WHERE id = $1"#,
//             highlight_with_thread.threadId
//         )
//         .fetch_one(&pool)
//         .await?;
//
//         assert!(!thread.resolved, "Thread should not be resolved");
//
//         // Verify comments were created for the highlight's thread
//         let thread_id = highlight_with_thread.threadId.unwrap();
//         let comments = sqlx::query!(
//             r#"SELECT COUNT(*) as count FROM "Comment" WHERE "threadId" = $1"#,
//             thread_id
//         )
//         .fetch_one(&pool)
//         .await?
//         .count
//         .unwrap_or(0);
//
//         assert_eq!(comments, 2, "Thread should have two comments");
//
//         Ok(())
//     }
// }
