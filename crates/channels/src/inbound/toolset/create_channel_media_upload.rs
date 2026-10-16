//! Reserve a direct upload for an image or video to attach to a channel message.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::types::ChannelAttachmentKind;
use crate::domain::media_upload::{
    ChannelMediaKind, ChannelMediaUploadError, ChannelMediaUploads, MEDIA_UPLOAD_URL_TTL_SECONDS,
    NewChannelMediaUpload, StaticMediaStore,
};

/// Service context for reserving channel media uploads.
pub struct ChannelMediaUploadToolContext<S> {
    /// Reserves uploads in static-file storage.
    pub uploads: Arc<ChannelMediaUploads<S>>,
}

impl<S> Clone for ChannelMediaUploadToolContext<S> {
    fn clone(&self) -> Self {
        Self {
            uploads: self.uploads.clone(),
        }
    }
}

impl<S: StaticMediaStore> ChannelMediaUploadToolContext<S> {
    /// Reserve uploads in `store`.
    pub fn new(store: S) -> Self {
        Self {
            uploads: Arc::new(ChannelMediaUploads::new(store)),
        }
    }
}

/// Reserve a direct upload for one channel image or video.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateChannelMediaUpload",
    description = "Reserve a direct upload for an image or video to attach to a channel message; use this for media too large to pass inline, such as screen recordings. Returns an uploadUrl: immediately PUT the raw file bytes to it from your shell with the returned contentType as the Content-Type header (see uploadCommand), then call SendChannelMessage with an attachment whose id is attachmentId and whose kind is the returned kind. The URL must be used within 2 minutes; call again for a fresh one if it expires. Only images and videos are accepted; attach other files by uploading them as documents and passing the document ID."
)]
pub struct CreateChannelMediaUpload {
    #[schemars(
        description = "Filename including its extension, for example demo.mp4. Do not include a directory path."
    )]
    /// Filename, including its extension.
    pub file_name: String,
    #[serde(default)]
    #[schemars(
        description = "MIME type such as video/mp4 or image/png. Omit to infer it from the fileName extension."
    )]
    /// MIME type, when the extension does not identify it.
    pub content_type: Option<String>,
}

/// A reserved upload slot for one media file.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelMediaUploadResponse {
    /// Attachment ID to pass to SendChannelMessage after the upload succeeds.
    pub attachment_id: Uuid,
    /// Attachment kind to pass to SendChannelMessage.
    pub kind: ChannelAttachmentKind,
    /// Presigned URL that accepts one HTTP PUT of the raw file bytes.
    pub upload_url: String,
    /// Content-Type header value the PUT must send; the URL is signed for it.
    pub content_type: String,
    /// Seconds before the upload URL stops accepting new uploads.
    pub expires_in_seconds: u64,
    /// A curl command that performs the upload; replace <path-to-file>.
    pub upload_command: String,
}

impl ToolAnnotated for CreateChannelMediaUpload {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create channel media upload");
}

#[async_trait]
impl<S: StaticMediaStore> AsyncTool<ChannelMediaUploadToolContext<S>> for CreateChannelMediaUpload {
    type Output = CreateChannelMediaUploadResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelMediaUploadToolContext<S>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let upload = service_context
            .uploads
            .reserve(
                &request_context.user_id,
                NewChannelMediaUpload {
                    file_name: self.file_name.clone(),
                    content_type: self.content_type.clone(),
                },
            )
            .await
            .map_err(|error| ToolCallError {
                description: match &error {
                    ChannelMediaUploadError::Invalid(message) => message.clone(),
                    ChannelMediaUploadError::Storage(_) => {
                        "failed to reserve the upload; try again".to_string()
                    }
                },
                internal_error: error.into(),
            })?;

        Ok(CreateChannelMediaUploadResponse {
            attachment_id: upload.attachment_id,
            kind: match upload.kind {
                ChannelMediaKind::Image => ChannelAttachmentKind::Image,
                ChannelMediaKind::Video => ChannelAttachmentKind::Video,
            },
            upload_command: format!(
                "curl --fail -X PUT -H 'Content-Type: {}' --upload-file <path-to-file> '{}'",
                upload.content_type, upload.upload_url
            ),
            upload_url: upload.upload_url,
            content_type: upload.content_type,
            expires_in_seconds: MEDIA_UPLOAD_URL_TTL_SECONDS,
        })
    }
}
