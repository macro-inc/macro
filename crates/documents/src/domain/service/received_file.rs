//! Private, resumable files received in an authorized channel. Ownership follows
//! the verified channel member; creation is attributed to the system, not a human action.

use super::*;
use entity_access::domain::models::MemberParticipantRole;
use models_permissions::share_permission::LinkShareState;

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
    S: DocumentSyncPort,
> DocumentServiceImpl<R, U, T, C, Eam, F, B, S>
{
    /// Create a private binary file, or resume its exact reserved identity/hash.
    /// A ready file is never rewritten; an interrupted upload receives a fresh
    /// upload URL for the same version. Caller owns the durable source reservation.
    pub async fn prepare_received_file(
        &self,
        source: EntityAccessReceipt<MemberParticipantRole>,
        mut document: NewDocument,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        if source.entity().entity_type != EntityType::Channel {
            return Err(DocumentError::Unauthorized);
        }
        let user = source
            .get_authenticated_user()
            .map_err(|_| DocumentError::Unauthorized)?
            .clone();
        let id = document
            .id
            .filter(|id| id.get_version() == Some(uuid::Version::SortRand))
            .ok_or_else(|| {
                DocumentError::BadRequest("received files require a reserved UUIDv7".into())
            })?;
        let kind = document
            .file_type
            .ok_or_else(|| DocumentError::BadRequest("received file type is required".into()))?;
        if !matches!(
            kind.mime_type(),
            "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif"
                | "audio/mpeg"
                | "audio/mp4"
                | "audio/wav"
                | "audio/ogg"
                | "audio/aac"
                | "audio/amr"
                | "video/mp4"
                | "video/3gpp"
                | "video/quicktime"
                | "video/webm"
                | "video/ogg"
                | "application/pdf"
                | "text/plain"
        ) {
            return Err(DocumentError::BadRequest(
                "unsupported received file type".into(),
            ));
        }
        if document.document_name.trim().is_empty()
            || document.document_name.graphemes(true).count() > MAX_DOCUMENT_NAME_GRAPHEMES
            || document.sha.len() != 64
            || !document.sha.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(DocumentError::BadRequest(
                "invalid received file metadata".into(),
            ));
        }
        self.refuse_existing_session(Some(id)).await?;
        document.project_id = None;
        document.team_id = None;
        document.share_with_team = false;
        document.sub_type = None;
        document.skip_history = true;
        document.initial_link_share = InitialLinkShare::Exact(LinkShareState::Off);
        let sha = document.sha.clone();
        let owner = Owner::User(user);
        let (metadata, created) = match self
            .repo
            .create_document(
                CreateDocumentRepoArgs {
                    owner: owner.clone(),
                    document,
                },
                SharePermissionV2::from_link_share_state(LinkShareState::Off),
            )
            .await
        {
            Ok(metadata) => (metadata, true),
            Err(DocumentError::Conflict(_)) => {
                let metadata = self
                    .repo
                    .get_document_metadata(&id.to_string())
                    .await
                    .map_err(|e| DocumentError::Internal(e.into()))?;
                if metadata.owner != owner
                    || metadata.sha.as_deref() != Some(&sha)
                    || metadata.file_type.as_deref() != Some(kind.as_str())
                {
                    return Err(DocumentError::Conflict(
                        "received file reservation no longer matches its owner/content".into(),
                    ));
                }
                (metadata, false)
            }
            Err(error) => return Err(error),
        };
        if created {
            return self
                .finish_created_document(
                    metadata,
                    Some(kind),
                    None,
                    sha,
                    Attribution::direct(Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)),
                    None,
                )
                .await;
        }
        let content = self
            .content_for_document(&id.to_string(), Some(kind))
            .await?;
        let presigned_url = if content.state == DocumentContentState::Ready {
            None
        } else {
            let key = build_cloud_storage_bucket_document_key(
                &metadata.owner,
                &metadata.document_id,
                metadata.document_version_id,
            );
            Some(
                self.upload_url_service
                    .put_document_storage_presigned_url(&key, &sha, ContentType::from(kind))
                    .await
                    .map_err(DocumentError::Internal)?,
            )
        };
        let metadata = DocumentResponseMetadata::from_document_metadata(&metadata)
            .map_err(DocumentError::Internal)?;
        Ok(CreateDocumentResponseData {
            document_response: super::super::response::DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(metadata, content),
                presigned_url,
            },
            content_type: kind.mime_type().into(),
            file_type: Some(kind.as_str().into()),
        })
    }
}
