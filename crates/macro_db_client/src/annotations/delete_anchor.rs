use anyhow::{Result, ensure};
use messages::domain::annotations::{AnnotationMutation, DeletedAnnotation};
use model::annotations::{
    AnchorId, PdfAnchorId,
    delete::{
        DeleteUnthreadedAnchorRequest, DeleteUnthreadedAnchorResponse,
        DeleteUnthreadedPdfAnchorRequest,
    },
};
use sqlx::{Pool, Postgres, Transaction, types::Uuid};

#[cfg(test)]
mod test;

pub async fn delete_document_anchor(
    db: &Pool<Postgres>,
    access: AnnotationMutation,
    req: DeleteUnthreadedAnchorRequest,
) -> Result<DeletedAnnotation> {
    let thread_id: Option<Uuid>;
    let document_id: String;
    let mut transaction = db.begin().await?;

    let anchor_info: AnchorId;
    match req {
        DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid)) => {
            (thread_id, document_id) =
                delete_pdf_highlight_anchor(&mut transaction, access, uuid).await?;
            anchor_info = AnchorId::Pdf(PdfAnchorId::Highlight(uuid));
        }
    }

    let thread = if let Some(thread_id) = thread_id {
        let parent = messages::domain::models::MessageParent::parse("document", &document_id)?;
        Some(
            messages::outbound::pg_message_repo::PgMessageRepository::delete_thread_in(
                &mut transaction,
                &parent,
                thread_id,
            )
            .await?,
        )
    } else {
        None
    };

    transaction.commit().await?;

    Ok(DeletedAnnotation {
        response: DeleteUnthreadedAnchorResponse {
            document_id,
            anchor_info,
            thread_id,
        },
        thread,
    })
}

async fn delete_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    access: AnnotationMutation,
    uuid: Uuid,
) -> Result<(Option<Uuid>, String)> {
    ensure!(access.target().id == uuid, "annotation capability mismatch");
    let row = sqlx::query!(r#"SELECT "threadId" AS thread_id, "documentId" AS document_id
        FROM "PdfHighlightAnchor" WHERE uuid = $1 AND "documentId" = $2 AND "deletedAt" IS NULL FOR UPDATE"#,
        uuid, access.target().document_id).fetch_one(transaction.as_mut()).await?;
    ensure!(
        row.thread_id == access.target().thread_id,
        "annotation discussion changed; retry authorization"
    );
    sqlx::query!(
        r#"UPDATE "PdfHighlightAnchor" SET "deletedAt" = NOW()
        WHERE uuid = $1 AND "deletedAt" IS NULL"#,
        uuid
    )
    .execute(transaction.as_mut())
    .await?;

    Ok((row.thread_id, row.document_id))
}
