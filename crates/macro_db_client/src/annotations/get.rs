use std::collections::HashMap;

use model::annotations::{
    Comment, CommentThread, PdfAnchor, PdfHighlightAnchor, PdfHighlightRect,
    PdfPlaceableCommentAnchor, Thread,
};
use sqlx::{Pool, Postgres};

// TODO: make this more efficient by joining
pub async fn get_comment_thread(
    db: &Pool<Postgres>,
    thread_id: i64,
) -> Result<Option<CommentThread>, sqlx::Error> {
    let maybe_thread = sqlx::query_as!(
        Thread,
        r#"
        SELECT 
            t.id as thread_id, 
            t.resolved, 
            t."documentId" as document_id, 
            t."createdAt"::timestamptz as created_at, 
            t."updatedAt"::timestamptz as updated_at, 
            t."deletedAt"::timestamptz as deleted_at, 
            t.metadata, 
            t.owner
        FROM "Thread" t
        WHERE t."id" = $1
            AND t."deletedAt" IS NULL
        "#,
        thread_id
    )
    .fetch_optional(db)
    .await?;

    if maybe_thread.is_none() {
        return Ok(None);
    }
    let thread = maybe_thread.unwrap();

    let comments = sqlx::query_as!(
        Comment,
        r#"
        SELECT 
            c.id as comment_id, 
            c."threadId" as thread_id, 
            c.owner, 
            c.sender, 
            c.text, 
            c.metadata, 
            c."createdAt"::timestamptz as created_at, 
            c."updatedAt"::timestamptz as updated_at, 
            c."deletedAt"::timestamptz as deleted_at, 
            c.order
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        WHERE c."threadId" = $1
            AND c."deletedAt" IS NULL
            AND t."deletedAt" IS NULL
        ORDER BY c."createdAt" ASC 
        "#,
        thread_id
    )
    .fetch_all(db)
    .await?;

    Ok(Some(CommentThread { thread, comments }))
}

pub async fn get_document_comments(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Vec<CommentThread>, anyhow::Error> {
    let threads = sqlx::query_as!(
        Thread,
        r#"
        SELECT 
            t.id as thread_id, 
            t.resolved, 
            t."documentId" as document_id, 
            t."createdAt"::timestamptz as created_at, 
            t."updatedAt"::timestamptz as updated_at, 
            t."deletedAt"::timestamptz as deleted_at, 
            t.metadata, 
            t.owner
        FROM "Thread" t
        WHERE t."documentId" = $1 AND t."deletedAt" IS NULL
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    let comments = sqlx::query_as!(
        Comment,
        r#"
        SELECT 
            c.id as comment_id, 
            c."threadId" as thread_id, 
            c.owner, 
            c.sender, 
            c.text, 
            c.metadata, 
            c."createdAt"::timestamptz as created_at, 
            c."updatedAt"::timestamptz as updated_at, 
            c."deletedAt"::timestamptz as deleted_at, 
            c.order
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        WHERE t."documentId" = $1 AND t."deletedAt" IS NULL AND c."deletedAt" IS NULL
        ORDER BY c."createdAt" ASC
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    // Organize comments by thread_id using HashMap for O(1) lookup
    let mut comments_by_thread: HashMap<i64, Vec<Comment>> = HashMap::new();
    for comment in comments {
        comments_by_thread
            .entry(comment.thread_id)
            .or_default()
            .push(comment);
    }

    let comment_threads = threads
        .into_iter()
        .map(|thread| {
            let thread_comments = comments_by_thread
                .remove(&thread.thread_id)
                .unwrap_or_default();

            CommentThread {
                thread,
                comments: thread_comments,
            }
        })
        .collect();

    Ok(comment_threads)
}

pub async fn get_pdf_anchors(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Vec<PdfAnchor>, anyhow::Error> {
    let placeables = fetch_pdf_placeable_anchors(db, document_id);
    let highlights = fetch_pdf_highlight_anchors(db, document_id);

    let (placeables, highlights) = futures::future::join(placeables, highlights).await;

    match (placeables, highlights) {
        (Ok(placeables), Ok(highlights)) => {
            let anchors: Vec<PdfAnchor> = placeables
                .into_iter()
                .map(PdfAnchor::Placeable)
                .chain(highlights.into_iter().map(PdfAnchor::Highlight))
                .collect();

            Ok(anchors)
        }
        (Err(e1), Ok(_)) => Err(anyhow::anyhow!("failed to fetch placeables: {}", e1)),
        (Ok(_), Err(e2)) => Err(anyhow::anyhow!("failed to fetch highlights: {}", e2)),
        (Err(e1), Err(e2)) => Err(anyhow::anyhow!(
            "failed to fetch both placeables and highlights: placeables error: {}, highlights error: {}",
            e1,
            e2
        )),
    }
}

pub async fn fetch_pdf_placeable_anchors(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Vec<PdfPlaceableCommentAnchor>, sqlx::Error> {
    sqlx::query_as!(
        PdfPlaceableCommentAnchor,
        r#"
        SELECT 
            pa.uuid, 
            pa."documentId" as document_id, 
            pa.owner, 
            pa."threadId" as thread_id, 
            pa.page, 
            pa."originalPage" as original_page, 
            pa."originalIndex" as original_index, 
            pa."xPct" as x_pct, 
            pa."yPct" as y_pct, 
            pa."widthPct" as width_pct, 
            pa."heightPct" as height_pct,
            pa.rotation, 
            pa."allowableEdits" as allowable_edits,
            pa."wasEdited" as was_edited,
            pa."wasDeleted" as was_deleted,
            pa."shouldLockOnSave" as should_lock_on_save
        FROM "PdfPlaceableCommentAnchor" pa
        JOIN "Thread" t ON pa."threadId" = t.id
        WHERE pa."documentId" = $1
        AND t."deletedAt" IS NULL
        "#,
        document_id
    )
    .fetch_all(db)
    .await
}

pub async fn fetch_pdf_highlight_anchors(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Vec<PdfHighlightAnchor>, sqlx::Error> {
    sqlx::query_as!(
        PdfHighlightAnchor,
        r#"
        SELECT 
            ph.uuid, 
            ph."documentId" as document_id,
            ph.owner, 
            ph."threadId" as thread_id, 
            ph.page, 
            ph.red,
            ph.green, 
            ph.blue, 
            ph.alpha, 
            ph.type as highlight_type, 
            ph.text, 
            ph."pageViewportWidth" as page_viewport_width, 
            ph."pageViewportHeight" as page_viewport_height, 
            ph."createdAt"::timestamptz as created_at, 
            ph."updatedAt"::timestamptz as updated_at, 
            ph."deletedAt"::timestamptz as deleted_at, 
            array_agg((phr.id, phr.top, phr.left, phr.width, phr.height)) as "highlight_rects!: Vec<PdfHighlightRect>"
        FROM "PdfHighlightAnchor" ph
        JOIN "PdfHighlightRect" phr ON ph.uuid = phr."pdfHighlightAnchorId"
        LEFT JOIN "Thread" t ON ph."threadId" = t.id
        WHERE ph."documentId" = $1
        AND ph."deletedAt" IS NULL
        AND t."deletedAt" IS NULL
        GROUP BY ph.uuid, ph.owner, ph."threadId", ph.page, ph.red, ph.green, ph.blue, ph.alpha, ph.type, ph.text, ph."pageViewportWidth", ph."pageViewportHeight", ph."createdAt", ph."updatedAt", ph."deletedAt"
        "#,
        document_id
    )
    .fetch_all(db)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres, types::Uuid};
    use std::collections::HashMap;

    // Test fetching highlights for a document with highlights and placeables
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_all_pdf_anchors(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Fetch highlights for "document-with-comments" (which has 3 highlights)
        let anchors = get_pdf_anchors(&pool, "document-with-comments").await?;

        // Verify we got the correct number of highlights
        assert_eq!(anchors.len(), 6);

        let placeables = anchors
            .iter()
            .filter_map(|a| match a {
                PdfAnchor::Placeable(p) => Some(p),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(placeables.len(), 3);

        let highlights = anchors
            .iter()
            .filter_map(|a| match a {
                PdfAnchor::Highlight(h) => Some(h),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(highlights.len(), 3);

        Ok(())
    }

    // Test fetching highlights for a document with highlights
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_highlights(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Fetch highlights for "document-with-comments" (which has 3 highlights)
        let highlights = fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;

        // Verify we got the correct number of highlights
        assert_eq!(highlights.len(), 3);

        // Map highlights by UUID for easier testing
        let highlight_map: HashMap<Uuid, &PdfHighlightAnchor> =
            highlights.iter().map(|h| (h.uuid.clone(), h)).collect();

        // Check first highlight properties (on page 1, red color, 2 rectangles)
        let highlight_1 = highlight_map
            .get(&Uuid::try_parse("11111111-1111-1111-1111-111111111111").unwrap())
            .expect("Highlight 1 should exist");
        assert_eq!(highlight_1.page, 1);
        assert_eq!(highlight_1.text, "Highlighted text on page 1");
        assert_eq!(highlight_1.red, 255);
        assert_eq!(highlight_1.green, 0);
        assert_eq!(highlight_1.blue, 0);
        assert_eq!(highlight_1.alpha, 0.8);
        assert_eq!(highlight_1.highlight_rects.len(), 2);
        assert_eq!(highlight_1.highlight_rects[0].top, 100.0);
        assert_eq!(highlight_1.highlight_rects[0].left, 50.0);
        assert_eq!(highlight_1.highlight_rects[0].width, 200.0);
        assert_eq!(highlight_1.highlight_rects[0].height, 50.0);

        // Check second highlight properties (on page 2, green color, 1 rectangle)
        let highlight_2 = highlight_map
            .get(&Uuid::try_parse("22222222-2222-2222-2222-222222222222").unwrap())
            .expect("Highlight 2 should exist");
        assert_eq!(highlight_2.page, 2);
        assert_eq!(highlight_2.text, "Another highlight on page 2");
        assert_eq!(highlight_2.red, 0);
        assert_eq!(highlight_2.green, 255);
        assert_eq!(highlight_2.blue, 0);
        assert_eq!(highlight_2.alpha, 0.7);
        assert_eq!(highlight_2.highlight_rects.len(), 1);

        // Check third highlight properties (on page 3, blue color, 3 rectangles)
        let highlight_3 = highlight_map
            .get(&Uuid::try_parse("33333333-3333-3333-3333-333333333333").unwrap())
            .expect("Highlight 3 should exist");
        assert_eq!(highlight_3.page, 3);
        assert_eq!(highlight_3.text, "Last highlight on page 3");
        assert_eq!(highlight_3.red, 0);
        assert_eq!(highlight_3.green, 0);
        assert_eq!(highlight_3.blue, 255);
        assert_eq!(highlight_3.alpha, 0.6);
        assert_eq!(highlight_3.highlight_rects.len(), 3);

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_highlight_deletion_based_on_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Fetch highlights before deletion
        let highlights_before =
            fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;
        assert_eq!(
            highlights_before.len(),
            3,
            "Expected 3 highlights before deletion"
        );

        let highlight_uuid_with_thread = highlights_before
            .iter()
            .find(|h| h.thread_id.is_some() && h.thread_id.unwrap() == 1002)
            .expect("There should be at one highlight with a thread")
            .uuid
            .clone();
        assert_eq!(
            highlight_uuid_with_thread.to_string(),
            "22222222-2222-2222-2222-222222222222"
        );

        // Find a highlight without a thread (should not be deleted)
        let highlight_without_thread = highlights_before
            .iter()
            .find(|h| h.thread_id.is_none())
            .expect("There should be at one highlight without a thread");

        let highlight_uuid_without_thread = highlight_without_thread.uuid.clone();
        assert_eq!(
            highlight_without_thread.uuid.to_string(),
            "33333333-3333-3333-3333-333333333333"
        );

        // Delete the thread associated with the highlight
        sqlx::query!(
            r#"
            UPDATE "Thread"
            SET "deletedAt" = NOW()
            WHERE "id" = $1
            "#,
            1002
        )
        .execute(&pool)
        .await?;

        // Fetch highlights again
        let highlights_after = fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;

        // Verify the highlight with a deleted thread is no longer in the results
        assert!(
            !highlights_after
                .iter()
                .any(|h| h.uuid == highlight_uuid_with_thread),
            "Highlight with a deleted thread should also be deleted"
        );

        // Verify the highlight without a thread is still present
        assert!(
            highlights_after
                .iter()
                .any(|h| h.uuid == highlight_uuid_without_thread),
            "Highlight without a thread should still exist"
        );

        Ok(())
    }

    // Test for a document with no highlights
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_highlights_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Fetch highlights for a document with no highlights
        let highlights = fetch_pdf_highlight_anchors(&pool, "non-existent-document").await?;

        // Verify we got an empty list
        assert_eq!(highlights.len(), 0);

        Ok(())
    }

    // Test filtering out deleted highlights
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_highlights_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Verify we have 3 highlights initially
        let highlights_before =
            fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;
        assert_eq!(highlights_before.len(), 3);

        // Now mark one highlight as deleted
        sqlx::query!(
            r#"
        UPDATE "PdfHighlightAnchor"
        SET "deletedAt" = NOW()
        WHERE "uuid" = '11111111-1111-1111-1111-111111111111'
        "#
        )
        .execute(&pool)
        .await?;

        // Fetch highlights again
        let highlights_after = fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;

        // Verify only 2 highlights remain
        assert_eq!(highlights_after.len(), 2);

        // Ensure 11111111-1111-1111-1111-111111111111 is removed
        let remaining_uuids: Vec<String> = highlights_after
            .iter()
            .map(|h| h.uuid.to_string())
            .collect();
        assert!(!remaining_uuids.contains(&"11111111-1111-1111-1111-111111111111".to_string()));
        assert!(remaining_uuids.contains(&"22222222-2222-2222-2222-222222222222".to_string()));
        assert!(remaining_uuids.contains(&"33333333-3333-3333-3333-333333333333".to_string()));

        Ok(())
    }

    // Test filtering out deleted highlight rectangles but keeping the anchor
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_highlight_rects_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Fetch highlights before deletion
        let highlights_before =
            fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;
        let highlight_1_before = highlights_before
            .iter()
            .find(|h| h.uuid.to_string() == "11111111-1111-1111-1111-111111111111")
            .expect("Highlight 1 should exist");

        assert_eq!(highlight_1_before.highlight_rects.len(), 2);

        // Now mark one highlight rectangle as deleted
        sqlx::query!(
            r#"
        DELETE FROM "PdfHighlightRect"
        WHERE "id" = 1
        "#
        )
        .execute(&pool)
        .await?;

        // Fetch highlights again
        let highlights_after = fetch_pdf_highlight_anchors(&pool, "document-with-comments").await?;
        let highlight_1_after = highlights_after
            .iter()
            .find(|h| h.uuid.to_string() == "11111111-1111-1111-1111-111111111111")
            .expect("Highlight 1 should still exist");

        // Verify the highlight anchor still exists, but one rectangle was removed
        assert_eq!(highlight_1_after.highlight_rects.len(), 1);
        assert_eq!(highlight_1_after.highlight_rects[0].id, 2);

        Ok(())
    }

    // Test fetching comments for a document
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_document_comments(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Test fetching comments for document-with-comments (which has 3 threads and 7 comments)
        let comment_threads = get_document_comments(&pool, "document-with-comments").await?;

        // Verify we got all threads
        assert_eq!(comment_threads.len(), 4);

        // Map threads by ID for easier testing
        let thread_map: std::collections::HashMap<i64, &CommentThread> = comment_threads
            .iter()
            .map(|t| (t.thread.thread_id.clone(), t))
            .collect();

        // Check thread 1001 (unresolved with 3 comments)
        let thread_1001 = thread_map.get(&1001).expect("Thread 1001 should exist");
        assert_eq!(thread_1001.comments.len(), 3);
        assert_eq!(thread_1001.thread.resolved, false);

        // Check thread 1002 (resolved with 3 comments)
        let thread_1002 = thread_map.get(&1002).expect("Thread 1002 should exist");
        assert_eq!(thread_1002.comments.len(), 3);
        assert_eq!(thread_1002.thread.resolved, true);

        // Check thread 1003 (unresolved with 1 comment)
        let thread_1003 = thread_map.get(&1003).expect("Thread 1003 should exist");
        assert_eq!(thread_1003.comments.len(), 1);
        assert_eq!(thread_1003.thread.resolved, false);

        // Check specific comment content for thread 1001
        let first_comment = &thread_1001.comments[0];
        assert_eq!(first_comment.text, "Initial question on page 1");
        assert_eq!(first_comment.sender, Some("user@user.com".to_string()));

        Ok(())
    }

    // Test for a document with no comments
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_document_comments_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // This document ID doesn't exist in our fixture, so should return empty results
        let comment_threads = get_document_comments(&pool, "non-existent-document").await?;

        // Verify we got an empty list
        assert_eq!(comment_threads.len(), 0);

        Ok(())
    }

    // Test fetching PDF placeable anchors
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_placeable_anchors(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Test fetching anchors for document-with-comments (which has 3 anchors)
        let anchors = fetch_pdf_placeable_anchors(&pool, "document-with-comments").await?;

        // Verify we got all 3 anchors
        assert_eq!(anchors.len(), 3);

        let anchor_uuids: Vec<String> = anchors.iter().map(|a| a.uuid.to_string()).collect();

        // Map anchors by UUID for easier testing
        let anchor_map: std::collections::HashMap<String, &PdfPlaceableCommentAnchor> =
            anchors.iter().map(|a| (a.uuid.to_string(), a)).collect();

        // Check first anchor properties
        let anchor_1 = anchor_map
            .get(anchor_uuids[0].as_str())
            .expect("Anchor 1 should exist");
        assert_eq!(anchor_1.page, 1);
        assert_eq!(anchor_1.x_pct, 0.2);
        assert_eq!(anchor_1.y_pct, 0.3);
        assert_eq!(anchor_1.width_pct, 0.1);
        assert_eq!(anchor_1.height_pct, 0.05);
        assert_eq!(anchor_1.thread_id, 1001);
        assert_eq!(anchor_1.was_edited, false);
        assert_eq!(anchor_1.should_lock_on_save, true);

        // Check second anchor properties
        let anchor_2 = anchor_map
            .get(anchor_uuids[1].as_str())
            .expect("Anchor 2 should exist");
        assert_eq!(anchor_2.page, 2);
        assert_eq!(anchor_2.should_lock_on_save, false);

        // Check third anchor which has been edited
        let anchor_3 = anchor_map
            .get(anchor_uuids[2].as_str())
            .expect("Anchor 3 should exist");
        assert_eq!(anchor_3.was_edited, true);

        Ok(())
    }

    // Test for a document with no anchors
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_fetch_pdf_placeable_anchors_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // This document ID doesn't exist in our fixture, so should return empty results
        let anchors = fetch_pdf_placeable_anchors(&pool, "non-existent-document").await?;

        // Verify we got an empty list
        assert_eq!(anchors.len(), 0);

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_thread_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // First verify we have 2 threads in document-delete-test
        let threads_before = get_document_comments(&pool, "document-delete-test").await?;
        assert_eq!(threads_before.len(), 2);

        // Now mark one thread as deleted
        sqlx::query!(
            r#"
        UPDATE "Thread"
        SET "deletedAt" = NOW()
        WHERE "id" = 3001
        "#
        )
        .execute(&pool)
        .await?;

        // Fetch comments again - if our implementation filters deleted threads
        // we should only get 1 thread back now
        let threads_after = get_document_comments(&pool, "document-delete-test").await?;

        // Verify only one thread remains and it's the correct one
        assert_eq!(threads_after.len(), 1);
        assert_eq!(threads_after[0].thread.thread_id, 3002);

        // Also verify that the anchors for deleted threads are not returned
        let placeable_anchors_after =
            fetch_pdf_placeable_anchors(&pool, "document-delete-test").await?;
        assert_eq!(placeable_anchors_after.len(), 1);

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_comment_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // First verify thread 1001 has 3 comments
        let threads_before = get_document_comments(&pool, "document-with-comments").await?;
        let thread_1001_before = threads_before
            .iter()
            .find(|t| t.thread.thread_id == 1001)
            .expect("Thread 1001 should exist");
        assert_eq!(thread_1001_before.comments.len(), 3);

        // Now mark one comment as deleted
        sqlx::query!(
            r#"
        UPDATE "Comment"
        SET "deletedAt" = NOW()
        WHERE "id" = 10001
        "#
        )
        .execute(&pool)
        .await?;

        // Fetch comments again - if our implementation filters deleted comments
        // we should only get 2 comments in thread 1001 now
        let threads_after = get_document_comments(&pool, "document-with-comments").await?;
        let thread_1001_after = threads_after
            .iter()
            .find(|t| t.thread.thread_id == 1001)
            .expect("Thread 1001 should exist");

        // Verify one comment was filtered out
        assert_eq!(thread_1001_after.comments.len(), 2);

        // Verify the remaining comments are the ones we expect
        let comment_ids: Vec<i64> = thread_1001_after
            .comments
            .iter()
            .map(|c| c.comment_id.clone())
            .collect();
        assert!(comment_ids.contains(&10002));
        assert!(comment_ids.contains(&10003));
        assert!(!comment_ids.contains(&10001));

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_deleted_placeable_anchor_but_active_thread(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // First verify we have 3 anchors for document-with-comments
        let anchors_before = fetch_pdf_placeable_anchors(&pool, "document-with-comments").await?;
        assert_eq!(anchors_before.len(), 3);

        // Mark an anchor as deleted but keep the thread active
        sqlx::query!(
            r#"
        UPDATE "PdfPlaceableCommentAnchor"
        SET "wasDeleted" = TRUE
        WHERE "uuid" = '91111111-1111-1111-1111-111111111111'
        "#
        )
        .execute(&pool)
        .await?;

        // Fetch anchors again
        let anchors_after = fetch_pdf_placeable_anchors(&pool, "document-with-comments").await?;

        // Verify we still have 3 anchors
        assert_eq!(anchors_after.len(), 3);

        // Verify the deleted anchor is still returned
        let anchor_uuids: Vec<String> = anchors_after.iter().map(|a| a.uuid.to_string()).collect();
        assert!(anchor_uuids.contains(&"91111111-1111-1111-1111-111111111111".to_string()));

        // But the thread should still be active and have comments
        let threads = get_document_comments(&pool, "document-with-comments").await?;
        let thread_1001 = threads
            .iter()
            .find(|t| t.thread.thread_id == 1001)
            .expect("Thread 1001 should still exist even with deleted anchor");
        assert_eq!(thread_1001.comments.len(), 3);

        Ok(())
    }
}

#[cfg(test)]
mod get_comment_thread_tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_get_comment_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let thread_id = 1001; // Thread in the fixture with comments

        let maybe_comment_thread = get_comment_thread(&pool, thread_id).await?;
        assert!(maybe_comment_thread.is_some());
        let comment_thread = maybe_comment_thread.unwrap();

        // Check that the thread matches expectations
        assert_eq!(comment_thread.thread.thread_id, thread_id);
        assert_eq!(comment_thread.thread.document_id, "document-with-comments");
        assert_eq!(comment_thread.thread.owner, "macro|user@user.com");
        assert_eq!(comment_thread.thread.resolved, false);
        assert!(comment_thread.thread.deleted_at.is_none());

        // Check that comments were fetched
        assert!(
            !comment_thread.comments.is_empty(),
            "Thread should contain comments"
        );

        // Validate first comment
        let first_comment = &comment_thread.comments[0];
        assert_eq!(first_comment.thread_id, thread_id);
        assert_eq!(first_comment.owner, "macro|user@user.com");
        assert_eq!(first_comment.sender, Some("user@user.com".to_string()));
        assert_eq!(first_comment.text, "Initial question on page 1");
        assert!(first_comment.deleted_at.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_get_comment_thread_with_no_comments(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let thread_id = 1003; // Thread in the fixture with a single comment

        let maybe_comment_thread = get_comment_thread(&pool, thread_id).await?;
        assert!(maybe_comment_thread.is_some());
        let comment_thread = maybe_comment_thread.unwrap();

        assert_eq!(comment_thread.thread.thread_id, thread_id);
        assert_eq!(comment_thread.thread.document_id, "document-with-comments");
        assert_eq!(comment_thread.thread.owner, "macro|user@user.com");
        assert_eq!(comment_thread.thread.resolved, false);
        assert!(comment_thread.thread.deleted_at.is_none());

        // Validate that there's only one comment
        assert_eq!(comment_thread.comments.len(), 1);
        let comment = &comment_thread.comments[0];
        assert_eq!(comment.text, "Feedback on page 3");

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_get_deleted_comments_but_keep_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let thread_id = 1002; // This thread is resolved and has deleted comments

        // delete all the comments in the thread
        sqlx::query!(
            r#"
            UPDATE "Comment"
            SET "deletedAt" = NOW()
            WHERE "threadId" = $1
            "#,
            thread_id
        )
        .execute(&pool)
        .await?;

        let maybe_comment_thread = get_comment_thread(&pool, thread_id).await?;
        assert!(maybe_comment_thread.is_some());
        let comment_thread = maybe_comment_thread.unwrap();

        assert_eq!(comment_thread.thread.thread_id, thread_id);
        assert_eq!(comment_thread.thread.document_id, "document-with-comments");
        assert_eq!(comment_thread.thread.owner, "macro|user@user.com");
        assert_eq!(comment_thread.thread.resolved, true);
        assert!(comment_thread.thread.deleted_at.is_none());

        // Validate no comments since they're deleted
        assert_eq!(comment_thread.comments.len(), 0);

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_get_deleted_thread_is_none(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let thread_id = 1002; // This thread is resolved and has deleted comments

        // delete all the comments in the thread
        sqlx::query!(
            r#"
            UPDATE "Thread"
            SET "deletedAt" = NOW()
            WHERE "id" = $1
            "#,
            thread_id
        )
        .execute(&pool)
        .await?;

        let maybe_comment_thread = get_comment_thread(&pool, thread_id).await?;
        assert!(maybe_comment_thread.is_none());

        Ok(())
    }
}
