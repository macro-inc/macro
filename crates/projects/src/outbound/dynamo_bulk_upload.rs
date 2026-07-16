//! DynamoDB adapter for project bulk-upload requests.

use crate::domain::ports::BulkUploadRequestPort;
use models_bulk_upload::{BulkUploadRequest, BulkUploadRequestDocuments};
use uuid::Uuid;

/// DynamoDB-backed bulk-upload request adapter.
#[derive(Clone, Debug)]
pub struct DynamoBulkUploadAdapter {
    client: dynamodb_client::DynamodbClient,
}

impl DynamoBulkUploadAdapter {
    /// Create a bulk-upload adapter from a DynamoDB client.
    pub fn new(client: dynamodb_client::DynamodbClient) -> Self {
        Self { client }
    }
}

impl BulkUploadRequestPort for DynamoBulkUploadAdapter {
    #[tracing::instrument(skip(self), err)]
    async fn create_bulk_upload_request(
        &self,
        request_id: Uuid,
        user_id: &str,
        name: Option<&str>,
        parent_id: Option<&str>,
    ) -> anyhow::Result<BulkUploadRequest> {
        self.client
            .bulk_upload
            .create_bulk_upload_request(&request_id.to_string(), user_id, name, parent_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_bulk_upload_document_statuses(
        &self,
        upload_request_id: &str,
    ) -> anyhow::Result<BulkUploadRequestDocuments> {
        self.client
            .bulk_upload
            .get_bulk_upload_document_statuses(upload_request_id)
            .await
    }
}
