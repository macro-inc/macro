use super::{repository_error, stale_capability};
use crate::domain::{
    annotations::{AnnotationMutation, DeletedAnnotation},
    models::MessageParent,
    ports::MessageError,
};
use crate::outbound::pg_message_repo::PgMessageRepository;
use shared_types::annotations::{
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
) -> Result<DeletedAnnotation, MessageError> {
    let thread_id: Option<Uuid>;
    let document_id: String;
    let mut transaction = db.begin().await.map_err(repository_error)?;

    let anchor_info: AnchorId;
    match req {
        DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid)) => {
            (thread_id, document_id) =
                delete_pdf_highlight_anchor(&mut transaction, access, uuid).await?;
            anchor_info = AnchorId::Pdf(PdfAnchorId::Highlight(uuid));
        }
    }

    let thread = if let Some(thread_id) = thread_id {
        let parent = MessageParent::parse("document", &document_id)
            .map_err(|e| MessageError::Repository(rootcause::Report::new(e).into()))?;
        Some(PgMessageRepository::delete_thread_in(&mut transaction, &parent, thread_id).await?)
    } else {
        None
    };

    transaction.commit().await.map_err(repository_error)?;

    Ok(DeletedAnnotation {
        response: DeleteUnthreadedAnchorResponse {
            document_id,
            anchor_info,
            root_id: thread_id,
        },
        thread,
    })
}

async fn delete_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    access: AnnotationMutation,
    uuid: Uuid,
) -> Result<(Option<Uuid>, String), MessageError> {
    if access.target().id != uuid {
        return Err(stale_capability("annotation capability mismatch"));
    }
    let row = sqlx::query!(r#"SELECT root_id AS thread_id, "documentId" AS document_id
        FROM "PdfHighlightAnchor" WHERE uuid = $1 AND "documentId" = $2 AND "deletedAt" IS NULL FOR UPDATE"#,
        uuid, access.target().document_id).fetch_one(transaction.as_mut()).await.map_err(repository_error)?;
    if row.thread_id != access.target().thread_id {
        return Err(stale_capability(
            "annotation discussion changed; retry authorization",
        ));
    }
    sqlx::query!(
        r#"UPDATE "PdfHighlightAnchor" SET "deletedAt" = NOW()
        WHERE uuid = $1 AND "deletedAt" IS NULL"#,
        uuid
    )
    .execute(transaction.as_mut())
    .await
    .map_err(repository_error)?;

    Ok((row.thread_id, row.document_id))
}
