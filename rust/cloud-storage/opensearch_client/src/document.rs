use crate::{
    OpensearchClient, Result, delete,
    search::{self, documents::search_documents, model::SearchHit},
    upsert::{self, document::UpsertDocumentArgs},
};

impl OpensearchClient {
    /// Inserts a document into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_document(&self, upsert_document_args: &UpsertDocumentArgs) -> Result<()> {
        upsert::document::upsert_document(&self.inner, upsert_document_args).await
    }

    /// Bulk upserts documents into the opensearch index
    #[tracing::instrument(skip(self, documents))]
    pub async fn bulk_upsert_documents(
        &self,
        documents: &[UpsertDocumentArgs],
    ) -> Result<upsert::document::BulkUpsertResult> {
        upsert::document::bulk_upsert_documents(&self.inner, documents).await
    }

    /// Searches for documents in the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn search_documents(
        &self,
        args: search::documents::DocumentSearchArgs,
    ) -> Result<Vec<SearchHit>> {
        search_documents(&self.inner, args).await
    }

    /// Deletes a document from the opensearch document index
    #[tracing::instrument(skip(self))]
    pub async fn delete_document(&self, document_id: &str) -> Result<()> {
        delete::document::delete_document_by_id(&self.inner, document_id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_document_metadata(
        &self,
        document_id: &str,
        document_name: &str,
    ) -> Result<()> {
        upsert::document::update_document_metadata(&self.inner, document_id, document_name).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_documents_by_owner_id(&self, owner_id: &str) -> Result<()> {
        delete::document::delete_document_by_owner_id(&self.inner, owner_id).await
    }
}
