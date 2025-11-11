use crate::constants::MACRO_INTERNAL_USER_ID_HEADER_KEY;

use super::DocumentStorageServiceClient;
use anyhow::Result;
use model::document::list::ListDocumentsWithAccessResponse;
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use model::document::{
    DocumentBasic,
    response::{GetDocumentResponse, LocationResponseData, LocationResponseV3},
};
use model::document_storage_service_internal::{
    GetDocumentsMetadataRequest, GetDocumentsMetadataResponse,
};
use models_permissions::share_permission::access_level::AccessLevel;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct GetDocumentTextResponse {
    pub text: String,
}

// TODO: make the export call return a string instead of a struct
#[derive(Deserialize)]
pub struct ExportDocumentResponse {
    pub presigned_url: String,
}

impl DocumentStorageServiceClient {
    pub async fn get_document(&self, document_id: String) -> Result<GetDocumentResponse> {
        let res = self
            .client
            .get(format!("{}/internal/documents/{}", self.url, document_id))
            .send()
            .await?
            .json()
            .await?;

        let doc_data: GetDocumentResponse = serde_json::from_value(res)?;
        Ok(doc_data)
    }

    pub async fn get_document_basic(&self, document_id: &str) -> Result<Option<DocumentBasic>> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/basic",
                self.url, document_id
            ))
            .send()
            .await?;

        let status_code = res.status();

        if status_code == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let doc_data: DocumentBasic = res.json().await?;
        Ok(Some(doc_data))
    }

    pub async fn get_document_location(
        &self,
        document_id: String,
        document_version_id: String,
    ) -> Result<LocationResponseData> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/location?document_version_id={}",
                self.url, document_id, document_version_id,
            ))
            .send()
            .await?;

        let location_data = res.json::<LocationResponseData>().await?;
        Ok(location_data)
    }

    /// Get the document lcoation url ignoring version
    pub async fn get_recent_document_location(
        &self,
        document_id: String,
    ) -> Result<LocationResponseData> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/location",
                self.url, document_id,
            ))
            .send()
            .await?;

        let location_data = res.json::<LocationResponseData>().await?;
        Ok(location_data)
    }

    #[tracing::instrument(err(Debug), skip(self))]
    pub async fn get_recent_document_location_v3(
        &self,
        document_id: &str,
    ) -> Result<LocationResponseV3> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/location_v3",
                self.url, document_id,
            ))
            .send()
            .await?
            .error_for_status()?;

        let location_data = res.json::<LocationResponseV3>().await?;
        Ok(location_data)
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_document_presigned_url(&self, document_id: &str) -> Result<String> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/export",
                self.url, document_id
            ))
            .send()
            .await?
            .error_for_status()?;

        let export_document_response = res.json::<ExportDocumentResponse>().await?;

        Ok(export_document_response.presigned_url)
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_document_text(&self, document_id: &str) -> Result<String> {
        let res = self
            .client
            .get(format!(
                "{}/internal/documents/{}/text",
                self.url, document_id,
            ))
            .send()
            .await?;

        let response_data = res.json::<GetDocumentTextResponse>().await?;
        Ok(response_data.text)
    }

    // === JWT-authenticated external API methods ===

    /// Get document basic info using JWT authentication (calls external API)
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_document_basic_external(
        &self,
        document_id: &str,
        jwt_token: &str,
    ) -> Result<Option<DocumentBasic>> {
        let res = self
            .external_request(
                reqwest::Method::GET,
                &format!("/documents/{}/basic", document_id),
                jwt_token,
            )
            .send()
            .await?;

        let status_code = res.status();

        if status_code == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let doc_data: DocumentBasic = res.json().await?;
        Ok(Some(doc_data))
    }

    /// Get document location using JWT authentication (calls external API)
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_recent_document_location_v3_external(
        &self,
        document_id: &str,
        jwt_token: &str,
    ) -> Result<LocationResponseV3> {
        let res = self
            .external_request(
                reqwest::Method::GET,
                &format!("/documents/{}/location_v3", document_id),
                jwt_token,
            )
            .send()
            .await?;

        let status_code = res.status();

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                document_id=%document_id,
                "external API error when fetching document location"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let location_data = res.json::<LocationResponseV3>().await?;
        Ok(location_data)
    }

    /// Get document text using JWT authentication (calls external API)
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_document_text_external(
        &self,
        document_id: &str,
        jwt_token: &str,
    ) -> Result<String> {
        let res = self
            .external_request(
                reqwest::Method::GET,
                &format!("/documents/{}/text", document_id),
                jwt_token,
            )
            .send()
            .await?;

        let status_code = res.status();

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                document_id=%document_id,
                "external API error when fetching document text"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let response_data = res.json::<GetDocumentTextResponse>().await?;
        Ok(response_data.text)
    }

    /// Get metadata for documents
    #[tracing::instrument(skip(self))]
    pub async fn get_documents_metadata(
        &self,
        document_ids: Vec<String>,
    ) -> Result<GetDocumentsMetadataResponse> {
        let url = format!("{}/internal/documents/metadata", self.url);

        let request = GetDocumentsMetadataRequest { document_ids };

        let response = self.client.post(&url).json(&request).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());

            return Err(anyhow::anyhow!(
                "get documents metadata failed: {} - {}",
                status,
                text
            ));
        }

        let data = response
            .json::<GetDocumentsMetadataResponse>()
            .await
            .map_err(|_| anyhow::anyhow!("unable to parse response"))?;

        Ok(data)
    }

    /// List documents the user has access to with filtering (calls internal API)
    #[tracing::instrument(skip(self))]
    pub async fn list_documents_with_access(
        &self,
        user_id: &str,
        file_types: Option<Vec<String>>,
        min_access_level: Option<AccessLevel>,
        page: i64,
        page_size: i64,
    ) -> Result<ListDocumentsWithAccessResponse> {
        let mut query_params = vec![
            ("page".to_string(), page.to_string()),
            ("page_size".to_string(), page_size.to_string()),
        ];

        if let Some(file_types) = file_types {
            query_params.push(("file_types".to_string(), file_types.join(",")));
        }

        if let Some(min_access_level) = min_access_level {
            query_params.push((
                "min_access_level".to_string(),
                min_access_level.to_string().to_lowercase(),
            ));
        }

        let query_string = query_params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");

        let url = format!(
            "{}/internal/documents/list_with_access?{}",
            self.url, query_string
        );

        tracing::debug!(url=%url, "list_documents_with_access_internal");

        let res = self
            .client
            .get(&url)
            .header(MACRO_INTERNAL_USER_ID_HEADER_KEY, user_id)
            .send()
            .await?;

        let status_code = res.status();

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                user_id=%user_id,
                "error when listing documents with access"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let response_data = res.json::<ListDocumentsWithAccessResponse>().await?;
        Ok(response_data)
    }

    /// Create a document
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn create_document(
        &self,
        req: CreateDocumentRequest,
        jwt_token: &str,
    ) -> Result<CreateDocumentResponse> {
        let res = self
            .external_request(reqwest::Method::POST, "/documents", jwt_token)
            .json(&req)
            .send()
            .await?;

        let status_code = res.status();

        if !status_code.is_success() {
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%status_code,
                document_name=%req.document_name,
                "external API error when creating document"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let response_data = res.json::<CreateDocumentResponse>().await?;
        Ok(response_data)
    }
}
