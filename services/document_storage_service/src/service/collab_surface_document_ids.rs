//! Glue adapter giving collab surfaces their view of the document id
//! namespace, which they share in sync-service.

use collab_surface::domain::ports::DocumentIds;
use sqlx::PgPool;
use uuid::Uuid;

/// [`DocumentIds`] over the documents table's owning helper.
#[derive(Debug, Clone)]
pub struct DssCollabSurfaceDocumentIds(pub PgPool);

impl DocumentIds for DssCollabSurfaceDocumentIds {
    #[tracing::instrument(err, skip(self))]
    async fn is_document_id(&self, id: Uuid) -> Result<bool, rootcause::Report> {
        // Document ids are canonical lowercase text, and the sync-service
        // session key is that exact spelling. Soft-deleted documents keep their
        // session, so the helper deliberately counts them.
        macro_db_client::dcs::does_document_exist::does_document_exist(
            self.0.clone(),
            &id.to_string(),
        )
        .await
        .map_err(|e| rootcause::report!("failed to look up document id {id}: {e:?}").into_dynamic())
    }
}
