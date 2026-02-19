//! Document service implementation.

#[cfg(test)]
mod tests;

use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::anyhow;
use cloudfront_sign::{SignedOptions, get_signed_url};
use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt};
use model::document::response::{
    GetDocumentResponseData, LocationResponseData, LocationResponseV3,
};
use model::document::{
    CONVERTED_DOCUMENT_FILE_NAME, DocumentBasic, FileType, FileTypeExt,
    build_cloud_storage_bucket_document_key,
};
use model::response::PresignedUrl;
use sqlx::PgPool;
use tracing;

use super::models::{CloudFrontConfig, DocumentError, LocationQueryParams};
use super::ports::{DocumentRepo, DocumentService};

/// The concrete document service implementation.
pub struct DocumentServiceImpl<R: DocumentRepo> {
    repo: R,
    cloudfront_config: CloudFrontConfig,
    sync_service_client: sync_service_client::SyncServiceClient,
    db: PgPool,
}

impl<R: DocumentRepo> DocumentServiceImpl<R> {
    /// Create a new document service.
    pub fn new(
        repo: R,
        cloudfront_config: CloudFrontConfig,
        sync_service_client: sync_service_client::SyncServiceClient,
        db: PgPool,
    ) -> Self {
        Self {
            repo,
            cloudfront_config,
            sync_service_client,
            db,
        }
    }

    fn get_signed_options(&self) -> SignedOptions {
        let current_unix_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let date_less_than =
            current_unix_timestamp + self.cloudfront_config.presigned_url_expiry_seconds;

        SignedOptions {
            key_pair_id: self.cloudfront_config.signer_public_key_id.clone(),
            date_less_than,
            private_key: self.cloudfront_config.signer_private_key.clone(),
            ..Default::default()
        }
    }

    fn make_presigned_url(&self, key: &str) -> anyhow::Result<String> {
        let constructed_url = format!("{}/{}", self.cloudfront_config.distribution_url, key);
        let options = self.get_signed_options();

        let signed_url = if !macro_aws_config::is_local_aws() {
            get_signed_url(&constructed_url, &options)?
        } else {
            constructed_url
        };

        Ok(signed_url)
    }

    async fn get_editable_url(
        &self,
        owner: &str,
        document_id: &str,
        document_version_id: Option<i64>,
        file_type: &str,
    ) -> anyhow::Result<LocationResponseData> {
        let url_encoded_owner = urlencoding::encode(owner);
        let document_version_id = if let Some(id) = document_version_id {
            id
        } else {
            self.repo
                .get_latest_document_version_id(document_id)
                .await
                .map_err(Into::into)?
                .0
        };

        let document_key = build_cloud_storage_bucket_document_key(
            &url_encoded_owner,
            document_id,
            document_version_id,
            Some(file_type),
        );

        let signed_url = self.make_presigned_url(&document_key)?;
        Ok(LocationResponseData::PresignedUrl(signed_url))
    }

    async fn get_static_url(
        &self,
        owner: &str,
        document_id: &str,
        file_type: &Option<FileType>,
    ) -> anyhow::Result<LocationResponseData> {
        let url_encoded_owner = urlencoding::encode(owner);
        let (document_version_id, _) = self
            .repo
            .get_document_version_id(document_id)
            .await
            .map_err(Into::into)?;

        let file_type_str = file_type.as_ref().map(|s| s.as_str());
        let document_key = build_cloud_storage_bucket_document_key(
            &url_encoded_owner,
            document_id,
            document_version_id,
            file_type_str,
        );

        let signed_url = self.make_presigned_url(&document_key)?;
        Ok(LocationResponseData::PresignedUrl(signed_url))
    }

    async fn get_converted_docx_url(
        &self,
        owner: &str,
        document_id: &str,
    ) -> anyhow::Result<LocationResponseData> {
        let url_encoded_owner = urlencoding::encode(owner);
        let document_key = format!(
            "{}/{}/{}.pdf",
            url_encoded_owner, document_id, CONVERTED_DOCUMENT_FILE_NAME
        );

        let signed_url = self.make_presigned_url(&document_key)?;
        Ok(LocationResponseData::PresignedUrl(signed_url))
    }

    async fn get_docx_urls(
        &self,
        document_id: &str,
        document_version_id: Option<i64>,
    ) -> anyhow::Result<LocationResponseData> {
        let shas: Vec<String> = if let Some(version_id) = document_version_id {
            self.repo
                .get_document_shas(version_id)
                .await
                .map_err(Into::into)?
        } else {
            self.repo
                .get_document_shas_by_document_id(document_id)
                .await
                .map_err(Into::into)?
        };

        let options = self.get_signed_options();
        let distribution_url = &self.cloudfront_config.distribution_url;

        let presigned_urls: Vec<PresignedUrl> = shas
            .iter()
            .filter_map(|sha| {
                let constructed_url = format!("{}/{}", distribution_url, sha);
                match get_signed_url(&constructed_url, &options) {
                    Ok(url) => Some(PresignedUrl {
                        presigned_url: url,
                        sha: sha.to_string(),
                    }),
                    Err(e) => {
                        tracing::error!(error=?e, sha=?sha, "unable to generate presigned url");
                        None
                    }
                }
            })
            .collect();

        if shas.len() != presigned_urls.len() {
            return Err(anyhow!("unable to generate presigned urls"));
        }

        Ok(LocationResponseData::PresignedUrls(presigned_urls))
    }

    async fn get_presigned_url_by_type(
        &self,
        owner: &str,
        document_id: &str,
        file_type: Option<FileType>,
        document_version_id: Option<i64>,
        get_converted_docx: bool,
    ) -> anyhow::Result<LocationResponseData> {
        match file_type {
            None => self.get_static_url(owner, document_id, &None).await,
            Some(ft) => {
                if ft == FileType::Docx && get_converted_docx {
                    self.get_converted_docx_url(owner, document_id).await
                } else if ft == FileType::Docx && !get_converted_docx {
                    self.get_docx_urls(document_id, document_version_id).await
                } else if ft.is_static() {
                    self.get_static_url(owner, document_id, &Some(ft)).await
                } else {
                    self.get_editable_url(owner, document_id, document_version_id, ft.as_str())
                        .await
                }
            }
        }
    }

    async fn try_get_from_sync_service(
        &self,
        document_id: &str,
    ) -> Result<Option<model::sync_service::DocumentMetadata>, anyhow::Error> {
        use futures::{FutureExt, pin_mut, select};

        let exists_fut = self.sync_service_client.exists(document_id).fuse();
        let metadata_fut = self.sync_service_client.get_metadata(document_id).fuse();

        pin_mut!(exists_fut, metadata_fut);

        select! {
            exists_result = exists_fut => {
                match exists_result {
                    Ok(false) => Ok(None),
                    Ok(true) | Err(_) => {
                        metadata_fut.await.map(Some)
                    }
                }
            },
            metadata_result = metadata_fut => {
                match metadata_result {
                    Ok(metadata) => Ok(Some(metadata)),
                    Err(e) => {
                        match exists_fut.await {
                            Ok(false) => Ok(None),
                            _ => Err(e),
                        }
                    }
                }
            }
        }
    }
}

impl<R: DocumentRepo> DocumentService for DocumentServiceImpl<R> {
    #[tracing::instrument(err, skip(self))]
    async fn get_document(
        &self,
        entity_access_receipt: EntityAccessReceipt,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        let document_id = entity_access_receipt.entity().entity_id.clone();
        // get access level
        // check if >= view
        // do work
        let document_metadata = self
            .repo
            .get_document_metadata(&document_id)
            .await
            .map_err(|e| {
                let err: anyhow::Error = e.into();
                if err.to_string().contains(
                    "no rows returned by a query that expected to return at least one row",
                ) {
                    DocumentError::NotFound(document_id.clone())
                } else {
                    DocumentError::Internal(err)
                }
            })?;

        let view_location = match entity_access_receipt.auth() {
            EntityAccessAuth::Authenticated(user_id) => self
                .repo
                .get_user_view_location(user_id.as_ref(), &document_id)
                .await
                .map_err(|e| DocumentError::Internal(e.into()))?,
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
        };

        let access_level = match entity_access_receipt.entity_permission() {
            entity_access::domain::models::EntityPermission::AccessLevel { access_level } => {
                access_level
            }
            _ => unreachable!(),
        };

        Ok(GetDocumentResponseData {
            document_metadata,
            user_access_level: *access_level,
            view_location,
        })
    }

    #[tracing::instrument(err, skip(self, document_context))]
    async fn get_document_location(
        &self,
        document_context: &DocumentBasic,
        entity_access_receipt: EntityAccessReceipt,
        params: LocationQueryParams,
    ) -> Result<LocationResponseV3, DocumentError> {
        let file_type = document_context
            .file_type
            .as_deref()
            .and_then(|f| FileType::from_str(f).ok());

        let document_id = entity_access_receipt.entity().entity_id.clone();

        // For markdown files, check sync service first
        if matches!(file_type, Some(FileType::Md)) {
            match self.try_get_from_sync_service(&document_id).await {
                Ok(Some(sync_service_metadata)) => {
                    return Ok(LocationResponseV3::SyncServiceContent {
                        metadata: document_context.clone(),
                        sync_service_metadata,
                    });
                }
                Ok(None) => {
                    // Continue to S3 check
                }
                Err(e) => {
                    tracing::error!(error=?e, "sync service failed");
                    return Err(DocumentError::Internal(e));
                }
            }
        }

        let owner = document_context.owner.as_ref();
        let response_data = self
            .get_presigned_url_by_type(
                owner,
                &document_id,
                file_type,
                params.document_version_id,
                params.get_converted_docx_url.unwrap_or(false),
            )
            .await
            .map(|response| match response {
                LocationResponseData::PresignedUrl(url) => LocationResponseV3::PresignedUrl {
                    presigned_url: url,
                    metadata: document_context.clone(),
                },
                LocationResponseData::PresignedUrls(urls) => LocationResponseV3::PresignedUrls {
                    presigned_urls: urls,
                    metadata: document_context.clone(),
                },
            })
            .map_err(|e| {
                if e.to_string() == "document does not exist in s3" {
                    DocumentError::Gone
                } else {
                    DocumentError::Internal(e)
                }
            })?;

        Ok(response_data)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_document(
        &self,
        entity_access_receipt: EntityAccessReceipt,
        project_id: Option<String>,
    ) -> Result<(), DocumentError> {
        self.repo
            .soft_delete_document(&entity_access_receipt.entity().entity_id.clone())
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?;

        match entity_access_receipt.auth() {
            EntityAccessAuth::Authenticated(macro_user_id) => {
                macro_project_utils::update_project_modified(
                    &self.db,
                    macro_project_utils::ProjectModifiedArgs {
                        project_id,
                        old_project_id: None::<String>,
                        user_id: macro_user_id.as_ref().to_string(),
                    },
                )
                .await;
            }
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => (),
        }

        Ok(())
    }

    async fn internal_get_basic_document(
        &self,
        document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        self.repo
            .get_basic_document(document_id)
            .await
            .map_err(|e| {
                let err: anyhow::Error = e.into();
                if err.to_string().contains(
                    "no rows returned by a query that expected to return at least one row",
                ) {
                    DocumentError::NotFound(document_id.to_string())
                } else {
                    DocumentError::Internal(err)
                }
            })
    }

    async fn get_document_text(
        &self,
        entity_access_receipt: EntityAccessReceipt,
    ) -> Result<String, DocumentError> {
        self.repo
            .get_document_text(&entity_access_receipt.entity().entity_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }
}
