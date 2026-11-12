use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

use crate::client::{SlackClient, invalid_request, record_error};
use crate::error::SlackError;
use crate::ids::{ChannelId, FileId, MessageTs};
use crate::method::SlackMethod;
use crate::models::File;

/// A file to share into a conversation.
#[derive(Clone, Debug)]
pub struct FileUpload {
    /// The conversation.
    pub channel: ChannelId,
    /// Share it as a reply in this thread.
    pub thread_ts: Option<MessageTs>,
    /// File name.
    pub filename: String,
    /// Title; defaults to the file name.
    pub title: Option<String>,
    /// Message text posted with the file.
    pub initial_comment: Option<String>,
    /// The bytes.
    pub body: Bytes,
}

/// A shared file.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct UploadedFile {
    /// The file.
    pub id: FileId,
    /// Its title.
    pub title: Option<String>,
}

#[derive(Deserialize)]
struct UploadTarget {
    upload_url: Url,
    file_id: FileId,
}

#[derive(Serialize)]
struct CompletedFile<'upload> {
    id: &'upload FileId,
    title: &'upload str,
}

#[derive(Deserialize)]
struct CompletedUpload {
    files: Vec<UploadedFile>,
}

#[derive(Deserialize)]
struct FileEnvelope {
    file: File,
}

impl SlackClient {
    /// Shares a file: `files.getUploadURLExternal`, the byte upload, then
    /// `files.completeUploadExternal` into the conversation.
    pub async fn upload_file(&self, upload: &FileUpload) -> Result<UploadedFile, SlackError> {
        let target: UploadTarget = self
            .call(
                SlackMethod::FilesGetUploadUrlExternal,
                vec![
                    ("filename", upload.filename.clone()),
                    ("length", upload.body.len().to_string()),
                ],
            )
            .await?;
        self.upload_bytes(&target.upload_url, upload.body.clone())
            .await?;

        let method = SlackMethod::FilesCompleteUploadExternal;
        let title = upload.title.as_deref().unwrap_or(&upload.filename);
        let files = serde_json::to_string(&[CompletedFile {
            id: &target.file_id,
            title,
        }])
        .map_err(|source| SlackError::Decode { method, source })?;
        let mut form = vec![("files", files), ("channel_id", upload.channel.to_string())];
        if let Some(thread_ts) = &upload.thread_ts {
            form.push(("thread_ts", thread_ts.to_string()));
        }
        if let Some(comment) = &upload.initial_comment {
            form.push(("initial_comment", comment.clone()));
        }
        let completed: CompletedUpload = self.call(method, form).await?;
        completed
            .files
            .into_iter()
            .next()
            .ok_or_else(|| invalid_request(method, "Slack completed the upload without a file"))
    }

    /// Posts the bytes to the presigned upload URL. The URL carries its own
    /// authorization, so no session credentials go with it.
    async fn upload_bytes(&self, url: &Url, body: Bytes) -> Result<(), SlackError> {
        let method = SlackMethod::FileUploadBytes;
        if !self.is_slack_host(url) {
            return Err(invalid_request(method, "upload URL is not on a Slack host"));
        }
        let span = tracing::info_span!(
            "slack.api",
            slack.method = method.as_str(),
            slack.team_id = %self.workspace().team_id,
            http.response.status_code = Empty,
            slack.retry_count = Empty,
            slack.error = Empty,
            otel.status_code = Empty,
            file.size = body.len(),
        );
        span.record("slack.retry_count", 0);
        let request = self.http().post(url.clone()).body(body);
        async move {
            let span = tracing::Span::current();
            let outcome = match request.send().await {
                Err(source) => Err(SlackError::Transport { method, source }),
                Ok(response) if response.status().is_success() => {
                    span.record("http.response.status_code", response.status().as_u16());
                    Ok(())
                }
                Ok(response) => Err(SlackError::HttpStatus {
                    method,
                    status: response.status().as_u16(),
                }),
            };
            if let Err(error) = &outcome {
                record_error(&span, error);
            }
            outcome
        }
        .instrument(span)
        .await
    }

    /// `files.info`: full metadata, needed for Slack Connect files that
    /// arrive as `file_access: check_file_info`.
    pub async fn file_info(&self, file: &FileId) -> Result<File, SlackError> {
        self.call::<FileEnvelope>(SlackMethod::FilesInfo, vec![("file", file.to_string())])
            .await
            .map(|envelope| envelope.file)
    }
}
