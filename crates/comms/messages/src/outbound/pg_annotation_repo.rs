use crate::domain::{
    annotations::{AnnotationMutation, AnnotationRepository, AnnotationTarget, DeletedAnnotation},
    ports::MessageError,
};
use model::annotations::{
    delete::DeleteUnthreadedAnchorRequest,
    edit::{EditAnchorRequest, EditAnchorResponse},
};
use sqlx::PgPool;
use uuid::Uuid;

mod delete;
mod edit;

/// Authorized PDF geometry persistence for the annotation domain.
pub struct PgAnnotationRepository(pub PgPool);

impl AnnotationRepository for PgAnnotationRepository {
    async fn target(&self, id: Uuid, highlight: bool) -> Result<AnnotationTarget, MessageError> {
        let row = sqlx::query!(r#"
            SELECT a.uuid AS "uuid!", a."documentId" AS "document_id!", a.owner AS "owner!", a.root_id AS "thread_id?", t.user_id AS thread_owner
            FROM "PdfHighlightAnchor" a LEFT JOIN comms_message_threads t ON t.root_id = a.root_id
            WHERE $2 AND a.uuid = $1 AND a."deletedAt" IS NULL
            UNION ALL
            SELECT a.uuid, a."documentId", a.owner, a.root_id, t.user_id
            FROM "PdfPlaceableCommentAnchor" a JOIN comms_message_threads t ON t.root_id = a.root_id
            WHERE NOT $2 AND a.uuid = $1 AND t.deleted_at IS NULL
        "#, id, highlight).fetch_optional(&self.0).await.map_err(repository_error)?.ok_or(MessageError::NotFound)?;
        Ok(AnnotationTarget {
            id: row.uuid,
            document_id: row.document_id,
            owner: row.owner,
            thread_id: row.thread_id,
            thread_owner: row.thread_owner,
        })
    }
    async fn edit(
        &self,
        access: AnnotationMutation,
        input: EditAnchorRequest,
    ) -> Result<EditAnchorResponse, MessageError> {
        edit::edit_document_anchor(&self.0, access, input).await
    }
    async fn delete(
        &self,
        access: AnnotationMutation,
        input: DeleteUnthreadedAnchorRequest,
    ) -> Result<DeletedAnnotation, MessageError> {
        delete::delete_document_anchor(&self.0, access, input).await
    }
}

fn repository_error(error: sqlx::Error) -> MessageError {
    MessageError::Repository(rootcause::Report::new(error).into())
}

/// A capability that no longer matches the stored annotation.
fn stale_capability(reason: &'static str) -> MessageError {
    MessageError::Repository(rootcause::report!("{reason}"))
}
