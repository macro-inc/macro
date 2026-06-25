use crate::{
    OpensearchClient, Result, delete,
    upsert::{
        self,
        document::{IndexedProperty, UpsertDocumentArgs},
    },
};

impl OpensearchClient {
    /// Inserts a document into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_document(&self, upsert_document_args: &UpsertDocumentArgs) -> Result<()> {
        upsert::document::upsert_document(&self.inner, upsert_document_args, None).await
    }

    /// Bulk upserts documents into the opensearch index
    #[tracing::instrument(skip(self, documents))]
    pub async fn bulk_upsert_documents(
        &self,
        documents: &[UpsertDocumentArgs],
        index_override: Option<&str>,
    ) -> Result<upsert::BulkUpsertResult> {
        upsert::document::bulk_upsert_documents(&self.inner, documents, index_override).await
    }

    /// Deletes a document from the opensearch document index
    #[tracing::instrument(skip(self))]
    pub async fn delete_document(
        &self,
        document_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        delete::document::delete_document_by_id(&self.inner, document_id, index_override).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_document_metadata(
        &self,
        document_id: &str,
        document_name: &str,
    ) -> Result<()> {
        upsert::document::update_document_metadata(&self.inner, document_id, document_name).await
    }

    /// Refresh only the denormalized `properties` on an existing parent doc.
    #[tracing::instrument(skip(self, properties))]
    pub async fn update_document_properties(
        &self,
        document_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        upsert::document::update_document_properties(&self.inner, document_id, properties, None)
            .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_documents_by_owner_id(&self, owner_id: &str) -> Result<()> {
        delete::document::delete_document_by_owner_id(&self.inner, owner_id).await
    }
}
