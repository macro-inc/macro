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
            t.root_id as thread_id,
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
        FROM comms_message_threads t
        JOIN "PdfPlaceableCommentAnchor" a ON t.root_id = a."threadId"
        WHERE a."documentId" = $1 AND t.deleted_at IS NULL
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    // For each thread, get all its comments
    for thread_anchor in thread_anchors {
        let comments = sqlx::query!(
            r#"
            SELECT id, COALESCE(imported_author, sender_id) AS "owner!", content, created_at, updated_at
                FROM comms_messages WHERE (id = $1 OR thread_id = $1) AND deleted_at IS NULL
                ORDER BY import_order NULLS LAST, created_at, id
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
                edit_date: c.updated_at, // Use the updated timestamp as edit date
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
        WHERE a."documentId" = $1 AND a."deletedAt" IS NULL
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
                FROM comms_message_threads
                WHERE root_id = $1 AND deleted_at IS NULL
                "#,
                thread_id
            )
            .fetch_one(db)
            .await?;

            // Get comments for this thread
            let comments = sqlx::query!(
                r#"
                SELECT id, COALESCE(imported_author, sender_id) AS "owner!", content, created_at, updated_at
                FROM comms_messages WHERE (id = $1 OR thread_id = $1) AND deleted_at IS NULL
                ORDER BY import_order NULLS LAST, created_at, id
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
                    edit_date: c.updated_at, // Use the updated timestamp as edit date
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
mod test;
