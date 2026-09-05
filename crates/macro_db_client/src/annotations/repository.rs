use messages::domain::{
    annotations::{AnnotationMutation, AnnotationRepository, AnnotationTarget},
    ports::MessageError,
};
use model::annotations::{
    delete::{DeleteUnthreadedAnchorRequest, DeleteUnthreadedAnchorResponse},
    edit::{EditAnchorRequest, EditAnchorResponse},
};
use sqlx::PgPool;
use uuid::Uuid;

pub struct PgAnnotationRepository(pub PgPool);

impl AnnotationRepository for PgAnnotationRepository {
    async fn target(&self, id: Uuid, highlight: bool) -> Result<AnnotationTarget, MessageError> {
        let row = sqlx::query!(r#"
            SELECT a.uuid AS "uuid!", a."documentId" AS "document_id!", a.owner AS "owner!", a."threadId" AS "thread_id?", t.user_id AS thread_owner
            FROM "PdfHighlightAnchor" a LEFT JOIN comms_message_threads t ON t.root_id = a."threadId"
            WHERE $2 AND a.uuid = $1 AND a."deletedAt" IS NULL
            UNION ALL
            SELECT a.uuid, a."documentId", a.owner, a."threadId", t.user_id
            FROM "PdfPlaceableCommentAnchor" a JOIN comms_message_threads t ON t.root_id = a."threadId"
            WHERE NOT $2 AND a.uuid = $1 AND t.deleted_at IS NULL
        "#, id, highlight).fetch_optional(&self.0).await.map_err(|e| MessageError::Repository(e.into()))?.ok_or(MessageError::NotFound)?;
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
        super::edit_anchor::edit_document_anchor(&self.0, access, input)
            .await
            .map_err(|e| MessageError::Repository(rootcause::report!("{e}")))
    }
    async fn delete(
        &self,
        access: AnnotationMutation,
        input: DeleteUnthreadedAnchorRequest,
    ) -> Result<DeleteUnthreadedAnchorResponse, MessageError> {
        super::delete_anchor::delete_document_anchor(&self.0, access, input)
            .await
            .map_err(|e| MessageError::Repository(rootcause::report!("{e}")))
    }
}
