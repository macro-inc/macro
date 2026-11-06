//! Reserve upload slots for images and videos that will be attached to channel
//! messages. The caller uploads the bytes straight to object storage, so the
//! file never travels through the service that issued the slot.

#[cfg(test)]
mod test;

use std::{future::Future, str::FromStr};

use macro_user_id::user_id::MacroUserIdStr;
use model_file_type::FileType;
use uuid::Uuid;

/// How long a reserved upload URL accepts a new upload.
pub const MEDIA_UPLOAD_URL_TTL_SECONDS: u64 = 120;

/// Media that renders inline in a channel message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelMediaKind {
    /// An inline image.
    Image,
    /// An inline, playable video.
    Video,
}

impl ChannelMediaKind {
    /// The message attachment entity type for this kind of media.
    pub fn attachment_entity_type(self) -> &'static str {
        match self {
            Self::Image => "static/image",
            Self::Video => "static/video",
        }
    }

    fn of_content_type(content_type: &str) -> Option<Self> {
        let essence = content_type.split(';').next()?.trim();
        if essence.starts_with("image/") {
            Some(Self::Image)
        } else if essence.starts_with("video/") {
            Some(Self::Video)
        } else {
            None
        }
    }
}

/// A request to upload one image or video for a channel message.
#[derive(Debug, Clone)]
pub struct NewChannelMediaUpload {
    /// Filename, including its extension.
    pub file_name: String,
    /// MIME type, when the extension does not identify it.
    pub content_type: Option<String>,
}

/// A media file whose storage slot the static-file store has created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticMediaReservation {
    /// Static file ID, used as the message attachment ID.
    pub file_id: Uuid,
    /// Presigned URL that accepts one HTTP PUT of the file bytes.
    pub upload_url: String,
}

/// A reserved upload, ready for the caller to PUT the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMediaUpload {
    /// Attachment ID to send with the message once the bytes are uploaded.
    pub attachment_id: Uuid,
    /// How the attachment renders.
    pub kind: ChannelMediaKind,
    /// Presigned URL that accepts one HTTP PUT of the file bytes.
    pub upload_url: String,
    /// Content type the PUT must declare; the URL is signed for it.
    pub content_type: String,
}

/// Why a media upload could not be reserved.
#[derive(Debug, thiserror::Error)]
pub enum ChannelMediaUploadError {
    /// The request was malformed or named a file that is not media.
    #[error("{0}")]
    Invalid(String),
    /// The static-file store failed.
    #[error("failed to reserve the upload")]
    Storage(#[source] anyhow::Error),
}

/// Creates static-file storage slots owned by a user.
pub trait StaticMediaStore: Send + Sync + 'static {
    /// Reserve a slot for `file_name`, owned by `owner`, that accepts an upload
    /// declaring `content_type`.
    fn reserve(
        &self,
        owner: &MacroUserIdStr<'_>,
        file_name: &str,
        content_type: &str,
    ) -> impl Future<Output = anyhow::Result<StaticMediaReservation>> + Send;
}

/// Reserves media uploads for channel message attachments.
pub struct ChannelMediaUploads<S> {
    store: S,
}

impl<S: StaticMediaStore> ChannelMediaUploads<S> {
    /// Use `store` for the reserved files.
    pub fn new(store: S) -> Self {
        Self { store }
    }

    /// Reserve an upload for one image or video owned by `owner`. Other files
    /// are rejected: they belong in documents, not inline media.
    #[tracing::instrument(skip_all, err)]
    pub async fn reserve(
        &self,
        owner: &MacroUserIdStr<'_>,
        upload: NewChannelMediaUpload,
    ) -> Result<ChannelMediaUpload, ChannelMediaUploadError> {
        let file_name = upload.file_name.trim();
        if file_name.is_empty()
            || file_name.contains(['/', '\\'])
            || file_name.chars().any(char::is_control)
        {
            return Err(ChannelMediaUploadError::Invalid(
                "fileName must be a filename without directory components".to_string(),
            ));
        }
        let content_type = match upload.content_type.as_deref().map(str::trim) {
            Some(content_type) if !content_type.is_empty() => content_type.to_ascii_lowercase(),
            _ => content_type_from_extension(file_name).ok_or_else(|| {
                ChannelMediaUploadError::Invalid(
                    "cannot infer the media type from fileName; pass contentType, for example video/mp4"
                        .to_string(),
                )
            })?,
        };
        let kind = ChannelMediaKind::of_content_type(&content_type).ok_or_else(|| {
            ChannelMediaUploadError::Invalid(format!(
                "{content_type} is not an image or video; upload other files as documents and attach the document ID"
            ))
        })?;

        let reservation = self
            .store
            .reserve(owner, file_name, &content_type)
            .await
            .map_err(ChannelMediaUploadError::Storage)?;

        Ok(ChannelMediaUpload {
            attachment_id: reservation.file_id,
            kind,
            upload_url: reservation.upload_url,
            content_type,
        })
    }
}

fn content_type_from_extension(file_name: &str) -> Option<String> {
    let (_, extension) = file_name.rsplit_once('.')?;
    FileType::from_str(extension)
        .ok()
        .map(|file_type| file_type.mime_type().to_string())
}
