//! Document service implementation.

#[cfg(test)]
mod tests;

use entity_access_management::domain::ports::EntityAccessManagementService;
use model_entity::EntityType;
use models_properties::EntityReference;
use models_properties::api::SetPropertyValue;
use std::borrow::Cow;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use unicode_segmentation::UnicodeSegmentation;

use anyhow::anyhow;
use cloudfront_sign::{SignedOptions, get_signed_url};
use connection::domain::models::{InvalidationEvent, InvalidationReason};
use connection::domain::ports::ConnectionService;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::response::{DocumentResponseMetadata, LocationResponseData};
use model::document::{ContentType, DocumentBasic, FileAssociation, FileType, FileTypeExt};
use model::response::PresignedUrl;
use s3_key::{
    build_cloud_storage_bucket_document_key, build_docx_staging_bucket_document_key,
    build_docx_to_pdf_converted_document_key,
};
use tracing;

use crate::domain::models::{
    ASSIGNEES_PROPERTY_ID, NOT_STARTED_STATUS_OPTION_ID, PropertyInput, STATUS_PROPERTY_ID,
};

use super::content::{DocumentContent, DocumentContentLocation, DocumentContentState};
use super::models::{
    CloudFrontConfig, CommentThread, CopyDocumentRepoArgs, CreateDocumentRepoArgs,
    CreateTaskRequest, DocumentError, EditDocumentRepoArgs, EditDocumentServiceArgs,
    FileTypeUpdate, LocationQueryParams, TeamTaskMetadata,
};
#[cfg(feature = "document_create")]
use super::ports::create::DocumentCreationService;
use super::ports::{DocumentRepo, DocumentService, PresignedUploadUrlPort, TaskPropertiesPort};
use super::response::{
    CreateDocumentResponseData, DocumentMetadataWithContent, DocumentResponse,
    DocumentResponseMetadataWithContent, GetDocumentResponseData, LocationResponseV3,
};

/// The concrete document service implementation.
pub struct DocumentServiceImpl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
> {
    repo: R,
    cloudfront_config: CloudFrontConfig,
    sync_service_client: sync_service_client::SyncServiceClient,
    upload_url_service: U,
    task_properties_service: T,
    connection_service: C,
    #[allow(dead_code)]
    entity_access_management_service: Eam,
}

fn ready_content_for_file_type(file_type: Option<FileType>) -> DocumentContent {
    match file_type {
        Some(FileType::Md) => DocumentContent::ready(DocumentContentLocation::SyncService),
        Some(FileType::Docx) => DocumentContent::ready(DocumentContentLocation::ConvertedPdf),
        _ => DocumentContent::ready(DocumentContentLocation::ObjectStorage),
    }
}

fn content_at_location(
    state: DocumentContentState,
    location: DocumentContentLocation,
) -> DocumentContent {
    DocumentContent {
        state,
        location: Some(location),
    }
}

fn presigned_location_content(
    state: DocumentContentState,
    file_type: Option<FileType>,
    get_converted_docx: bool,
) -> DocumentContent {
    let location = match (file_type, get_converted_docx) {
        (Some(FileType::Docx), true) => DocumentContentLocation::ConvertedPdf,
        (Some(FileType::Docx), false) => DocumentContentLocation::DocxBomParts,
        _ => DocumentContentLocation::ObjectStorage,
    };

    content_at_location(state, location)
}

fn pending_content_for_file_type(file_type: Option<FileType>) -> DocumentContent {
    match file_type {
        Some(FileType::Docx) => DocumentContent::pending_at(DocumentContentLocation::ConvertedPdf),
        _ => DocumentContent::pending_at(DocumentContentLocation::ObjectStorage),
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
> DocumentServiceImpl<R, U, T, C, Eam>
{
    /// Create a new document service.
    pub fn new(
        repo: R,
        cloudfront_config: CloudFrontConfig,
        sync_service_client: sync_service_client::SyncServiceClient,
        upload_url_service: U,
        task_properties_service: T,
        connection_service: C,
        entity_access_management_service: Eam,
    ) -> Self {
        Self {
            repo,
            cloudfront_config,
            sync_service_client,
            upload_url_service,
            task_properties_service,
            connection_service,
            entity_access_management_service,
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
        _file_type: &str,
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
        );

        let signed_url = self.make_presigned_url(&document_key)?;
        Ok(LocationResponseData::PresignedUrl(signed_url))
    }

    async fn get_static_url(
        &self,
        owner: &str,
        document_id: &str,
        _file_type: &Option<FileType>,
    ) -> anyhow::Result<LocationResponseData> {
        let url_encoded_owner = urlencoding::encode(owner);
        let (document_version_id, _) = self
            .repo
            .get_document_version_id(document_id)
            .await
            .map_err(Into::into)?;

        let document_key = build_cloud_storage_bucket_document_key(
            &url_encoded_owner,
            document_id,
            document_version_id,
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
        let document_key =
            build_docx_to_pdf_converted_document_key(&url_encoded_owner, document_id);

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
            anyhow::bail!("unable to generate presigned urls");
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

    async fn content_for_document(
        &self,
        document_id: &str,
        file_type: Option<FileType>,
    ) -> Result<DocumentContent, DocumentError> {
        if let Some(content) = self
            .repo
            .get_persisted_document_content(document_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?
        {
            return Ok(content);
        }

        let (_, uploaded) = if file_type
            .is_none_or(|file_type| file_type == FileType::Docx || file_type.is_static())
        {
            self.repo
                .get_document_version_id(document_id)
                .await
                .map_err(|e| DocumentError::Internal(e.into()))?
        } else {
            self.repo
                .get_latest_document_version_id(document_id)
                .await
                .map_err(|e| DocumentError::Internal(e.into()))?
        };

        Ok(DocumentContent::from_legacy_uploaded(uploaded, file_type))
    }

    fn markdown_sync_service_location_response(
        &self,
        document_context: &DocumentBasic,
        content: DocumentContent,
    ) -> LocationResponseV3 {
        LocationResponseV3::SyncServiceContent {
            metadata: document_context.clone(),
            content,
        }
    }

    async fn resolve_markdown_sync_service_location(
        &self,
        document_context: &DocumentBasic,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<Option<LocationResponseV3>, DocumentError> {
        if content.state == DocumentContentState::Ready
            && content.location == Some(DocumentContentLocation::SyncService)
        {
            return Ok(Some(self.markdown_sync_service_location_response(
                document_context,
                content,
            )));
        }

        match self.sync_service_client.exists(document_id).await {
            Ok(true) => Ok(Some(self.markdown_sync_service_location_response(
                document_context,
                DocumentContent::ready(DocumentContentLocation::SyncService),
            ))),
            Ok(false) => Ok(None),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    document_id=?document_id,
                    "temporary markdown location fallback did not find sync-service state"
                );
                Ok(None)
            }
        }
    }

    /// Clean up a document on creation error.
    async fn cleanup_document(&self, document_id: &str) {
        if let Err(e) = self.repo.delete_document_by_id(document_id).await {
            tracing::error!(error=?e, document_id=?document_id, "failed to clean up document");
        }
    }

    async fn resolve_task_team_id_for_user(
        &self,
        user_id: &MacroUserIdStr<'_>,
        requested_team_id: Option<uuid::Uuid>,
    ) -> Result<uuid::Uuid, DocumentError> {
        let team_ids = self
            .repo
            .get_team_ids_for_user(user_id.as_ref())
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?;

        if let Some(requested_team_id) = requested_team_id {
            if team_ids.contains(&requested_team_id) {
                return Ok(requested_team_id);
            }

            return Err(DocumentError::BadRequest(
                "user is not a member of the requested team".to_string(),
            ));
        }

        match team_ids.as_slice() {
            [team_id] => Ok(*team_id),
            [] => Err(DocumentError::BadRequest(
                "teamId is required because the user does not belong to a team".to_string(),
            )),
            _ => Err(DocumentError::BadRequest(
                "teamId is required because the user belongs to multiple teams".to_string(),
            )),
        }
    }

    async fn team_task_metadata_for_document(
        &self,
        document_id: &str,
    ) -> Result<Option<TeamTaskMetadata>, DocumentError> {
        self.repo
            .get_team_task_metadata(document_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }
}

#[cfg(feature = "document_create")]
impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
> DocumentCreationService for DocumentServiceImpl<R, U, T, C, Eam>
{
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        <Self as DocumentService>::create_document(self, user_id, args, job_id).await
    }

    async fn handle_task_properties(
        &self,
        user_id: MacroUserIdStr<'static>,
        document_id: &str,
        request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        <Self as DocumentService>::handle_task_properties(self, user_id, document_id, request).await
    }

    async fn resolve_task_team_id(
        &self,
        user_id: MacroUserIdStr<'static>,
        requested_team_id: Option<uuid::Uuid>,
    ) -> Result<uuid::Uuid, DocumentError> {
        self.resolve_task_team_id_for_user(&user_id, requested_team_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn mark_document_uploaded(&self, document_id: &str) -> Result<(), DocumentError> {
        self.repo
            .mark_document_uploaded(document_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self, content))]
    async fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        self.repo
            .set_document_content(document_id, content)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self))]
    async fn cleanup_created_document(&self, document_id: &str) {
        self.cleanup_document(document_id).await;
    }
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
> DocumentService for DocumentServiceImpl<R, U, T, C, Eam>
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

        let file_type = document_metadata
            .file_type
            .as_deref()
            .and_then(|file_type| FileType::from_str(file_type).ok());
        let content = self.content_for_document(&document_id, file_type).await?;
        let team_task_metadata = self.team_task_metadata_for_document(&document_id).await?;

        Ok(GetDocumentResponseData {
            document_metadata: DocumentMetadataWithContent::new(document_metadata, content)
                .with_team_task_metadata(team_task_metadata),
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
        let content = self.content_for_document(&document_id, file_type).await?;

        if matches!(file_type, Some(FileType::Md))
            && let Some(response) = self
                .resolve_markdown_sync_service_location(
                    document_context,
                    &document_id,
                    content.clone(),
                )
                .await?
        {
            return Ok(response);
        }

        let owner = document_context.owner.as_ref();
        let get_converted_docx_url = params.get_converted_docx_url.unwrap_or(false);
        let response_data = self
            .get_presigned_url_by_type(
                owner,
                &document_id,
                file_type,
                params.document_version_id,
                get_converted_docx_url,
            )
            .await
            .map(|response| match response {
                LocationResponseData::PresignedUrl(url) => {
                    let content = presigned_location_content(
                        content.state,
                        file_type,
                        get_converted_docx_url,
                    );
                    LocationResponseV3::PresignedUrl {
                        presigned_url: url,
                        metadata: document_context.clone(),
                        content,
                    }
                }
                LocationResponseData::PresignedUrls(urls) => {
                    let content =
                        content_at_location(content.state, DocumentContentLocation::DocxBomParts);
                    LocationResponseV3::PresignedUrls {
                        presigned_urls: urls,
                        metadata: document_context.clone(),
                        content,
                    }
                }
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

        if let Some(project_id) = &project_id
            && !project_id.is_empty()
        {
            let _ = self.repo.update_project_modified(project_id).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        let _ = self
            .connection_service
            .send_invalidation_event(InvalidationEvent::<()> {
                invalidation_reason: InvalidationReason::Deleted,
                entity_id: Cow::Borrowed(&entity_access_receipt.entity().entity_id),
                entity_type: entity_access_receipt.entity().entity_type,
                invalidated_by: entity_access_receipt.auth().clone(),
                metadata: None,
            })
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to send invalidation event");
            });

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

    async fn get_document_comments(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<CommentThread>, DocumentError> {
        self.repo
            .get_document_comments(&entity_access_receipt.entity().entity_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_name(&self, project_id: &str) -> Result<String, DocumentError> {
        self.repo
            .get_project_name(project_id)
            .await
            .map_err(|e| DocumentError::Internal(e.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_project_children(
        &self,
        project_id: &str,
    ) -> Result<Vec<model_entity::Entity<'static>>, DocumentError> {
        self.repo
            .get_project_children(project_id)
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

    #[tracing::instrument(err, skip(self, document_context))]
    async fn get_document_content(
        &self,
        document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        self.content_for_document(
            &document_context.document_id,
            document_context.try_file_type(),
        )
        .await
    }

    async fn resolve_task_team_id(
        &self,
        user_id: MacroUserIdStr<'static>,
        requested_team_id: Option<uuid::Uuid>,
    ) -> Result<uuid::Uuid, DocumentError> {
        self.resolve_task_team_id_for_user(&user_id, requested_team_id)
            .await
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        mut args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        if args.document_name.graphemes(true).count() > 100 {
            return Err(DocumentError::BadRequest("name too long".to_string()));
        }

        if args.is_task {
            let team_id = self
                .resolve_task_team_id_for_user(&args.user_id, args.team_id)
                .await?;
            args.team_id = Some(team_id);
        }

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

        let initial_content = pending_content_for_file_type(file_type);
        if let Err(e) = self
            .repo
            .set_document_content(&document_id, initial_content.clone())
            .await
        {
            tracing::error!(error=?e, document_id=?document_id, "failed to initialize document content metadata");
            self.cleanup_document(&document_id).await;
            return Err(DocumentError::Internal(e.into()));
        }

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

        let content_type = match file_type {
            Some(FileType::Docx) => ContentType::Docx,
            _ => file_type.into(),
        };

        let mime_type = content_type.mime_type().to_string();

        // Generate presigned upload URL
        // DOCX files go to the staging bucket with .docx extension (required by docx_unzip_handler)
        // All other files use extensionless keys in the document storage bucket
        let presigned_url = match file_type {
            Some(FileType::Docx) => {
                let docx_key = build_docx_staging_bucket_document_key(
                    document_metadata.owner.as_ref(),
                    &document_id,
                    document_metadata.document_version_id,
                );
                self.upload_url_service
                    .put_docx_upload_presigned_url(&docx_key, &sha, content_type)
                    .await
            }
            _ => {
                let key = build_cloud_storage_bucket_document_key(
                    document_metadata.owner.as_ref(),
                    &document_id,
                    document_metadata.document_version_id,
                );
                self.upload_url_service
                    .put_document_storage_presigned_url(&key, &sha, content_type)
                    .await
            }
        }
        .map_err(|e| {
            tracing::error!(error=?e, document_id=?document_id, "unable to generate presigned url");
            DocumentError::Internal(anyhow!("unable to generate presigned url"))
        })?;

        // Convert metadata to response format
        let document_response_metadata =
            DocumentResponseMetadata::from_document_metadata(&document_metadata).map_err(|e| {
                tracing::error!(error=?e, document_id=?document_id, "unable to convert document metadata");
                DocumentError::Internal(anyhow!("unable to convert document metadata"))
            })?;

        // Update project modified timestamp
        if let Some(project_id) = &project_id {
            let project_id_str = project_id.to_string();
            let document_uuid =
                uuid::Uuid::parse_str(&document_response_metadata.document_id).unwrap();
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&document_uuid, EntityType::Document, project_id)
                .await.inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to update entity access for project"));
            // Update project
            let _ = self.repo.update_project_modified(&project_id_str).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

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

        let team_task_metadata = self.team_task_metadata_for_document(&document_id).await?;

        Ok(CreateDocumentResponseData {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    document_response_metadata,
                    initial_content,
                )
                .with_team_task_metadata(team_task_metadata),
                presigned_url: Some(presigned_url),
            },
            content_type: mime_type,
            file_type: file_type.map(|f| f.to_string()),
        })
    }

    #[tracing::instrument(err, skip(self, document_context, args))]
    async fn edit_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        document_context: DocumentBasic,
        args: EditDocumentServiceArgs,
    ) -> Result<(), DocumentError> {
        if let Some(name) = args.document_name.as_ref()
            && name.graphemes(true).count() > 100
        {
            return Err(DocumentError::BadRequest("name too long".to_string()));
        }

        // Check owner-only restrictions for authenticated users
        if let entity_access::domain::models::EntityPermission::AccessLevel { access_level } =
            entity_access_receipt.entity_permission()
        {
            if args.project_id.is_some()
                && *access_level
                    != models_permissions::share_permission::access_level::AccessLevel::Owner
            {
                return Err(DocumentError::Unauthorized);
            }

            if args.share_permission.is_some()
                && *access_level
                    != models_permissions::share_permission::access_level::AccessLevel::Owner
            {
                return Err(DocumentError::Unauthorized);
            }
        }

        if let Some(file_type_update) = &args.file_type {
            let current_file_type = document_context
                .file_type
                .as_ref()
                .and_then(|ft| FileType::from_str(ft).ok())
                .ok_or_else(|| {
                    DocumentError::BadRequest(
                        "cannot change file type of a document with no file type".to_string(),
                    )
                })?;

            let current_association = current_file_type.macro_app_path();

            if !matches!(current_association, FileAssociation::Code(_)) {
                return Err(DocumentError::BadRequest(
                    "file type changes are only supported for code files".to_string(),
                ));
            }

            if let FileTypeUpdate::Set(new_file_type) = file_type_update {
                let new_association = new_file_type.macro_app_path();
                if std::mem::discriminant(&current_association)
                    != std::mem::discriminant(&new_association)
                {
                    return Err(DocumentError::BadRequest(
                        "cannot change file type to a different association".to_string(),
                    ));
                }
            }
        }

        // Clean the document name (remove file extension if present)
        let document_name = args
            .document_name
            .map(|s| FileType::clean_document_name(&s).unwrap_or(s));

        self.repo
            .edit_document(EditDocumentRepoArgs {
                document_id: entity_access_receipt.entity().entity_id.clone(),
                document_name,
                project_id: args.project_id.clone(),
                share_permission: args.share_permission,
                file_type: args.file_type,
            })
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?;

        // Update project modified timestamps
        if let Some(old_project_id) = &document_context.project_id
            && !old_project_id.is_empty()
        {
            let old_project_id = uuid::Uuid::parse_str(old_project_id).unwrap();
            let document_uuid = uuid::Uuid::parse_str(&document_context.document_id).unwrap();
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&document_uuid, EntityType::Document, &old_project_id)
                .await.inspect_err(|e| tracing::error!(error=?e, project_id=?old_project_id, "unable to update entity access for project"));
            let _ = self.repo.update_project_modified(&old_project_id.to_string()).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?old_project_id, "unable to update project modified date"),
            );
        }
        if let Some(project_id) = &args.project_id
            && !project_id.is_empty()
        {
            let project_id = uuid::Uuid::parse_str(project_id).unwrap();
            let document_uuid = uuid::Uuid::parse_str(&document_context.document_id).unwrap();
            let _ = self
                .entity_access_management_service
                .add_entity_to_project(&document_uuid, EntityType::Document, &project_id)
                .await.inspect_err(|e| tracing::error!(error=?e, project_id=?project_id, "unable to update entity access for project"));
            let _ = self.repo.update_project_modified(&project_id.to_string()).await.inspect_err(
                |e| tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date"),
            );
        }

        // Send invalidation event
        let _ = self
            .connection_service
            .send_invalidation_event(InvalidationEvent::<()> {
                invalidation_reason: InvalidationReason::Content,
                entity_id: Cow::Borrowed(&entity_access_receipt.entity().entity_id),
                entity_type: entity_access_receipt.entity().entity_type,
                invalidated_by: entity_access_receipt.auth().clone(),
                metadata: None,
            })
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to send invalidation event");
            });

        Ok(())
    }

    #[tracing::instrument(err, skip(self, document_context, document_name))]
    async fn copy_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        document_context: DocumentBasic,
        user_id: MacroUserIdStr<'static>,
        document_name: String,
        query_version_id: Option<i64>,
        sync_version_id: Option<model::sync_service::SyncServiceVersionID>,
    ) -> Result<DocumentResponse, DocumentError> {
        use model::document::response::DocumentResponseMetadata;

        if document_name.graphemes(true).count() > 100 {
            return Err(DocumentError::BadRequest("name too long".to_string()));
        }

        if document_context.deleted_at.is_some() {
            return Err(DocumentError::BadRequest(
                "cannot copy deleted document".to_string(),
            ));
        }

        let document_id = &entity_access_receipt.entity().entity_id;

        // Get full document metadata (at specific version or latest)
        let mut original_metadata = if let Some(version_id) = query_version_id {
            self.repo
                .get_document_metadata_at_version(document_id, version_id)
                .await
                .map_err(|e| DocumentError::Internal(e.into()))?
        } else {
            self.repo
                .get_document_metadata(document_id)
                .await
                .map_err(|e| DocumentError::Internal(e.into()))?
        };

        // Check project ownership - only copy project_id if the user owns the project
        if let Some(project_id) = &original_metadata.project_id {
            match self.repo.get_project_owner(project_id).await {
                Ok(project_owner) => {
                    if project_owner.as_ref() != user_id.as_ref() {
                        original_metadata.project_id = None;
                        original_metadata.project_name = None;
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "unable to get project owner");
                    return Err(DocumentError::Internal(e.into()));
                }
            }
        }

        let file_type: Option<FileType> = document_context
            .file_type
            .as_deref()
            .and_then(|f| FileType::from_str(f).ok());

        // Validate DOCX has BOM
        if file_type == Some(FileType::Docx) && original_metadata.document_bom.is_none() {
            return Err(DocumentError::Internal(anyhow!("document bom is missing")));
        }

        // Clean the document name
        let document_name = FileType::clean_document_name(&document_name).unwrap_or(document_name);

        let copy_team_id = if original_metadata.sub_type == Some(DocumentSubType::Task) {
            Some(self.resolve_task_team_id_for_user(&user_id, None).await?)
        } else {
            None
        };

        // Create the copy in the database
        let new_metadata = self
            .repo
            .copy_document(CopyDocumentRepoArgs {
                original_document: original_metadata.clone(),
                user_id: user_id.clone(),
                document_name,
                file_type,
                team_id: copy_team_id,
            })
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?;

        let new_document_id = new_metadata.document_id.clone();

        // File-type-specific S3 operations
        let copy_result = match file_type {
            Some(FileType::Docx) => {
                // Copy the converted PDF version
                let url_encoded_owner = urlencoding::encode(original_metadata.owner.as_ref());
                let source_key = build_docx_to_pdf_converted_document_key(
                    &url_encoded_owner,
                    &original_metadata.document_id,
                );
                let dest_key =
                    build_docx_to_pdf_converted_document_key(user_id.as_ref(), &new_document_id);
                self.upload_url_service
                    .copy_object(&source_key, &dest_key)
                    .await
            }
            Some(FileType::Md) => {
                // Copy via sync service
                if let Err(e) = self
                    .sync_service_client
                    .copy_document(
                        &original_metadata.document_id,
                        &new_document_id,
                        sync_version_id,
                    )
                    .await
                {
                    tracing::error!(error=?e, "unable to copy document through sync service");
                    self.cleanup_document(&new_document_id).await;
                    return Err(DocumentError::Internal(e));
                }

                // Also copy S3 file
                let source_version_id = self
                    .repo
                    .get_latest_document_version_id(&original_metadata.document_id)
                    .await
                    .map_err(|e| DocumentError::Internal(e.into()))?
                    .0;

                let source_key = build_cloud_storage_bucket_document_key(
                    original_metadata.owner.as_ref(),
                    &original_metadata.document_id,
                    source_version_id,
                );
                let dest_key = build_cloud_storage_bucket_document_key(
                    user_id.as_ref(),
                    &new_document_id,
                    new_metadata.document_version_id,
                );
                // Best effort S3 copy for live collab
                let _ = self
                    .upload_url_service
                    .copy_object(&source_key, &dest_key)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "unable to copy live collab document");
                    });
                Ok(())
            }
            _ => {
                // Copy PDF parts if applicable
                if file_type == Some(FileType::Pdf)
                    && let Err(e) = self
                        .repo
                        .copy_pdf_parts(&new_document_id, &original_metadata.document_id)
                        .await
                {
                    tracing::error!(error=?e, "unable to copy pdf parts");
                    self.cleanup_document(&new_document_id).await;
                    return Err(DocumentError::Internal(e.into()));
                }

                // Get source version id
                let source_version_id = if file_type.is_none_or(|f| f.is_static()) {
                    self.repo
                        .get_document_version_id(&original_metadata.document_id)
                        .await
                        .map_err(|e| DocumentError::Internal(e.into()))?
                        .0
                } else {
                    self.repo
                        .get_latest_document_version_id(&original_metadata.document_id)
                        .await
                        .map_err(|e| DocumentError::Internal(e.into()))?
                        .0
                };

                let source_key = build_cloud_storage_bucket_document_key(
                    original_metadata.owner.as_ref(),
                    &original_metadata.document_id,
                    source_version_id,
                );
                let dest_key = build_cloud_storage_bucket_document_key(
                    user_id.as_ref(),
                    &new_document_id,
                    new_metadata.document_version_id,
                );
                self.upload_url_service
                    .copy_object(&source_key, &dest_key)
                    .await
            }
        };

        if let Err(e) = copy_result {
            tracing::error!(error=?e, "unable to copy document files");
            self.cleanup_document(&new_document_id).await;
            return Err(DocumentError::Internal(e));
        }

        // Copy task properties if the original document is a task
        if original_metadata.sub_type == Some(document_sub_type::DocumentSubType::Task)
            && let Err(e) = self
                .task_properties_service
                .copy_task_properties(&original_metadata.document_id, &new_document_id)
                .await
        {
            tracing::error!(error=?e, document_id=?new_document_id, "failed to copy task properties");
            self.cleanup_document(&new_document_id).await;
            return Err(DocumentError::Internal(e));
        }

        let content = ready_content_for_file_type(file_type);
        if let Err(e) = self
            .repo
            .set_document_content(&new_document_id, content.clone())
            .await
        {
            tracing::error!(error=?e, document_id=?new_document_id, "failed to mark copied document content ready");
            self.cleanup_document(&new_document_id).await;
            return Err(DocumentError::Internal(e.into()));
        }

        let document_response_metadata =
            DocumentResponseMetadata::from_document_metadata(&new_metadata).map_err(|e| {
                tracing::error!(error=?e, "unable to convert document metadata");
                DocumentError::Internal(anyhow!("unable to convert document metadata"))
            })?;

        let team_task_metadata = self
            .team_task_metadata_for_document(&new_document_id)
            .await?;

        Ok(DocumentResponse {
            document_metadata: DocumentResponseMetadataWithContent::new(
                document_response_metadata,
                content,
            )
            .with_team_task_metadata(team_task_metadata),
            presigned_url: None,
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
            .map_err(DocumentError::Internal)?;

        let _ = self
            .connection_service
            .send_invalidation_event(InvalidationEvent::<()> {
                invalidation_reason: InvalidationReason::Metadata,
                entity_id: Cow::Borrowed(&entity_access_receipt.entity().entity_id),
                entity_type: entity_access_receipt.entity().entity_type,
                invalidated_by: entity_access_receipt.auth().clone(),
                metadata: None,
            })
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to send invalidation event");
            });

        Ok(())
    }

    /// Assigns the task properties to a document
    #[tracing::instrument(skip(self, request), err)]
    async fn handle_task_properties(
        &self,
        user_id: MacroUserIdStr<'static>,
        document_id: &str,
        request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        if request.share_with_team {
            let Some(team_id) = request.team_id else {
                return Err(DocumentError::BadRequest(
                    "teamId is required to share a task with a team".to_string(),
                ));
            };

            let _ = self
                .repo
                .share_with_team(&team_id, document_id)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to share task with team");
                });
        }

        // Use provided properties or assign default ones for task
        let properties = if let Some(properties) = request.property_values.as_ref() {
            properties
        } else {
            &vec![
                PropertyInput {
                    property_id: ASSIGNEES_PROPERTY_ID.to_string(),
                    value: SetPropertyValue::MultiEntityReference {
                        references: vec![EntityReference {
                            entity_id: user_id.as_ref().to_string(),
                            entity_type: models_properties::EntityType::User,
                            specific_message_id: None,
                        }],
                    },
                },
                PropertyInput {
                    property_id: STATUS_PROPERTY_ID.to_string(),
                    value: SetPropertyValue::SelectOption {
                        option_id: NOT_STARTED_STATUS_OPTION_ID,
                    },
                },
            ]
        };

        for property_input in properties {
            let Ok(property_uuid) = uuid::Uuid::parse_str(&property_input.property_id) else {
                tracing::warn!(property_id=?property_input.property_id, "invalid property_id UUID, skipping");
                continue;
            };

            let _ = self
                .task_properties_service
                .set_entity_property(
                    user_id.as_ref(),
                    document_id,
                    property_uuid,
                    Some(property_input.value.clone()),
                )
                .await
                .inspect_err(|e| {
                    tracing::warn!(
                            error=?e,
                            property_uuid=?property_uuid,
                            "unable to set entity property")
                });
        }

        Ok(())
    }
}
