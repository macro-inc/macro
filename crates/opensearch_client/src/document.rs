use crate::{
    OpensearchClient, Result, delete,
    retry::resend_on_lost_connection,
    upsert::{
        self,
        document::{EmailAttachmentUpdateResult, UpsertDocumentArgs},
        properties::{IndexedProperty, PropertyUpdate},
    },
};

impl OpensearchClient {
    /// Inserts a document into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_document(&self, upsert_document_args: &UpsertDocumentArgs) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::document::upsert_document(&self.inner, upsert_document_args, None)
        })
        .await
    }

    /// Upserts only the parent doc (no content chunks) into the opensearch index
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_parent_document(
        &self,
        upsert_document_args: &UpsertDocumentArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::document::upsert_parent_document(
                &self.inner,
                upsert_document_args,
                index_override,
            )
        })
        .await
    }

    /// Bulk upserts documents into the opensearch index
    #[tracing::instrument(skip(self, documents))]
    pub async fn bulk_upsert_documents(
        &self,
        documents: &[UpsertDocumentArgs],
        index_override: Option<&str>,
    ) -> Result<upsert::BulkUpsertResult> {
        resend_on_lost_connection(|| {
            upsert::document::bulk_upsert_documents(&self.inner, documents, index_override)
        })
        .await
    }

    /// Deletes the chunks of a document a reindex did not write: every chunk
    /// but the ones keyed by `node_ids`. The parent stays.
    pub async fn delete_stale_document_chunks(
        &self,
        document_id: &str,
        node_ids: &[&str],
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::document::delete_document_chunks_except(
                &self.inner,
                document_id,
                node_ids,
                index_override,
            )
        })
        .await
    }

    /// Deletes a document from the opensearch document index
    #[tracing::instrument(skip(self))]
    pub async fn delete_document(
        &self,
        document_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::document::delete_document_by_id(&self.inner, document_id, index_override)
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_document_metadata(
        &self,
        document_id: &str,
        document_name: &str,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::document::update_document_metadata(&self.inner, document_id, document_name)
        })
        .await
    }

    /// Refresh only the denormalized `properties` on an existing parent doc.
    #[tracing::instrument(skip(self, properties))]
    pub async fn update_document_properties(
        &self,
        document_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<PropertyUpdate> {
        resend_on_lost_connection(|| {
            upsert::document::update_document_properties(&self.inner, document_id, properties, None)
        })
        .await
    }

    /// Set `is_email_attachment` on each document's parent with one partial
    /// update apiece. A document that is not indexed counts as missing. When
    /// OpenSearch refuses writes (a 429 or a cluster block) this returns
    /// [`crate::error::OpensearchClientError::WritesRefused`]; stop instead of
    /// retrying.
    #[tracing::instrument(
        skip(self, document_ids),
        fields(document_count = document_ids.len()),
        err
    )]
    pub async fn bulk_update_email_attachment(
        &self,
        document_ids: &[String],
        is_email_attachment: bool,
    ) -> Result<EmailAttachmentUpdateResult> {
        resend_on_lost_connection(|| {
            upsert::document::bulk_update_email_attachment(
                &self.inner,
                document_ids,
                is_email_attachment,
            )
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_documents_by_owner_id(&self, owner_id: &str) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::document::delete_document_by_owner_id(&self.inner, owner_id)
        })
        .await
    }
}
