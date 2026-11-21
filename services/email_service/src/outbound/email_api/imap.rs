//! Link-scoped HTTP gateway for the stateful IMAP engine.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use email::domain::mailbox::{
    MailboxGateway, MailboxKey,
    credentials::{CredentialHealth, MailboxCredentialHealthRepository},
    projection::MailboxAttachmentAccess,
};
use email_api_client::domain::models::*;
use imap_service_client::{self as models, ImapServiceClient};

mod drafts;
mod mime;
#[cfg(test)]
mod test;

/// The IMAP adapter uses a fenced mailbox binding, never an OAuth token.
#[derive(Clone)]
pub struct ImapMailboxGateway {
    pub client: ImapServiceClient,
    pub health: email::outbound::mailbox_pg::PgMailboxSync,
}

pub(super) fn binding(mailbox: MailboxKey) -> models::Binding {
    models::Binding {
        link_id: mailbox.link_id,
        sync_generation: mailbox.sync_generation,
        grant_generation: mailbox.grant_generation,
    }
}

impl ImapMailboxGateway {
    pub async fn record<T>(
        &self,
        mailbox: MailboxKey,
        result: Result<T, models::Error>,
    ) -> Result<T, EmailApiError> {
        if result.is_ok() || matches!(result, Err(models::Error::CredentialsRejected)) {
            self.health
                .record(
                    MailboxAccess {
                        link_id: mailbox.link_id,
                        sync_generation: mailbox.sync_generation,
                        grant_generation: mailbox.grant_generation,
                    },
                    if result.is_ok() {
                        CredentialHealth::Available(Vec::new())
                    } else {
                        CredentialHealth::ReauthorizationRequired
                    },
                )
                .await
                .map_err(|_| EmailApiError::CredentialsUnavailable {
                    message: "could not persist IMAP credential health".into(),
                })?;
        }
        result.map_err(error)
    }

    pub(crate) async fn mime(
        &self,
        mailbox: MailboxKey,
        id: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        let result = self.client.mime(binding(mailbox), id).await;
        self.record(mailbox, result).await
    }

    pub(crate) async fn recent(
        &self,
        mailbox: MailboxKey,
        limit: u16,
    ) -> Result<Vec<models_email::service::message::Message>, EmailApiError> {
        let result = self
            .client
            .recent_inbox(binding(mailbox), u32::from(limit))
            .await;
        let sources = self.record(mailbox, result).await?;
        let messages = sources
            .into_iter()
            .map(|source| {
                let bytes =
                    STANDARD
                        .decode(&source.mime_base64)
                        .map_err(|_| EmailApiError::Transient {
                            message: "IMAP service returned invalid message bytes".into(),
                        })?;
                Ok(mime::parse(mailbox.link_id, &source, &bytes)?.message)
            })
            .collect::<Result<Vec<_>, EmailApiError>>()?;
        Ok(messages)
    }
}

impl MailboxGateway for ImapMailboxGateway {
    #[tracing::instrument(skip_all, fields(mailbox.link_id = %mailbox.link_id), err)]
    async fn folders(&self, mailbox: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        let result = self.client.folders(binding(mailbox)).await;
        let folders = self
            .record(mailbox, result)
            .await?
            .into_iter()
            .map(|folder| {
                Ok(MailFolder {
                    sync_enabled: folder.sync_enabled,
                    id: ProviderId::new(folder.id)?,
                    parent_id: folder.parent_id.map(ProviderId::new).transpose()?,
                    name: folder.name,
                    role: match folder.role {
                        models::FolderRole::Inbox => FolderRole::Inbox,
                        models::FolderRole::Sent => FolderRole::Sent,
                        models::FolderRole::Drafts => FolderRole::Drafts,
                        models::FolderRole::Archive => FolderRole::Archive,
                        models::FolderRole::Trash => FolderRole::Trash,
                        models::FolderRole::Junk => FolderRole::Junk,
                        models::FolderRole::Other => FolderRole::Other,
                    },
                    has_children: folder.has_children,
                    total_items: folder.total_items,
                })
            })
            .collect::<Result<Vec<_>, EmailApiError>>()?;
        Ok(MailFolderCatalog::Folders(folders))
    }
    #[tracing::instrument(skip_all, fields(mailbox.link_id = %mailbox.link_id), err)]
    async fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
        _start: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        let result = self
            .client
            .changes(
                binding(mailbox),
                folder.as_str(),
                position.map(StreamToken::expose),
            )
            .await;
        let page = self.record(mailbox, result).await?;
        let token = StreamToken::new(page.position);
        Ok(MailboxChangePage {
            changed: page
                .changed
                .into_iter()
                .map(ProviderId::new)
                .collect::<Result<_, _>>()?,
            removed: page
                .removed
                .into_iter()
                .map(ProviderId::new)
                .collect::<Result<_, _>>()?,
            position: if page.has_more {
                StreamPosition::Continue(token)
            } else {
                StreamPosition::Checkpoint(token)
            },
            reader_revision: page.reader_revision,
        })
    }
    #[tracing::instrument(skip_all, fields(mailbox.link_id = %mailbox.link_id), err)]
    async fn message(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        let result = self.client.message(binding(mailbox), id.as_str()).await;
        let source = match self.record(mailbox, result).await {
            Ok(Some(source)) => source,
            Ok(None) | Err(EmailApiError::NotFound) => return Ok(None),
            Err(error) => return Err(error),
        };
        let bytes = STANDARD
            .decode(&source.mime_base64)
            .map_err(|_| EmailApiError::Transient {
                message: "IMAP service returned invalid message bytes".into(),
            })?;
        let content = mime::parse(mailbox.link_id, &source, &bytes)?;
        let folder = ProviderId::new(source.folder_id.clone())?;
        let role = MailFolder::effective_role(folders, Some(&folder));
        let has_flag = |value: &str| {
            source
                .flags
                .iter()
                .any(|flag| flag.eq_ignore_ascii_case(value))
        };
        Ok(Some(MailboxMessage {
            draft_correlation: source.draft_correlation,
            content,
            calendar_parts_unavailable: false,
            state: MailboxState {
                is_read: has_flag("\\Seen"),
                is_flagged: has_flag("\\Flagged"),
                is_draft: has_flag("\\Draft"),
                in_inbox: role == FolderRole::Inbox,
                in_trash: role == FolderRole::Trash,
                in_junk: role == FolderRole::Junk,
                attention: Attention::Unknown,
            },
            folder_id: Some(folder),
            tags: source.tags,
            version: Some(source.version),
        }))
    }
    async fn admitted_requests(&self, _mailbox: MailboxKey) -> Option<u64> {
        None
    }
}

impl email::domain::mailbox::commands::MailboxCommandGateway for ImapMailboxGateway {
    async fn organization(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxOrganization>, EmailApiError> {
        let result: Result<Option<models::Message>, models::Error> = self
            .client
            .operation(
                binding(mailbox),
                &models::Operation::Organization {
                    id: message.as_str().to_owned(),
                },
            )
            .await;
        let Some(source) = self.record(mailbox, result).await? else {
            return Ok(None);
        };
        let folder = ProviderId::new(source.folder_id)?;
        let role = MailFolder::effective_role(folders, Some(&folder));
        let has_flag = |value: &str| {
            source
                .flags
                .iter()
                .any(|flag| flag.eq_ignore_ascii_case(value))
        };
        Ok(Some(MailboxOrganization {
            state: MailboxState {
                is_read: has_flag("\\Seen"),
                is_flagged: has_flag("\\Flagged"),
                is_draft: has_flag("\\Draft"),
                in_inbox: role == FolderRole::Inbox,
                in_trash: role == FolderRole::Trash,
                in_junk: role == FolderRole::Junk,
                attention: Attention::Unknown,
            },
            folder_id: Some(folder),
            tags: source.tags,
            version: Some(source.version),
            is_sent: source.is_sent,
        }))
    }
    #[tracing::instrument(skip_all, fields(mailbox.link_id = %mailbox.link_id), err)]
    async fn apply(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> Result<MessageWriteReceipt, EmailApiError> {
        let request = models::ActionRequest {
            action: serde_json::to_value(action).map_err(|_| EmailApiError::Permanent {
                message: "invalid IMAP action".into(),
            })?,
            expected_version: expected_version.map(str::to_owned),
        };
        let result = self
            .client
            .apply(
                binding(mailbox),
                message.as_str(),
                request.action,
                request.expected_version.as_deref(),
            )
            .await;
        let receipt = self.record(mailbox, result).await?;
        Ok(MessageWriteReceipt {
            id: ProviderId::new(receipt.id)?,
            version: receipt.version,
        })
    }
}

impl MailboxAttachmentAccess for ImapMailboxGateway {
    async fn download(
        &self,
        mailbox: MailboxKey,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, email::domain::mailbox::MailboxError> {
        let result = self
            .client
            .attachment(binding(mailbox), message_id, attachment_id)
            .await;
        Ok(self.record(mailbox, result).await?)
    }
}

pub(crate) fn error(error: models::Error) -> EmailApiError {
    match error {
        models::Error::CredentialsRejected => EmailApiError::AuthRequired,
        models::Error::CredentialsUnavailable => EmailApiError::CredentialsUnavailable {
            message: "IMAP credentials are temporarily unavailable".into(),
        },
        models::Error::Forbidden => EmailApiError::Forbidden,
        models::Error::NotFound => EmailApiError::NotFound,
        models::Error::Conflict => EmailApiError::Conflict,
        models::Error::CursorOutdated => EmailApiError::OutdatedCursor,
        models::Error::ConnectionUnavailable
        | models::Error::DnsUnavailable
        | models::Error::TcpUnavailable
        | models::Error::TlsUnavailable
        | models::Error::ConnectionTimedOut => EmailApiError::Transient {
            message: "IMAP service is temporarily unavailable".into(),
        },
        models::Error::SendRejected => EmailApiError::SendRejected {
            reason: SendRejectionReason::ProviderRejected,
            message: "SMTP server refused submission".into(),
        },
        models::Error::SendUnavailable => EmailApiError::SendRejected {
            reason: SendRejectionReason::ConnectionUnavailable,
            message: "SMTP connection unavailable; no message was submitted".into(),
        },
        models::Error::Throttled => EmailApiError::RateLimited {
            retry_after: Some(std::time::Duration::from_secs(60)),
            origin: RateLimitOrigin::Provider { concurrency: false },
        },
        models::Error::Invalid => EmailApiError::Permanent {
            message: "IMAP service rejected the request".into(),
        },
    }
}
