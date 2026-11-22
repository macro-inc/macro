//! Typed internal client; mailbox ownership is authorized by the caller's domain.
#![deny(missing_docs)]

pub use imap_engine::domain::account_settings::{
    AccountMailSettings, FolderSetting, UpdateFolderSettings,
};
pub use imap_engine::domain::models::*;
use macro_user_id::{cowlike::ArcCowStr, email::Email};
use serde::{Serialize, de::DeserializeOwned};

/// API generated from the engine's utoipa document.
mod generated;
#[cfg(test)]
mod test;
use std::time::Duration;
use uuid::Uuid;

/// Reusable authenticated HTTP client for the engine's typed operations.
#[derive(Clone)]
pub struct ImapServiceClient {
    client: generated::Client,
    operation_class: OperationClass,
}
impl ImapServiceClient {
    /// Construct once with a typed service URL and service-owned internal key.
    pub fn new(base_url: String, internal_key: String) -> Result<Self, Error> {
        let url = reqwest::Url::parse(&base_url).map_err(|_| Error::Invalid)?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(Error::Invalid);
        }
        let mut headers = reqwest::header::HeaderMap::new();
        let mut key =
            reqwest::header::HeaderValue::from_str(&internal_key).map_err(|_| Error::Invalid)?;
        key.set_sensitive(true);
        headers.insert("x-internal-auth-key", key);
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(Self {
            client: generated::Client::new_with_client(base_url.trim_end_matches('/'), http),
            operation_class: OperationClass::Interactive,
        })
    }

    /// Classify trusted background callers without changing authentication or bindings.
    pub fn with_operation_class(mut self, class: OperationClass) -> Self {
        self.operation_class = class;
        self
    }
    /// Query catalog settings without accepting a password.
    #[tracing::instrument(skip_all, err)]
    pub async fn discover(&self, email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
        response(
            self.client
                .discover(&generated::types::DiscoveryRequest {
                    email: email.as_ref().to_owned(),
                })
                .await,
        )
        .await
    }
    /// Verify credentials and create a short-lived owner-bound token.
    #[tracing::instrument(skip_all, err)]
    pub async fn verify(&self, input: &VerifyRequest) -> Result<Verification, Error> {
        response(self.client.verify(input).await).await
    }
    /// Promote a verification into one link's credential binding.
    #[tracing::instrument(skip_all, fields(link_id = %link), err)]
    pub async fn connect(&self, link: Uuid, input: &ConnectRequest) -> Result<Binding, Error> {
        response(self.client.connect(&link, input).await).await
    }
    /// Idempotently disconnect this exact generation.
    #[tracing::instrument(skip_all, fields(link_id = %b.link_id), err)]
    pub async fn delete(&self, b: Binding) -> Result<(), Error> {
        response(
            self.client
                .disconnect(
                    &b.link_id,
                    &format!("{}.{}", b.sync_generation, b.grant_generation),
                )
                .await,
        )
        .await
    }
    /// Execute one closed, generated operation and decode its source model.
    #[tracing::instrument(skip_all, fields(link_id = %b.link_id), err)]
    pub async fn operation<T: DeserializeOwned>(
        &self,
        b: Binding,
        op: &Operation,
    ) -> Result<T, Error> {
        let value = response(
            self.client
                .operation(
                    &b.link_id,
                    Some(&self.operation_class),
                    &format!("{}.{}", b.sync_generation, b.grant_generation),
                    op,
                )
                .await,
        )
        .await?;
        serde_json::from_value(value).map_err(|_| Error::ConnectionUnavailable)
    }
    /// Read sanitized endpoints and account-scoped folder preferences.
    #[tracing::instrument(skip_all, fields(link_id = %b.link_id), err)]
    pub async fn account_mail_settings(&self, b: Binding) -> Result<AccountMailSettings, Error> {
        response(
            self.client
                .account_mail_settings(
                    &b.link_id,
                    &format!("{}.{}", b.sync_generation, b.grant_generation),
                )
                .await,
        )
        .await
    }
    /// Update folder routing against the version last observed by the owner.
    #[tracing::instrument(skip_all, fields(link_id = %b.link_id), err)]
    pub async fn update_mail_settings(
        &self,
        b: Binding,
        input: &UpdateFolderSettings,
    ) -> Result<AccountMailSettings, Error> {
        response(
            self.client
                .update_mail_settings(
                    &b.link_id,
                    &format!("{}.{}", b.sync_generation, b.grant_generation),
                    input,
                )
                .await,
        )
        .await
    }
    /// Enumerate physical folders.
    pub async fn folders(&self, b: Binding) -> Result<Vec<Folder>, Error> {
        self.operation(b, &Operation::Folders).await
    }
    /// Read one durable journal page.
    pub async fn changes(
        &self,
        b: Binding,
        folder: &str,
        position: Option<&str>,
    ) -> Result<ChangePage, Error> {
        self.operation(
            b,
            &Operation::Changes {
                folder: folder.into(),
                position: position.map(str::to_owned),
            },
        )
        .await
    }
    /// Read current message source and organization.
    pub async fn message(&self, b: Binding, id: &str) -> Result<Option<Message>, Error> {
        self.operation(b, &Operation::Message { id: id.into() })
            .await
    }
    /// Read newest incoming messages, bounded at 100.
    pub async fn recent_inbox(&self, b: Binding, limit: u32) -> Result<Vec<Message>, Error> {
        self.operation(b, &Operation::RecentInbox { limit }).await
    }
    /// Read one decoded attachment.
    pub async fn attachment(&self, b: Binding, id: &str, part: &str) -> Result<Vec<u8>, Error> {
        self.operation(
            b,
            &Operation::Attachment {
                id: id.into(),
                part: part.into(),
            },
        )
        .await
    }
    /// Read raw MIME; bytes are never interpreted as an HTTP target.
    pub async fn mime(&self, b: Binding, id: &str) -> Result<Vec<u8>, Error> {
        use base64::Engine;
        let m = self.message(b, id).await?.ok_or(Error::NotFound)?;
        base64::engine::general_purpose::STANDARD
            .decode(m.mime_base64)
            .map_err(|_| Error::ConnectionUnavailable)
    }
    /// Apply conditional desired state.
    pub async fn apply(
        &self,
        b: Binding,
        id: &str,
        action: serde_json::Value,
        expected_version: Option<&str>,
    ) -> Result<WriteReceipt, Error> {
        self.operation(
            b,
            &Operation::Apply {
                id: id.into(),
                request: ActionRequest {
                    action,
                    expected_version: expected_version.map(str::to_owned),
                },
            },
        )
        .await
    }
    /// Read a draft.
    pub async fn get_draft(&self, b: Binding, id: &str) -> Result<Option<Draft>, Error> {
        self.operation(b, &Operation::GetDraft { id: id.into() })
            .await
    }
    /// Find the one draft for a stable app identity.
    pub async fn find_drafts(&self, b: Binding, correlation: Uuid) -> Result<Vec<Draft>, Error> {
        self.operation(b, &Operation::FindDrafts { correlation })
            .await
    }
    /// Create a draft idempotently.
    pub async fn create_draft(&self, b: Binding, input: DraftInput) -> Result<Draft, Error> {
        self.operation(b, &Operation::CreateDraft { input }).await
    }
    /// Conditionally update a draft.
    pub async fn update_draft(
        &self,
        b: Binding,
        id: &str,
        input: DraftInput,
        version: &str,
    ) -> Result<Draft, Error> {
        self.operation(
            b,
            &Operation::UpdateDraft {
                id: id.into(),
                version: version.into(),
                input,
            },
        )
        .await
    }
    /// Conditionally delete a draft.
    pub async fn delete_draft(&self, b: Binding, id: &str, version: &str) -> Result<(), Error> {
        self.operation(
            b,
            &Operation::DeleteDraft {
                id: id.into(),
                version: version.into(),
            },
        )
        .await
    }
    /// Enumerate attachment metadata.
    pub async fn attachments(&self, b: Binding, id: &str) -> Result<Vec<DraftAttachment>, Error> {
        self.operation(b, &Operation::Attachments { id: id.into() })
            .await
    }
    /// Add one attachment keyed by its Content-ID.
    pub async fn add_attachment(
        &self,
        b: Binding,
        id: &str,
        input: AttachmentInput,
    ) -> Result<DraftAttachment, Error> {
        self.operation(
            b,
            &Operation::AddAttachment {
                id: id.into(),
                input,
            },
        )
        .await
    }
    /// Remove an attachment idempotently.
    pub async fn delete_attachment(
        &self,
        b: Binding,
        id: &str,
        attachment: &str,
    ) -> Result<(), Error> {
        self.operation(
            b,
            &Operation::DeleteAttachment {
                id: id.into(),
                attachment: attachment.into(),
            },
        )
        .await
    }
    /// Create a resumable upload.
    pub async fn create_upload(
        &self,
        b: Binding,
        id: &str,
        input: AttachmentInput,
    ) -> Result<UploadSession, Error> {
        self.operation(
            b,
            &Operation::CreateUpload {
                id: id.into(),
                input,
            },
        )
        .await
    }
    /// Inspect a resumable upload.
    pub async fn inspect_upload(&self, b: Binding, id: Uuid) -> Result<UploadSession, Error> {
        self.operation(b, &Operation::InspectUpload { id }).await
    }
    /// Append an ordered range; identical retries are accepted.
    pub async fn upload_range(
        &self,
        b: Binding,
        id: Uuid,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadSession, Error> {
        use base64::Engine;
        self.operation(
            b,
            &Operation::UploadRange {
                id,
                offset,
                total,
                bytes: base64::engine::general_purpose::STANDARD.encode(bytes),
            },
        )
        .await
    }
    /// Submit once. Unknown is retained until observation proves acceptance.
    pub async fn submit(&self, b: Binding, id: &str) -> Result<SubmissionOutcome, Error> {
        self.operation(b, &Operation::Submit { id: id.into() })
            .await
    }
    /// Request a fresh provider pass.
    pub async fn sync(&self, b: Binding) -> Result<(), Error> {
        self.operation(b, &Operation::Sync).await
    }
}

fn trace_request(request: &mut reqwest::Request) {
    macro_tower_layers::inject_trace_headers(request.headers_mut());
}

async fn response<T, E: Serialize>(
    result: Result<progenitor_client::ResponseValue<T>, progenitor_client::Error<E>>,
) -> Result<T, Error> {
    match result {
        Ok(value) => Ok(value.into_inner()),
        Err(progenitor_client::Error::ErrorResponse(value)) => {
            let body = serde_json::to_value(value.into_inner())
                .map_err(|_| Error::ConnectionUnavailable)?;
            Err(body
                .get("code")
                .cloned()
                .and_then(|code| serde_json::from_value(code).ok())
                .unwrap_or(Error::ConnectionUnavailable))
        }
        Err(progenitor_client::Error::UnexpectedResponse(value)) => {
            let body = value
                .json::<generated::types::ErrorBody>()
                .await
                .map_err(|_| Error::ConnectionUnavailable)?;
            Err(body.code)
        }
        Err(_) => Err(Error::ConnectionUnavailable),
    }
}
