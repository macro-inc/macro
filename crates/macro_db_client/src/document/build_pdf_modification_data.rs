use model::{
    annotations::HighlightType,
    document::modification_data::{
        AllowableEdits, Color, Comment, Highlight, HighlightRect, Payload, PdfModificationData,
        Placeable, PlaceablePosition, Thread, WH,
    },
};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;

use super::get_document;

pub async fn get_pdf_modification_data_for_document(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<PdfModificationData> {
    let metadata = get_document(db, document_id).await?;
    let existing_modification_data = metadata.modification_data;

    let modification_data = match existing_modification_data {
        Some(modification_data) => serde_json::from_value(modification_data)?,
        None => PdfModificationData {
            highlights: Some(HashMap::new()),
            bookmarks: Vec::new(),
            placeables: Vec::new(),
            pinned_terms_names: Vec::new(),
        },
    };

    Ok(modification_data)
}

/// Retrieves complete PDF modification data from the database tables
#[tracing::instrument(skip(db))]
pub async fn get_complete_pdf_modification_data(
    db: &Pool<Postgres>,
    document_id: &str,
    initial_modification_data: Option<PdfModificationData>,
) -> anyhow::Result<PdfModificationData> {
    let mut modification_data = match initial_modification_data {
        Some(modification_data) => modification_data,
        None => PdfModificationData {
            highlights: Some(HashMap::new()),
            bookmarks: Vec::new(),
            placeables: Vec::new(),
            pinned_terms_names: Vec::new(),
        },
    };

    // clear highlights
    modification_data.highlights = Some(HashMap::new());

    // clear thread placeables
    modification_data
        .placeables
        .retain(|p| !matches!(p.payload, Payload::Thread(_)));

    // Query all threads with their anchors for this document
    let thread_anchors = sqlx::query!(
        r#"
        SELECT 
            t.id as thread_id, 
            t.resolved as is_resolved,
            a.uuid as anchor_uuid, 
            a.page, 
            a."originalPage" as original_page,
            a."originalIndex" as original_index,
            a."shouldLockOnSave" as should_lock_on_save,
            a."wasEdited" as was_edited,
            a."wasDeleted" as was_deleted,
            a."allowableEdits" as allowable_edits,
            a."xPct" as x_pct,
            a."yPct" as y_pct,
            a."widthPct" as width_pct,
            a."heightPct" as height_pct,
            a.rotation
        FROM "Thread" t
        JOIN "PdfPlaceableCommentAnchor" a ON t."id" = a."threadId"
        WHERE t."documentId" = $1
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    // For each thread, get all its comments
    for thread_anchor in thread_anchors {
        let comments = sqlx::query!(
            r#"
            SELECT 
                id, 
                owner, 
                text as content, 
                "createdAt" as created_at, 
                "updatedAt" as updated_at,
                "order"
            FROM "Comment" 
            WHERE "threadId" = $1
            ORDER BY "order"
            "#,
            thread_anchor.thread_id
        )
        .fetch_all(db)
        .await?;

        // Convert database comments to model Comments
        let comment_models = comments
            .into_iter()
            .map(|c| Comment {
                sender: c.owner,
                content: c.content,
                id: c.id.to_string(),
                edit_date: c.updated_at.and_utc(), // Use the updated timestamp as edit date
            })
            .collect::<Vec<Comment>>();

        // Parse allowable edits from JSON, or use defaults if null or invalid
        let allowable_edits = match thread_anchor.allowable_edits {
            Some(json) => serde_json::from_value(json).unwrap_or(AllowableEdits {
                allow_resize: true,
                allow_translate: true,
                allow_rotate: true,
                allow_delete: true,
                lock_aspect_ratio: false,
            }),
            None => AllowableEdits {
                allow_resize: true,
                allow_translate: true,
                allow_rotate: true,
                allow_delete: true,
                lock_aspect_ratio: false,
            },
        };

        // Create the placeable with Thread payload
        let thread_placeable = Placeable {
            allowable_edits,
            was_edited: thread_anchor.was_edited,
            was_deleted: thread_anchor.was_deleted,
            page_range: vec![thread_anchor.page],
            position: PlaceablePosition {
                x_pct: thread_anchor.x_pct,
                y_pct: thread_anchor.y_pct,
                width_pct: thread_anchor.width_pct,
                height_pct: thread_anchor.height_pct,
                rotation: thread_anchor.rotation,
            },
            should_lock_on_save: thread_anchor.should_lock_on_save,
            original_page: thread_anchor.original_page,
            original_index: thread_anchor.original_index,
            payload: Payload::Thread(Thread {
                head_id: thread_anchor.anchor_uuid.to_string(),
                page: thread_anchor.page,
                comments: comment_models,
                is_resolved: thread_anchor.is_resolved,
            }),
        };

        modification_data.placeables.push(thread_placeable);
    }

    // Now query all highlights
    let highlight_anchors = sqlx::query!(
        r#"
        SELECT 
            a.uuid, 
            a."threadId" as thread_id,
            a.page, 
            a.red, 
            a.green, 
            a.blue, 
            a.alpha,
            a.type as highlight_type, 
            a.text,
            a."pageViewportWidth" as page_viewport_width, 
            a."pageViewportHeight" as page_viewport_height, 
            a."createdAt"::timestamptz as created_at, 
            a."updatedAt"::timestamptz as updated_at
        FROM "PdfHighlightAnchor" a
        WHERE a."documentId" = $1
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    // For each highlight, get its rectangles and thread (if any)
    for highlight_anchor in highlight_anchors {
        // Get highlight rectangles
        let rects = sqlx::query!(
            r#"
            SELECT 
                phr.top,
                phr.left,
                phr.width,
                phr.height
            FROM "PdfHighlightRect" phr 
            WHERE phr."pdfHighlightAnchorId" = $1
            "#,
            highlight_anchor.uuid
        )
        .fetch_all(db)
        .await?;

        let highlight_rects = rects
            .into_iter()
            .map(|r| HighlightRect {
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
            })
            .collect::<Vec<HighlightRect>>();

        // Get associated thread if exists
        let thread_opt = if let Some(thread_id) = highlight_anchor.thread_id {
            let thread_data = sqlx::query!(
                r#"
                SELECT resolved as is_resolved
                FROM "Thread"
                WHERE id = $1
                "#,
                thread_id
            )
            .fetch_one(db)
            .await?;

            // Get comments for this thread
            let comments = sqlx::query!(
                r#"
                SELECT 
                    id, 
                    owner, 
                    text as content, 
                    "createdAt" as created_at, 
                    "updatedAt" as updated_at,
                    "order"
                FROM "Comment" 
                WHERE "threadId" = $1
                ORDER BY "order"
                "#,
                thread_id
            )
            .fetch_all(db)
            .await?;

            // Convert database comments to model Comments
            let comment_models = comments
                .into_iter()
                .map(|c| Comment {
                    sender: c.owner,
                    content: c.content,
                    id: c.id.to_string(),
                    edit_date: c.updated_at.and_utc(), // Use the updated timestamp as edit date
                })
                .collect::<Vec<Comment>>();

            if !comment_models.is_empty() {
                Some(Thread {
                    head_id: highlight_anchor.uuid.to_string(),
                    page: highlight_anchor.page,
                    comments: comment_models,
                    is_resolved: thread_data.is_resolved,
                })
            } else {
                None
            }
        } else {
            None
        };

        // Create the highlight
        let highlight = Highlight {
            page_num: highlight_anchor.page as u32,
            rects: highlight_rects,
            color: Color {
                red: highlight_anchor.red,
                green: highlight_anchor.green,
                blue: highlight_anchor.blue,
                alpha: Some(highlight_anchor.alpha),
            },
            highlight_type: HighlightType::from(highlight_anchor.highlight_type),
            thread: thread_opt,
            text: highlight_anchor.text,
            page_viewport: if highlight_anchor.page_viewport_width > 0.0
                && highlight_anchor.page_viewport_height > 0.0
            {
                Some(WH {
                    width: highlight_anchor.page_viewport_width,
                    height: highlight_anchor.page_viewport_height,
                })
            } else {
                None
            },
            has_temp_thread: None,
            uuid: Some(highlight_anchor.uuid.to_string()),
        };

        // Add highlight to the appropriate page in the hashmap
        let page_num = highlight.page_num;
        modification_data
            .highlights
            .as_mut()
            .unwrap()
            .entry(page_num)
            .or_insert_with(Vec::new)
            .push(highlight);
    }

    Ok(modification_data)
}

#[cfg(test)]
mod build_pdf_modification_data_tests {
    use super::*;
    use model::annotations::HighlightType;
    use model::document::modification_data::{HighlightRect, Payload, PdfModificationData};
    use sqlx::{Pool, Postgres};
    use std::collections::HashMap;

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_get_complete_pdf_modification_data(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Retrieve modification data for the document with comments
        let modification_data =
            get_complete_pdf_modification_data(&pool, "document-with-comments", None).await?;

        // Verify placeables (threads)
        assert_eq!(
            modification_data.placeables.len(),
            3,
            "Should retrieve all 3 threads as placeables"
        );

        // Verify all threads have Thread payloads
        for placeable in &modification_data.placeables {
            match &placeable.payload {
                Payload::Thread(thread) => {
                    // Each thread should have at least one comment
                    assert!(!thread.comments.is_empty(), "Thread should have comments");

                    // Check that thread head_id is a valid UUID string
                    assert!(
                        sqlx::types::Uuid::try_parse(&thread.head_id).is_ok(),
                        "Thread head_id should be a valid UUID"
                    );
                }
                _ => panic!("Expected Thread payload"),
            }
        }

        // Verify highlight data exists
        assert!(
            modification_data.highlights.is_some(),
            "Highlights map should be present"
        );

        // Check if we have highlights for at least one page
        if let Some(highlights) = &modification_data.highlights {
            assert!(
                !highlights.is_empty(),
                "Should have highlights for at least one page"
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_threads_match_placeables(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Get all threads from the database
        let threads = sqlx::query!(
            r#"
            SELECT t.id, t.resolved, t."documentId"
            FROM "Thread" t
            WHERE t."documentId" = 'document-with-comments'
            "#
        )
        .fetch_all(&pool)
        .await?;

        // Get all comment anchors
        let anchors = sqlx::query!(
            r#"
            SELECT pa."threadId", pa.uuid, pa.page, pa."originalPage", pa."originalIndex"
            FROM "PdfPlaceableCommentAnchor" pa
            JOIN "Thread" t ON pa."threadId" = t.id
            WHERE t."documentId" = 'document-with-comments'
            "#
        )
        .fetch_all(&pool)
        .await?;

        // Create a map of thread_id -> anchor
        let mut thread_anchors = HashMap::new();
        for anchor in anchors {
            thread_anchors.insert(anchor.threadId, anchor);
        }

        // Retrieve modification data
        let modification_data =
            get_complete_pdf_modification_data(&pool, "document-with-comments", None).await?;

        let thread_placeables = modification_data.placeables.iter().filter_map(|p| {
            if let Payload::Thread(thread) = &p.payload {
                Some(thread)
            } else {
                None
            }
        });

        // Check that the number of placeables matches the number of threads
        assert_eq!(
            thread_placeables.count(),
            thread_anchors.len(),
            "Number of thread placeables should match number of free comment threads"
        );

        // For each thread, verify there is a matching placeable with the correct data
        for thread in threads {
            let anchor = thread_anchors.get(&thread.id);
            if anchor.is_none() {
                continue;
            }
            let anchor = anchor.unwrap();

            // Find the matching placeable
            let placeable = modification_data.placeables.iter().find(|p| {
                if let Payload::Thread(_thread_data) = &p.payload {
                    p.original_page == anchor.originalPage
                        && p.original_index == anchor.originalIndex
                } else {
                    false
                }
            });

            assert!(
                placeable.is_some(),
                "Should find a placeable for thread {} at page {} index {}",
                thread.id,
                anchor.originalPage,
                anchor.originalIndex
            );

            // Verify thread data
            if let Payload::Thread(thread_data) = &placeable.unwrap().payload {
                assert_eq!(
                    thread_data.is_resolved, thread.resolved,
                    "Thread resolved status should match"
                );
                assert_eq!(thread_data.page, anchor.page, "Thread page should match");
                assert_eq!(
                    thread_data.head_id,
                    anchor.uuid.to_string(),
                    "Thread head_id should match anchor uuid"
                );
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_highlights_match_database(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Get all highlights from the database
        let highlights = sqlx::query!(
            r#"
            SELECT 
                ha.uuid, ha.page, ha.red, ha.green, ha.blue, ha.alpha,
                ha.type as highlight_type, ha.text, ha."threadId"
            FROM "PdfHighlightAnchor" ha
            WHERE ha."documentId" = 'document-with-comments'
            "#
        )
        .fetch_all(&pool)
        .await?;

        // Get all highlight rectangles
        let highlight_rects = sqlx::query!(
            r#"
            SELECT 
                hr."pdfHighlightAnchorId", hr.top, hr.left, hr.width, hr.height
            FROM "PdfHighlightRect" hr
            JOIN "PdfHighlightAnchor" ha ON hr."pdfHighlightAnchorId" = ha.uuid
            WHERE ha."documentId" = 'document-with-comments'
            "#
        )
        .fetch_all(&pool)
        .await?;

        // Create a map of highlight_id -> vec of rects
        let mut highlight_to_rects: HashMap<sqlx::types::Uuid, Vec<HighlightRect>> = HashMap::new();
        for rect in highlight_rects {
            highlight_to_rects
                .entry(rect.pdfHighlightAnchorId)
                .or_insert_with(Vec::new)
                .push(HighlightRect {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                });
        }

        // Retrieve modification data
        let modification_data =
            get_complete_pdf_modification_data(&pool, "document-with-comments", None).await?;

        // Verify highlights are present
        assert!(
            modification_data.highlights.is_some(),
            "Highlights should be present in modification data"
        );

        let highlights_map = modification_data.highlights.unwrap();

        // Count total highlights across all pages
        let total_retrieved_highlights: usize = highlights_map.values().map(|v| v.len()).sum();
        assert_eq!(
            total_retrieved_highlights,
            highlights.len(),
            "Total number of highlights should match"
        );

        // For each highlight in the database, verify it exists in the returned data
        for db_highlight in highlights {
            // Find the highlight in the retrieved data
            let page_num = db_highlight.page as u32;
            let page_highlights = highlights_map.get(&page_num);

            assert!(
                page_highlights.is_some(),
                "Should have highlights for page {}",
                page_num
            );

            let page_highlights = page_highlights.unwrap();

            // Find matching highlight by UUID
            let highlight = page_highlights.iter().find(|h| {
                h.uuid
                    .as_ref()
                    .map(|uuid| uuid.to_string() == db_highlight.uuid.to_string())
                    .unwrap_or(false)
            });

            assert!(
                highlight.is_some(),
                "Should find highlight with UUID {}",
                db_highlight.uuid
            );

            let highlight = highlight.unwrap();

            // Verify highlight properties
            assert_eq!(highlight.page_num, page_num);
            assert_eq!(highlight.color.red, db_highlight.red);
            assert_eq!(highlight.color.green, db_highlight.green);
            assert_eq!(highlight.color.blue, db_highlight.blue);
            assert_eq!(highlight.color.alpha.unwrap(), db_highlight.alpha);
            assert_eq!(
                highlight.highlight_type,
                HighlightType::try_from(db_highlight.highlight_type).unwrap()
            );
            assert_eq!(highlight.text, db_highlight.text);

            // Verify rects match
            let empty_rects = vec![];
            let db_rects = highlight_to_rects
                .get(&db_highlight.uuid)
                .unwrap_or(&empty_rects);
            assert_eq!(
                highlight.rects.len(),
                db_rects.len(),
                "Number of rectangles should match"
            );

            // If highlight has a thread, verify thread data is present
            if let Some(_thread_id) = db_highlight.threadId {
                assert!(
                    highlight.thread.is_some(),
                    "Highlight should have thread data"
                );
            } else {
                assert!(
                    highlight.thread.is_none(),
                    "Highlight should not have thread data"
                );
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_pdf_modification_data_json(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let modification_data =
            get_complete_pdf_modification_data(&pool, "document-with-comments", None).await?;

        // Get modification data as JSON
        let json_data = serde_json::to_value(&modification_data)?;

        // Verify it's a valid JSON object
        assert!(json_data.is_object(), "JSON data should be an object");

        // Verify key properties exist
        assert!(
            json_data.get("placeables").is_some(),
            "Should have placeables key"
        );
        assert!(
            json_data.get("highlights").is_some(),
            "Should have highlights key"
        );

        // Deserialize back to PdfModificationData to verify structure
        let _deserialized: PdfModificationData = serde_json::from_value(json_data.clone())?;

        // Check all placeable items are correct type
        let placeables = json_data.get("placeables").unwrap().as_array().unwrap();
        for placeable in placeables {
            assert!(
                placeable.get("payloadType").is_some() && placeable.get("payload").is_some(),
                "Each placeable should have payloadType and payload"
            );

            let payload_type = placeable.get("payloadType").unwrap().as_str().unwrap();
            assert_eq!(
                payload_type, "thread",
                "Each placeable should be of type 'thread'"
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_empty_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Create a test document with no comments or highlights
        let document_id = "empty-test-document";

        sqlx::query!(
            r#"
            INSERT INTO "Document" (id, name, owner, "fileType")
            VALUES ($1, 'Empty Test Document', 'macro|user@user.com', 'pdf')
            "#,
            document_id,
        )
        .execute(&pool)
        .await?;

        // Get modification data for empty document
        let modification_data =
            get_complete_pdf_modification_data(&pool, document_id, None).await?;

        // Verify we get empty but properly structured data
        assert!(
            modification_data.placeables.is_empty(),
            "Should have no placeables"
        );
        assert!(
            modification_data.highlights.is_some()
                && modification_data.highlights.unwrap().is_empty(),
            "Should have empty highlights map"
        );

        Ok(())
    }
}
