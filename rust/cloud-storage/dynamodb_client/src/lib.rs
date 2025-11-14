use aws_config::SdkConfig;

mod bulk_upload;

use models_bulk_upload::{
    BulkUploadRequest, BulkUploadRequestDocuments, EXTRACT_UPLOAD_FOLDER, UploadDocumentStatus,
    UploadFolderStatus,
};

#[derive(Debug, Clone)]
pub struct DynamodbClient {
    pub bulk_upload: BulkUpload,
}

impl DynamodbClient {
    pub fn new(aws_config: &SdkConfig, bulk_upload_requests_table: Option<String>) -> Self {
        let client = aws_sdk_dynamodb::Client::new(aws_config);

        Self::new_from_client(client, bulk_upload_requests_table)
    }

    pub fn new_from_client(
        client: aws_sdk_dynamodb::Client,
        bulk_upload_requests_table: Option<String>,
    ) -> Self {
        Self {
            bulk_upload: BulkUpload {
                table: bulk_upload_requests_table,
                client,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct BulkUpload {
    table: Option<String>,
    client: aws_sdk_dynamodb::Client,
}

impl BulkUpload {
    fn table(&self) -> anyhow::Result<&str> {
        self.table
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("bulk_upload_requests_table is not configured"))
    }

    #[tracing::instrument(skip(self))]
    pub async fn create_bulk_upload_request(
        &self,
        request_id: &str,
        user_id: &str,
        name: Option<&str>,
        parent_id: Option<&str>,
    ) -> anyhow::Result<BulkUploadRequest> {
        let table = self.table()?;
        let key = format!("{}/{}", EXTRACT_UPLOAD_FOLDER, request_id);
        bulk_upload::create_bulk_upload_request(
            &self.client,
            table,
            request_id,
            user_id,
            key.as_str(),
            name,
            parent_id,
        )
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_bulk_upload_request_status(
        &self,
        request_id: &str,
        status: UploadFolderStatus,
        error_message: Option<&str>,
        root_project_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let table = self.table()?;
        bulk_upload::update_bulk_upload_request_status(
            &self.client,
            table,
            request_id,
            status.to_string().as_str(),
            error_message,
            root_project_id,
        )
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_bulk_upload_request(
        &self,
        request_id: &str,
    ) -> anyhow::Result<BulkUploadRequest> {
        let table = self.table()?;
        bulk_upload::get_bulk_upload_request(&self.client, table, request_id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_bulk_upload_document_statuses(
        &self,
        request_id: &str,
    ) -> anyhow::Result<BulkUploadRequestDocuments> {
        let table = self.table()?;
        bulk_upload::get_bulk_upload_document_statuses(&self.client, table, request_id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn bulk_update_file_status(
        &self,
        request_id: &str,
        document_ids: Vec<String>,
        status: UploadDocumentStatus,
    ) -> anyhow::Result<()> {
        let table = self.table()?;
        bulk_upload::set_document_request_mappings(
            &self.client,
            table,
            request_id,
            document_ids,
            status,
        )
        .await
    }
}
