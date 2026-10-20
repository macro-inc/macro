//! Compose native document storage and channel attachment permissions. Provider
//! URLs are never persisted as Macro file links; every file is a private document.

pub(super) mod linked;

use async_trait::async_trait;
use base64::Engine;
use channels::{
    domain::{
        models::{ReferenceShareOutcome, ReferencedShareItem, ReferencedShareItemType},
        ports::{ChannelReferenceSharePermissions, ChannelRepo},
    },
    outbound::{
        pg_channel_reference_share_permissions::PgChannelReferenceSharePermissions,
        pg_channels_repo::PgChannelsRepo,
    },
};
use documents_hex::domain::{
    content::{DocumentContent, DocumentContentLocation, DocumentContentState},
    models::{InitialLinkShare, LocationQueryParams, NewDocument},
    ports::{
        DocumentService as _,
        create::{DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService},
    },
    response::LocationResponseV3,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, MemberParticipantRole, ViewAccessLevel},
    ports::EntityAccessService as _,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::{
    domain::{models::MessageParent, ports::MessageRepository},
    outbound::pg_message_repo::PgMessageRepository,
};
use meta_messaging::{
    domain::{
        connection::*,
        events::IncomingMessage,
        media::MAX_FILE_BYTES,
        models::{MessagingError, ProviderId},
        ports::*,
    },
    outbound::repository::PgMessagingRepository,
};
use model::document::{FileType, MAX_DOCUMENT_NAME_GRAPHEMES};
use models_permissions::share_permission::LinkShareState;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{str::FromStr, sync::Arc, time::Duration};
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

use super::native::{access_error, error, plain_markdown, render_message_content};
use crate::api::context::{DocumentService, EntityAccessService};

/// Keep the current native access check inseparable from creating a provider copy.
pub(super) async fn temporary_url<E: entity_access::domain::ports::EntityAccessService>(
    access: &E,
    copies: &dyn meta_messaging::domain::temporary_media::TemporaryMedia,
    user: &MacroUserIdStr<'_>,
    document: Uuid,
    file: &MediaBytes,
) -> PortResult<String> {
    access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user.0,
            None,
            &document.to_string(),
            EntityType::Document,
        )
        .await
        .map_err(access_error)?;
    copies.stage(file).await
}

/// Narrow file capability, separately injectable in text-only integration tests.
#[async_trait]
pub(super) trait MessageFiles: Send + Sync {
    async fn upload(
        &self,
        user: &str,
        channel: Uuid,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment>;
    async fn receive(
        &self,
        connection: &Connection,
        message: &IncomingMessage,
        files: Vec<Option<MediaBytes>>,
    ) -> PortResult<()>;
    async fn read(&self, user: &str, channel: Uuid, document: Uuid) -> PortResult<MediaBytes>;
    async fn prepare(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
        file: MediaBytes,
    ) -> PortResult<OutboundMedia>;
    async fn attach_sent(
        &self,
        work: &SendWork,
        connection: &Connection,
        provider_id: &ProviderId,
    ) -> PortResult<()>;
}

/// Native file operations backed by the existing documents and access services.
pub(super) struct NativeFiles {
    pool: PgPool,
    documents: Arc<DocumentService>,
    access: Arc<EntityAccessService>,
    uploads: documents_hex::outbound::document_bytes_upload::ReqwestDocumentBytesUploader,
    http: reqwest::Client,
    temporary_media: Option<Arc<dyn meta_messaging::domain::temporary_media::TemporaryMedia>>,
}
impl NativeFiles {
    pub(super) fn new(
        pool: PgPool,
        documents: Arc<DocumentService>,
        access: Arc<EntityAccessService>,
        temporary_media: Option<Arc<dyn meta_messaging::domain::temporary_media::TemporaryMedia>>,
    ) -> Result<Self, MessagingError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| MessagingError::Unavailable)?;
        Ok(Self {
            pool,
            documents,
            access,
            uploads:
                documents_hex::outbound::document_bytes_upload::ReqwestDocumentBytesUploader::new(
                    http.clone(),
                ),
            http,
            temporary_media,
        })
    }
    async fn share(
        &self,
        user: MacroUserIdStr<'static>,
        channel: Uuid,
        document: Uuid,
    ) -> PortResult<()> {
        let results =
            PgChannelReferenceSharePermissions::new(self.pool.clone(), self.access.clone())
                .update_channel_share_permissions_for_referenced_items(
                    user,
                    channel,
                    vec![ReferencedShareItem::new(
                        document.to_string(),
                        ReferencedShareItemType::Document,
                    )],
                )
                .await
                .map_err(error)?;
        match results.as_slice() {
            [result] if result.outcome == ReferenceShareOutcome::Shared => Ok(()),
            _ => Err(MessagingError::Forbidden.into()),
        }
    }
    async fn store_private_file(
        &self,
        source: EntityAccessReceipt<MemberParticipantRole>,
        document: NewDocument,
        file: MediaBytes,
        checksum: String,
    ) -> PortResult<()> {
        let id = document.id.ok_or(MessagingError::Unavailable)?;
        let prepared = self
            .documents
            .prepare_received_file(source, document)
            .await
            .map_err(error)?;
        // No upload URL means the exact reserved file is already ready. Recovery
        // never overwrites it; owner, hash and file type are checked by documents.
        if let Some(url) = prepared.document_response.presigned_url {
            self.uploads
                .upload_document_bytes(DocumentBytesUpload {
                    presigned_url: url,
                    content_type: prepared.content_type,
                    base64_sha256: checksum,
                    bytes: file.bytes,
                })
                .await
                .map_err(error)?;
            DocumentCreationService::set_document_content(
                &self.documents,
                &id.to_string(),
                DocumentContent::ready(DocumentContentLocation::ObjectStorage),
            )
            .await
            .map_err(error)?;
        }
        Ok(())
    }

    async fn read_url(&self, url: &str) -> PortResult<Vec<u8>> {
        let url = macro_aws_config::transform_aws_url_for_internal_fetch(url);
        let mut response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MessagingError::Unavailable.into());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_FILE_BYTES as u64)
        {
            return Err(MessagingError::Invalid(
                "attachment exceeds Macro's 32 MiB messaging limit",
            )
            .into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| MessagingError::Unavailable)?
        {
            if bytes.len() + chunk.len() > MAX_FILE_BYTES {
                return Err(MessagingError::Invalid(
                    "attachment exceeds Macro's 32 MiB messaging limit",
                )
                .into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}

#[async_trait]
impl MessageFiles for NativeFiles {
    async fn upload(
        &self,
        user: &str,
        channel: Uuid,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment> {
        let kind = received_type(&file)?;
        let owner = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        let source = self
            .access
            .generate_entity_access_receipt::<MemberParticipantRole>(
                &owner.0,
                None,
                &channel.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        let id = Uuid::now_v7();
        let digest = Sha256::digest(&file.bytes);
        let sha = digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let name = document_name(&file.filename);
        let filename = file.filename.clone();
        self.store_private_file(
            source,
            NewDocument {
                id: Some(id),
                sha,
                document_name: name,
                file_type: Some(kind),
                project_id: None,
                team_id: None,
                share_with_team: false,
                created_at: None,
                sub_type: None,
                skip_history: true,
                initial_link_share: InitialLinkShare::Exact(LinkShareState::Off),
            },
            file,
            base64::engine::general_purpose::STANDARD.encode(digest),
        )
        .await?;
        let category = if kind.mime_type().starts_with("image/") {
            meta_messaging::domain::events::MediaKind::Image
        } else if kind.mime_type().starts_with("audio/") {
            meta_messaging::domain::events::MediaKind::Audio
        } else if kind.mime_type().starts_with("video/") {
            meta_messaging::domain::events::MediaKind::Video
        } else {
            meta_messaging::domain::events::MediaKind::Document
        };
        Ok(UploadedAttachment {
            document_id: id,
            filename,
            kind: category,
        })
    }
    async fn receive(
        &self,
        c: &Connection,
        m: &IncomingMessage,
        files: Vec<Option<MediaBytes>>,
    ) -> PortResult<()> {
        if files.len() != m.media.len() || files.len() > 10 {
            return Err(MessagingError::Invalid(
                "attachment count does not match provider message",
            )
            .into());
        }
        let repo = PgMessagingRepository::new(self.pool.clone());
        let (channel, message) = repo.message_target(c.id, m.message_id.as_str()).await?;
        let participants = PgChannelsRepo::new(self.pool.clone())
            .get_participants(channel)
            .await
            .map_err(error)?;
        let owner = MacroUserIdStr::try_from(
            participants
                .into_iter()
                .find(|p| p.role == channels::domain::models::ParticipantRole::Owner)
                .ok_or(MessagingError::Forbidden)?
                .user_id,
        )
        .map_err(|_| MessagingError::Forbidden)?;
        let stored = PgMessageRepository::new(self.pool.clone())
            .get(&MessageParent::Channel(channel), message)
            .await
            .map_err(error)?
            .ok_or(MessagingError::NotFound)?;
        if stored.deleted_at.is_some() {
            return Err(MessagingError::NotFound.into());
        }
        if m.direction == meta_messaging::domain::events::Direction::Outbound
            && stored.sender_id.as_user().is_some()
        {
            // An early echo has since been matched to Macro's acceptance. Its
            // source preview must not duplicate the deliberate send's document.
            return Ok(());
        }
        let mut first_error = None;
        let mut complete = true;
        for (index, file) in files.into_iter().enumerate() {
            let Some(file) = file else {
                complete = false;
                continue;
            };
            let kind = match received_type(&file) {
                Ok(kind) => kind,
                Err(error) => {
                    first_error.get_or_insert(error.into());
                    continue;
                }
            };
            let digest = Sha256::digest(&file.bytes);
            let sha = digest
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            let reservation = repo
                .reserve_attachment(c.id, m.message_id.as_str(), index as i16, &sha)
                .await?;
            if reservation.lease.is_none() {
                continue;
            }
            let result: PortResult<()> = async {
                let source = self
                    .access
                    .generate_entity_access_receipt::<MemberParticipantRole>(
                        &owner.0,
                        None,
                        &channel.to_string(),
                        EntityType::Channel,
                    )
                    .await
                    .map_err(access_error)?;
                let name = document_name(&file.filename);
                self.store_private_file(
                    source,
                    NewDocument {
                        id: Some(reservation.document_id),
                        sha,
                        document_name: name,
                        file_type: Some(kind),
                        project_id: None,
                        team_id: None,
                        share_with_team: false,
                        created_at: Some(m.timestamp),
                        sub_type: None,
                        skip_history: true,
                        initial_link_share: InitialLinkShare::Exact(LinkShareState::Off),
                    },
                    file,
                    base64::engine::general_purpose::STANDARD.encode(digest),
                )
                .await?;
                let mut tx = self.pool.begin().await.map_err(error)?;
                PgMessageRepository::attach_external_file_in(
                    &mut tx,
                    channel,
                    message,
                    c.id,
                    m.message_id.as_str(),
                    reservation.document_id,
                )
                .await
                .map_err(error)?;
                self.share(owner.clone(), channel, reservation.document_id)
                    .await?;
                PgMessagingRepository::finish_attachment_in(
                    &mut tx,
                    c.id,
                    m.message_id.as_str(),
                    &reservation,
                )
                .await?;
                tx.commit().await.map_err(error)?;
                Ok(())
            }
            .await;
            if let Err(error) = result {
                repo.release_attachment(c.id, m.message_id.as_str(), &reservation)
                    .await?;
                if matches!(error.current_context(), MessagingError::Conflict) {
                    return Err(error);
                }
                first_error.get_or_insert(error);
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        if !complete {
            return Ok(());
        }
        let mut tx = self.pool.begin().await.map_err(error)?;
        if !PgMessagingRepository::received_media_open_in(&mut tx, c.id, m.message_id.as_str())
            .await?
        {
            return Ok(());
        }
        PgMessageRepository::external_media_notice_in(
            &mut tx,
            channel,
            message,
            c.id,
            m.message_id.as_str(),
            &render_message_content(m),
        )
        .await
        .map_err(error)?;
        PgMessagingRepository::media_state_in(&mut tx, c.id, m.message_id.as_str(), true).await?;
        tx.commit().await.map_err(error)
    }

    #[tracing::instrument(skip_all, fields(channel_id = %channel, document_id = %document), err)]
    async fn read(&self, user: &str, channel: Uuid, document: Uuid) -> PortResult<MediaBytes> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<MemberParticipantRole>(
                &user.0,
                None,
                &channel.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        let access = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user.0,
                None,
                &document.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(access_error)?;
        let basic = self
            .documents
            .internal_get_basic_document(&document.to_string())
            .await
            .map_err(error)?;
        let kind = basic
            .file_type
            .as_deref()
            .and_then(|s| FileType::from_str(s).ok())
            .ok_or(MessagingError::Invalid("attachment type is unavailable"))?;
        let location = self
            .documents
            .get_document_location(
                &basic,
                access,
                LocationQueryParams {
                    document_version_id: None,
                    get_converted_docx_url: Some(false),
                },
            )
            .await
            .map_err(error)?;
        let LocationResponseV3::PresignedUrl {
            presigned_url,
            content,
            ..
        } = location
        else {
            return Err(MessagingError::Invalid(
                "choose an uploaded image, audio, video or PDF file",
            )
            .into());
        };
        if content.state != DocumentContentState::Ready {
            return Err(MessagingError::Invalid("attachment upload has not finished").into());
        }
        let bytes = self.read_url(&presigned_url).await?;
        let file = MediaBytes {
            filename: format!("{}.{}", basic.document_name, kind.as_str()),
            mime_type: kind.mime_type().into(),
            bytes,
        };
        received_type(&file)?;
        // The private read can outlive either grant. Do not enqueue or stage
        // bytes whose document/channel access was revoked during that I/O.
        self.access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user.0,
                None,
                &document.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(access_error)?;
        self.access
            .generate_entity_access_receipt::<MemberParticipantRole>(
                &user.0,
                None,
                &channel.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        Ok(file)
    }

    #[tracing::instrument(skip_all, fields(channel_id = %channel, document_id = %document), err)]
    async fn prepare(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
        file: MediaBytes,
    ) -> PortResult<OutboundMedia> {
        let user = MacroUserIdStr::try_from(user).map_err(|_| MessagingError::Forbidden)?;
        let repo = PgMessagingRepository::new(self.pool.clone());
        let conversation = repo.conversation(channel).await?;
        if conversation.is_none() {
            self.access
                .generate_entity_access_receipt::<MemberParticipantRole>(
                    &user.0,
                    None,
                    &channel.to_string(),
                    EntityType::Channel,
                )
                .await
                .map_err(access_error)?;
            return Ok(OutboundMedia { file, url: None });
        }
        let conversation = conversation.ok_or(MessagingError::NotFound)?;
        let connection = repo
            .connection(conversation.connection_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let url = if connection.provider == meta_messaging::domain::models::Provider::Instagram {
            // Access may have changed during the read. Verify it again before
            // creating any externally fetchable copy of these native bytes.
            Some(
                temporary_url(
                    &*self.access,
                    self.temporary_media
                        .as_deref()
                        .ok_or(MessagingError::Unavailable)?,
                    &user,
                    document,
                    &file,
                )
                .await?,
            )
        } else {
            None
        };
        Ok(OutboundMedia { file, url })
    }

    async fn attach_sent(
        &self,
        work: &SendWork,
        c: &Connection,
        provider_id: &ProviderId,
    ) -> PortResult<()> {
        let ReplyContent::Media {
            document_id,
            ref caption,
            ..
        } = work.request.message
        else {
            return Ok(());
        };
        let repo = PgMessagingRepository::new(self.pool.clone());
        let (channel, message) = repo.message_target(c.id, provider_id.as_str()).await?;
        let user = MacroUserIdStr::try_from(work.user_id.clone())
            .map_err(|_| MessagingError::Forbidden)?;
        if repo.media_stored(c.id, provider_id).await? {
            return Ok(());
        }
        match self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user.0,
                None,
                &document_id.to_string(),
                EntityType::Document,
            )
            .await
        {
            Ok(_) => {}
            Err(
                entity_access::domain::models::AccessError::Unavailable(_)
                | entity_access::domain::models::AccessError::Internal(_),
            ) => return Err(MessagingError::Unavailable.into()),
            Err(_) => {
                let mut tx = self.pool.begin().await.map_err(error)?;
                let body = format!(
                    "{}\n\n> The reply was accepted by the provider, but its Macro attachment is no longer accessible.",
                    plain_markdown(caption.as_deref().unwrap_or_default())
                );
                PgMessageRepository::external_media_notice_in(
                    &mut tx,
                    channel,
                    message,
                    c.id,
                    provider_id.as_str(),
                    &body,
                )
                .await
                .map_err(error)?;
                PgMessagingRepository::media_state_in(&mut tx, c.id, provider_id.as_str(), false)
                    .await?;
                return tx.commit().await.map_err(error);
            }
        }
        let mut tx = self.pool.begin().await.map_err(error)?;
        PgMessageRepository::attach_external_file_in(
            &mut tx,
            channel,
            message,
            c.id,
            provider_id.as_str(),
            document_id,
        )
        .await
        .map_err(error)?;
        self.share(user, channel, document_id).await?;
        // Replace the temporary import notice only once the native file exists.
        // The original caption is authoritative, including an intentionally empty one.
        PgMessageRepository::external_media_notice_in(
            &mut tx,
            channel,
            message,
            c.id,
            provider_id.as_str(),
            &plain_markdown(caption.as_deref().unwrap_or_default()),
        )
        .await
        .map_err(error)?;
        PgMessagingRepository::media_state_in(&mut tx, c.id, provider_id.as_str(), true).await?;
        tx.commit().await.map_err(error)
    }
}

/// A customer-supplied name must not make an otherwise valid file permanently unavailable.
fn document_name(filename: &str) -> String {
    let stem = filename.rsplit_once('.').map_or(filename, |(name, _)| name);
    if stem.trim().is_empty() {
        return "attachment".to_owned();
    }
    stem.graphemes(true)
        .take(MAX_DOCUMENT_NAME_GRAPHEMES)
        .collect()
}

fn received_type(file: &MediaBytes) -> Result<FileType, MessagingError> {
    if file.filename.trim().is_empty()
        || file.filename.len() > 255
        || file.filename.contains(['/', '\\'])
        || file.filename.chars().any(char::is_control)
    {
        return Err(MessagingError::Invalid("attachment filename is invalid"));
    }
    let b = &file.bytes;
    if b.is_empty() || b.len() > MAX_FILE_BYTES {
        return Err(MessagingError::Invalid(
            "attachment is empty or exceeds the 32 MiB limit",
        ));
    }
    let (extension, valid) = match file.mime_type.split(';').next().unwrap_or("").trim() {
        "image/jpeg" => ("jpg", b.starts_with(&[0xff, 0xd8, 0xff])),
        "image/png" => ("png", b.starts_with(b"\x89PNG\r\n\x1a\n")),
        "image/gif" => ("gif", b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a")),
        "image/webp" => (
            "webp",
            b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP"),
        ),
        "application/pdf" => ("pdf", b.starts_with(b"%PDF-")),
        "audio/ogg" => ("ogg", b.starts_with(b"OggS")),
        "audio/wav" | "audio/x-wav" => (
            "wav",
            b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WAVE"),
        ),
        "audio/mpeg" => (
            "mp3",
            b.starts_with(b"ID3")
                || b.get(..2)
                    .is_some_and(|h| h[0] == 0xff && h[1] & 0xe0 == 0xe0),
        ),
        "audio/aac" => (
            "aac",
            b.get(..2)
                .is_some_and(|h| h[0] == 0xff && h[1] & 0xf0 == 0xf0),
        ),
        "audio/mp4" | "audio/x-m4a" => ("m4a", b.get(4..8) == Some(b"ftyp")),
        "video/mp4" => ("mp4", b.get(4..8) == Some(b"ftyp")),
        "video/quicktime" => ("mov", b.get(4..8) == Some(b"ftyp")),
        "video/webm" => ("webm", b.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])),
        "text/plain" => ("txt", std::str::from_utf8(b).is_ok() && !b.contains(&0)),
        _ => {
            return Err(MessagingError::Invalid(
                "unsupported attachment format; view it in the original app",
            ));
        }
    };
    if !valid {
        return Err(MessagingError::Invalid(
            "attachment bytes do not match its declared format",
        ));
    }
    FileType::from_str(extension)
        .map_err(|_| MessagingError::Invalid("unsupported attachment format"))
}

#[cfg(test)]
mod test;
