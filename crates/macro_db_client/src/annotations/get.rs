use model::annotations::{
    PdfAnchor, PdfHighlightAnchor, PdfHighlightRect, PdfPlaceableCommentAnchor,
};
use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

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
        JOIN comms_message_threads t ON pa."threadId" = t.root_id
        WHERE pa."documentId" = $1
        AND t.deleted_at IS NULL
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
        LEFT JOIN comms_message_threads t ON ph."threadId" = t.root_id
        WHERE ph."documentId" = $1
        AND ph."deletedAt" IS NULL
        AND t.deleted_at IS NULL
        GROUP BY ph.uuid, ph.owner, ph."threadId", ph.page, ph.red, ph.green, ph.blue, ph.alpha, ph.type, ph.text, ph."pageViewportWidth", ph."pageViewportHeight", ph."createdAt", ph."updatedAt", ph."deletedAt"
        "#,
        document_id
    )
    .fetch_all(db)
    .await
}
