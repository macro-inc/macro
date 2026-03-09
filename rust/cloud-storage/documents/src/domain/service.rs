//! Document service implementation.

#[cfg(test)]
mod tests;

use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::anyhow;
use cloudfront_sign::{SignedOptions, get_signed_url};
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    EntityAccessAuth, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::response::{
    CreateDocumentResponseData, DocumentResponse, DocumentResponseMetadata,
    GetDocumentResponseData, LocationResponseData, LocationResponseV3,
};
use model::document::{
    CONVERTED_DOCUMENT_FILE_NAME, ContentType, DocumentBasic, FileType, FileTypeExt,
    build_cloud_storage_bucket_document_key,
};
use model::response::PresignedUrl;
use sqlx::PgPool;
use tracing;

use super::models::{CloudFrontConfig, CreateDocumentRepoArgs, DocumentError, LocationQueryParams};
use super::ports::{DocumentRepo, DocumentService, PresignedUploadUrlPort, TaskPropertiesPort};

/// The concrete document service implementation.
pub struct DocumentServiceImpl<R: DocumentRepo, U: PresignedUploadUrlPort, T: TaskPropertiesPort> {
    repo: R,
    cloudfront_config: CloudFrontConfig,
    sync_service_client: sync_service_client::SyncServiceClient,
    upload_url_service: U,
    task_properties_service: T,
    db: PgPool,
}

impl<R: DocumentRepo, U: PresignedUploadUrlPort, T: TaskPropertiesPort>
    DocumentServiceImpl<R, U, T>
{
    /// Create a new document service.
    pub fn new(
        repo: R,
        cloudfront_config: CloudFrontConfig,
        sync_service_client: sync_service_client::SyncServiceClient,
        upload_url_service: U,
        task_properties_service: T,
        db: PgPool,
    ) -> Self {
        Self {
            repo,
            cloudfront_config,
            sync_service_client,
            upload_url_service,
            task_properties_service,
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

    /// Clean up a document on creation error.
    async fn cleanup_document(&self, document_id: &str) {
        if let Err(e) = self.repo.delete_document_by_id(document_id).await {
            tracing::error!(error=?e, document_id=?document_id, "failed to clean up document");
        }
    }
}

impl<R: DocumentRepo, U: PresignedUploadUrlPort, T: TaskPropertiesPort> DocumentService
    for DocumentServiceImpl<R, U, T>
{
    #[tracing::instrument(err, skip(self))]
    async fn get_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
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
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
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
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
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
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        self.repo
            .get_document_text(&entity_access_receipt.entity().entity_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }

    async fn get_short_id(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        let entity_id = &entity_access_receipt.entity().entity_id;
        let uuid = macro_uuid::string_to_uuid(entity_id)
            .map_err(|e| DocumentError::BadRequest(format!("invalid entity_id: {e}")))?;
        let short_id = macro_uuid::ShortUuidConverter::default().from_uuid(&uuid);
        Ok(short_id)
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        let file_type = args.file_type;
        let project_id = args.project_id;
        let sha = args.sha.clone();

        // Create document metadata in the database (full transaction)
        let document_metadata = self.repo.create_document(args).await.map_err(|e| {
            let err: anyhow::Error = e.into();
            if err.to_string().contains("document with ID already exists") {
                DocumentError::Conflict("document with ID already exists".to_string())
            } else {
                DocumentError::Internal(err)
            }
        })?;

        let document_id = document_metadata.document_id.clone();

        // Update upload job if job_id provided (outside the main transaction)
        if let Some(job_id) = &job_id
            && let Err(e) = self.repo.update_upload_job(&document_id, job_id).await
        {
            tracing::error!(error=?e, document_id=?document_id, "failed to update upload job");
            self.cleanup_document(&document_id).await;
            return Err(DocumentError::Internal(anyhow!(
                "unable to update upload job"
            )));
        }

        // Build the S3 key for upload
        let key = build_cloud_storage_bucket_document_key(
            document_metadata.owner.as_ref(),
            &document_id,
            document_metadata.document_version_id,
            file_type.as_ref().map(|s| s.as_str()),
        );

        let content_type = match file_type {
            Some(FileType::Docx) => ContentType::Docx,
            _ => file_type.into(),
        };

        let mime_type = content_type.mime_type().to_string();

        // Generate presigned upload URL
        let presigned_url = match file_type {
            Some(FileType::Docx) => self
                .upload_url_service
                .put_docx_upload_presigned_url(&key, &sha, content_type)
                .await,
            _ => self
                .upload_url_service
                .put_document_storage_presigned_url(&key, &sha, content_type)
                .await,
        }
        .map_err(|e| {
            tracing::error!(error=?e, key=?key, document_id=?document_id, "unable to generate presigned url");
            DocumentError::Internal(anyhow!("unable to generate presigned url"))
        })?;

        // Convert metadata to response format
        let document_response_metadata =
            DocumentResponseMetadata::from_document_metadata(&document_metadata).map_err(|e| {
                tracing::error!(error=?e, document_id=?document_id, "unable to convert document metadata");
                DocumentError::Internal(anyhow!("unable to convert document metadata"))
            })?;

        // Update project modified timestamp (fire-and-forget)
        macro_project_utils::update_project_modified(
            &self.db,
            macro_project_utils::ProjectModifiedArgs {
                project_id,
                old_project_id: None,
                user_id: user_id.as_ref().to_string(),
            },
        )
        .await;

        // Attach task properties if creating a task
        if document_response_metadata.sub_type == Some(DocumentSubType::Task) {
            self.task_properties_service
                .attach_task_properties(vec![document_response_metadata.document_id.clone()])
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, document_id=?document_id, "failed to attach task properties");
                    DocumentError::Internal(anyhow!("failed to attach task properties"))
                })?;
        }

        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: document_response_metadata,
                presigned_url: Some(presigned_url),
            },
            content_type: mime_type,
            file_type: file_type.map(|f| f.to_string()),
        })
    }

    #[tracing::instrument(skip(self))]
    async fn update_task_status(
        &self,
        entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        status: &str,
    ) -> Result<(), DocumentError> {
        self.task_properties_service
            .update_task_status(&entity_access_receipt.entity().entity_id, status)
            .await
            .map_err(DocumentError::Internal)
    }
}
