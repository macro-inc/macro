use super::*;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn reads_geometry_with_shared_root_ids_and_unthreaded_highlights(pool: PgPool) {
    let anchors = get_pdf_anchors(&pool, "document-with-comments")
        .await
        .unwrap();
    assert_eq!(anchors.len(), 5);
    let placeables = fetch_pdf_placeable_anchors(&pool, "document-with-comments")
        .await
        .unwrap();
    let first = placeables
        .iter()
        .find(|a| a.thread_id == Uuid::from_u128(1))
        .unwrap();
    assert_eq!((first.page, first.x_pct, first.y_pct), (1, 0.2, 0.3));
    let highlights = fetch_pdf_highlight_anchors(&pool, "document-with-comments")
        .await
        .unwrap();
    assert!(
        highlights
            .iter()
            .any(|h| h.thread_id == Some(Uuid::from_u128(4)))
    );
    assert!(highlights.iter().any(|h| h.thread_id.is_none()));
    assert!(highlights.iter().all(|h| h.highlight_rects.len() == 1));
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn document_without_annotations_is_empty(pool: PgPool) {
    assert!(
        get_pdf_anchors(&pool, "empty-document")
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn pdf_save_flags_do_not_delete_the_discussion(pool: PgPool) {
    sqlx::query!(
        r#"UPDATE "PdfPlaceableCommentAnchor" SET "wasDeleted" = true
        WHERE uuid = '91111111-1111-1111-1111-111111111111'"#
    )
    .execute(&pool)
    .await
    .unwrap();
    let anchors = fetch_pdf_placeable_anchors(&pool, "document-with-comments")
        .await
        .unwrap();
    assert_eq!(anchors.len(), 3);
    assert!(
        anchors
            .iter()
            .find(|a| a.thread_id == Uuid::from_u128(1))
            .unwrap()
            .was_deleted
    );
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_messages
        WHERE (id = $1 OR thread_id = $1) AND deleted_at IS NULL"#,
        Uuid::from_u128(1)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);
}
