use anyhow::{Result, ensure};
use messages::domain::annotations::AnnotationMutation;
use model::annotations::{
    Anchor, PdfAnchor, PdfPlaceableCommentAnchor,
    edit::{
        EditAnchorRequest, EditAnchorResponse, EditPdfAnchorRequest,
        EditPdfPlaceableCommentAnchorRequest,
    },
};
use sqlx::{Pool, Postgres};

pub async fn edit_document_anchor(
    db: &Pool<Postgres>,
    access: AnnotationMutation,
    req: EditAnchorRequest,
) -> Result<EditAnchorResponse> {
    match req {
        EditAnchorRequest::Pdf(EditPdfAnchorRequest::FreeComment(request)) => {
            let anchor = edit_pdf_free_comment_anchor(db, access, request).await?;
            Ok(EditAnchorResponse {
                document_id: anchor.document_id.clone(),
                anchor: Anchor::Pdf(PdfAnchor::Placeable(anchor)),
            })
        }
    }
}

async fn edit_pdf_free_comment_anchor(
    db: &Pool<Postgres>,
    access: AnnotationMutation,
    request: EditPdfPlaceableCommentAnchorRequest,
) -> Result<PdfPlaceableCommentAnchor> {
    ensure!(
        access.target().id == request.uuid,
        "annotation capability mismatch"
    );
    let anchor = sqlx::query_as!(
        PdfPlaceableCommentAnchor,
        r#"
        UPDATE "PdfPlaceableCommentAnchor" SET
            "page" = COALESCE($1, "page"),
            "originalPage" = COALESCE($2, "originalPage"),
            "originalIndex" = COALESCE($3, "originalIndex"),
            "xPct" = COALESCE($4, "xPct"),
            "yPct" = COALESCE($5, "yPct"),
            "widthPct" = COALESCE($6, "widthPct"),
            "heightPct" = COALESCE($7, "heightPct"),
            "rotation" = COALESCE($8, "rotation"),
            "allowableEdits" = COALESCE($9, "allowableEdits"),
            "wasEdited" = COALESCE($10, "wasEdited"),
            "wasDeleted" = COALESCE($11, "wasDeleted"),
            "shouldLockOnSave" = COALESCE($12, "shouldLockOnSave")
        WHERE uuid = $13 AND "documentId" = $14
        RETURNING 
            uuid, 
            "documentId" as document_id,
            owner, 
            "threadId" as thread_id, 
            page, 
            "originalPage" as original_page, 
            "originalIndex" as original_index, 
            "xPct" as x_pct, 
            "yPct" as y_pct, 
            "widthPct" as width_pct, 
            "heightPct" as height_pct, 
            rotation,
            "allowableEdits" as allowable_edits, 
            "wasEdited" as was_edited, 
            "wasDeleted" as was_deleted, 
            "shouldLockOnSave" as should_lock_on_save
        "#,
        request.page,
        request.original_page,
        request.original_index,
        request.x_pct,
        request.y_pct,
        request.width_pct,
        request.height_pct,
        request.rotation,
        request.allowable_edits,
        request.was_edited,
        request.was_deleted,
        request.should_lock_on_save,
        request.uuid,
        access.target().document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(anchor)
}

#[cfg(test)]
mod test;
