use anyhow::Result;
use model::annotations::create::{
    CreateUnthreadedAnchorRequest, CreateUnthreadedAnchorResponse,
    CreateUnthreadedPdfAnchorRequest, PdfHighlightAnchorRequest,
};
use model::annotations::{Anchor, PdfAnchor, PdfHighlightAnchor, PdfHighlightRect};
use sqlx::{Pool, Postgres, Transaction, query_as, query_scalar};
use uuid::Uuid;

#[cfg(test)]
mod test;

pub async fn create_unthreaded_anchor(
    db: &Pool<Postgres>,
    owner: &str,
    document_id: &str,
    req: CreateUnthreadedAnchorRequest,
) -> Result<CreateUnthreadedAnchorResponse> {
    let mut transaction = db.begin().await?;
    match req {
        CreateUnthreadedAnchorRequest::Pdf(anchor) => match anchor {
            CreateUnthreadedPdfAnchorRequest::Highlight(anchor) => {
                let anchor =
                    create_pdf_highlight_anchor(&mut transaction, owner, document_id, &anchor)
                        .await?;
                transaction.commit().await?;
                Ok(CreateUnthreadedAnchorResponse {
                    document_id: document_id.to_string(),
                    anchor: Anchor::Pdf(PdfAnchor::Highlight(anchor)),
                })
            }
        },
    }
}

async fn create_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    owner: &str,
    document_id: &str,
    anchor: &PdfHighlightAnchorRequest,
) -> Result<PdfHighlightAnchor> {
    let anchor_uuid = query_scalar!(
        r#"
        INSERT INTO "PdfHighlightAnchor" (
            "uuid", "documentId", "owner", "threadId", "page", "red", "green", "blue", 
            "alpha", "type", "text", "pageViewportWidth", "pageViewportHeight"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING uuid
        "#,
        anchor.uuid.unwrap_or(Uuid::new_v4()),
        document_id,
        owner,
        None::<Uuid>,
        anchor.page,
        anchor.red,
        anchor.green,
        anchor.blue,
        anchor.alpha,
        anchor.highlight_type as i32,
        anchor.text,
        anchor.page_viewport_width,
        anchor.page_viewport_height
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let mut anchor_ids = Vec::new();
    let mut top_values = Vec::new();
    let mut left_values = Vec::new();
    let mut width_values = Vec::new();
    let mut height_values = Vec::new();

    for rect in &anchor.highlight_rects {
        anchor_ids.push(anchor_uuid);
        top_values.push(rect.top);
        left_values.push(rect.left);
        width_values.push(rect.width);
        height_values.push(rect.height);
    }

    // Execute bulk insert using UNNEST
    sqlx::query!(
        r#"
    INSERT INTO "PdfHighlightRect" ("pdfHighlightAnchorId", "top", "left", "width", "height")
    SELECT *
    FROM UNNEST(
        $1::uuid[], 
        $2::double precision[], 
        $3::double precision[], 
        $4::double precision[], 
        $5::double precision[]
    )
    "#,
        &anchor_ids,
        &top_values,
        &left_values,
        &width_values,
        &height_values,
    )
    .execute(transaction.as_mut())
    .await?;

    let inserted_anchor = query_as!(
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
        WHERE ph.uuid = $1
        GROUP BY ph.uuid, ph.owner, ph."threadId", ph.page, ph.red, ph.green, ph.blue, ph.alpha, ph.type, ph.text, ph."pageViewportWidth", ph."pageViewportHeight", ph."createdAt", ph."updatedAt", ph."deletedAt"
        "#,
        anchor_uuid
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(inserted_anchor)
}
