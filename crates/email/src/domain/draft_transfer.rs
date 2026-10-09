//! Explicit sender changes preserve bytes and retire the original delivery identity.
use super::{
    attachment_access::AuthorizedAttachmentBytes,
    mailbox::{MailboxError, MailboxKey},
    models::{
        AttachmentDraft, EmailErr, ParsedAddresses, ResolvedDraftInput, UpsertedContacts,
        UserProvider,
    },
    ports::{EmailRepo, EmailUserRepo},
};
use chrono::{DateTime, Utc};
use email_api_client::domain::models::EmailApiError;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{future::Future, sync::Arc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DraftTransferRequest {
    pub id: Uuid,
    pub source_id: Uuid,
    pub source_link_id: Uuid,
    pub destination_link_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferFile {
    pub source_id: Uuid,
    pub destination_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftTransferPlan {
    pub request: DraftTransferRequest,
    pub actor: String,
    pub source_thread_id: Uuid,
    pub source_updated_at: DateTime<Utc>,
    pub source_provider_id: Option<String>,
    pub source_provider_version: Option<String>,
    pub source_provider: UserProvider,
    pub source_mailbox: MailboxKey,
    pub destination_mailbox: MailboxKey,
    pub destination_provider: UserProvider,
    pub destination_address: String,
    pub input: ResolvedDraftInput,
    pub uploads: Vec<AttachmentDraft>,
    pub files: Vec<TransferFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftTransferReceipt {
    pub id: Uuid,
    pub message_id: Uuid,
    pub thread_id: Uuid,
    pub source_id: Uuid,
    pub source_thread_id: Uuid,
    pub attachments: Vec<AttachmentDraft>,
}

pub struct MaterializedTransferFile {
    pub source_id: Uuid,
    pub upload: AttachmentDraft,
}

pub enum TransferPreparation {
    Pending(Box<DraftTransferPlan>),
    Completed(DraftTransferReceipt),
}

/// Storage returns facts under mailbox/message locks and revalidates them at commit.
pub trait DraftTransferRepository: Send + Sync + 'static {
    /// Atomically adopt a committed result or prevent any delayed commit.
    fn recover_transfer(
        &self,
        actor: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<DraftTransferReceipt>, EmailErr>> + Send;
    fn begin_transfer(
        &self,
        actor: &str,
        request: &DraftTransferRequest,
    ) -> impl Future<Output = Result<TransferPreparation, EmailErr>> + Send;
    fn reserve_transfer_object(
        &self,
        key: &str,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;
    fn commit_transfer(
        &self,
        plan: &DraftTransferPlan,
        contacts: &UpsertedContacts,
        files: Vec<MaterializedTransferFile>,
    ) -> impl Future<Output = Result<DraftTransferReceipt, EmailErr>> + Send;
    fn claim_transfer_cleanup(
        &self,
        lease: Uuid,
    ) -> impl Future<Output = Result<Option<DraftTransferPlan>, MailboxError>> + Send;
    fn renew_transfer_cleanup(
        &self,
        plan: &DraftTransferPlan,
        lease: Uuid,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn transfer_cleanup_binding(
        &self,
        plan: &DraftTransferPlan,
    ) -> impl Future<Output = Result<Option<MailboxKey>, MailboxError>> + Send;
    fn finish_transfer_cleanup(
        &self,
        plan: &DraftTransferPlan,
        lease: Uuid,
        outcome: RetirementOutcome,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

pub trait DraftTransferFiles: Send + Sync + 'static {
    fn store(&self, key: &str, bytes: &[u8]) -> impl Future<Output = Result<(), EmailErr>> + Send;
}

pub struct TransferEligibility {
    pub authorized: bool,
    pub draft: bool,
    pub delivery_or_edit_in_progress: bool,
    pub predecessor_unresolved: bool,
    pub retired: bool,
}

pub fn validate_transfer(facts: TransferEligibility) -> Result<(), EmailErr> {
    if !facts.authorized {
        return Err(EmailErr::Unauthorized);
    }
    if !facts.draft || facts.retired {
        return Err(EmailErr::InvalidDraft(
            "This draft is no longer available to move".into(),
        ));
    }
    if facts.delivery_or_edit_in_progress || facts.predecessor_unresolved {
        return Err(EmailErr::InvalidDraft(
            "Wait for the draft's current operation or cancel delivery before changing inboxes"
                .into(),
        ));
    }
    Ok(())
}

pub struct DraftTransferService<R, S> {
    pub repository: R,
    pub bytes: Arc<dyn AuthorizedAttachmentBytes>,
    pub storage: S,
}

impl<R: DraftTransferRepository + EmailRepo + EmailUserRepo, S: DraftTransferFiles>
    DraftTransferService<R, S>
where
    anyhow::Error: From<<R as EmailRepo>::Err>,
{
    pub async fn recover(
        &self,
        actor: MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<DraftTransferReceipt>, EmailErr> {
        self.repository.recover_transfer(actor.as_ref(), id).await
    }
    pub async fn transfer(
        &self,
        actor: MacroUserIdStr<'static>,
        request: DraftTransferRequest,
    ) -> Result<DraftTransferReceipt, EmailErr> {
        let links = self
            .repository
            .user_accessible_inboxes(actor.clone())
            .await?;
        if request.source_link_id == request.destination_link_id
            || ![request.source_link_id, request.destination_link_id]
                .iter()
                .all(|id| links.iter().any(|link| link.id == *id))
        {
            return Err(EmailErr::Unauthorized);
        }
        let plan = match self
            .repository
            .begin_transfer(actor.as_ref(), &request)
            .await?
        {
            TransferPreparation::Completed(receipt) => return Ok(receipt),
            TransferPreparation::Pending(plan) => plan,
        };
        let maximum = match plan.destination_provider {
            UserProvider::Gmail => 18_000_000,
            UserProvider::Outlook => 150_000_000,
        };
        let mut total = plan
            .uploads
            .iter()
            .map(|file| i64::from(file.size))
            .sum::<i64>();
        if total > maximum {
            return Err(EmailErr::InvalidDraft(
                "These attachments exceed the destination inbox's size limit".into(),
            ));
        }
        let mut files = Vec::new();
        for file in &plan.files {
            let (record, bytes) = self
                .bytes
                .read(actor.as_ref(), file.source_id)
                .await
                .map_err(|error| EmailErr::ProviderErr(error.into()))?;
            total = total.saturating_add(bytes.len() as i64);
            if total > maximum {
                return Err(EmailErr::InvalidDraft(
                    "These attachments exceed the destination inbox's size limit".into(),
                ));
            }
            let sha = format!("{:x}", Sha256::digest(&bytes));
            let key = format!("transfer/{}/{}/{}", request.id, file.source_id, sha);
            self.repository.reserve_transfer_object(&key).await?;
            self.storage.store(&key, &bytes).await?;
            let content_id = record
                .attachment
                .content_id
                .map(|cid| cid.trim_matches(['<', '>']).to_owned());
            let is_inline = content_id.as_deref().is_some_and(|cid| {
                plan.input
                    .body_html
                    .as_ref()
                    .is_some_and(|html| html.contains(&format!("cid:{cid}")))
            });
            files.push(MaterializedTransferFile {
                source_id: file.source_id,
                upload: AttachmentDraft {
                    id: file.destination_id,
                    draft_id: plan.input.db_id,
                    file_name: record
                        .attachment
                        .filename
                        .unwrap_or_else(|| "attachment".into()),
                    content_type: record
                        .attachment
                        .mime_type
                        .unwrap_or_else(|| "application/octet-stream".into()),
                    sha,
                    size: i32::try_from(bytes.len())
                        .map_err(|_| EmailErr::InvalidDraft("Attachment is too large".into()))?,
                    s3_key: key,
                    upload_pending: false,
                    content_id: if is_inline { content_id } else { None },
                    is_inline,
                },
            });
        }
        if total > maximum {
            return Err(EmailErr::InvalidDraft(
                "These attachments exceed the destination inbox's size limit".into(),
            ));
        }
        let contacts = self
            .repository
            .upsert_contacts(
                request.destination_link_id,
                ParsedAddresses {
                    from_email: plan.destination_address.clone(),
                    from_name: None,
                    to: plan.input.to.clone(),
                    cc: plan.input.cc.clone(),
                    bcc: plan.input.bcc.clone(),
                },
            )
            .await
            .map_err(anyhow::Error::from)?;
        self.repository
            .commit_transfer(&plan, &contacts, files)
            .await
    }
}

pub struct RetiredDraftFacts {
    pub is_draft: bool,
    pub version: Option<String>,
}
pub enum RetirementOutcome {
    Removed,
    Changed,
    OriginalRemains,
    Sent,
    Reauthorization,
    Retry,
}
pub trait DraftRetirementGateway: Send + Sync + 'static {
    fn inspect(
        &self,
        plan: &DraftTransferPlan,
    ) -> impl Future<Output = Result<Option<RetiredDraftFacts>, EmailApiError>> + Send;
    fn retire(
        &self,
        plan: &DraftTransferPlan,
        version: &str,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}
pub struct DraftRetirementService<R, G> {
    pub repository: R,
    pub gateway: G,
}
impl<R: DraftTransferRepository, G: DraftRetirementGateway> DraftRetirementService<R, G> {
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        let lease = macro_uuid::generate_uuid_v7();
        let Some(mut plan) = self.repository.claim_transfer_cleanup(lease).await? else {
            return Ok(false);
        };
        let binding = self.repository.transfer_cleanup_binding(&plan).await?;
        if let Some(binding) = binding {
            plan.source_mailbox = binding;
        }
        let work = async {
            if binding.is_none() {
                return Ok(RetirementOutcome::Reauthorization);
            }
            if plan.source_provider_id.is_none() {
                return Ok(RetirementOutcome::Removed);
            }
            if plan.source_provider == UserProvider::Gmail {
                return Ok(RetirementOutcome::OriginalRemains);
            }
            let Some(facts) = self.gateway.inspect(&plan).await? else {
                return Ok(RetirementOutcome::Removed);
            };
            if !facts.is_draft {
                return Ok(RetirementOutcome::Sent);
            }
            let Some(version) = facts
                .version
                .filter(|v| Some(v) == plan.source_provider_version.as_ref())
            else {
                return Ok(RetirementOutcome::Changed);
            };
            // A slow read must not delete after the lease or user decision changed.
            self.repository.renew_transfer_cleanup(&plan, lease).await?;
            self.gateway.retire(&plan, &version).await?;
            Ok(RetirementOutcome::Removed)
        };
        let result = super::mailbox::maintain_lease(work, || {
            self.repository.renew_transfer_cleanup(&plan, lease)
        })
        .await;
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(MailboxError::Stale) => return Err(MailboxError::Stale),
            Err(MailboxError::Provider(EmailApiError::NotFound)) => RetirementOutcome::Removed,
            Err(MailboxError::Provider(EmailApiError::Conflict)) => RetirementOutcome::Changed,
            Err(MailboxError::Provider(EmailApiError::AuthRequired | EmailApiError::Forbidden)) => {
                RetirementOutcome::Reauthorization
            }
            Err(_) => RetirementOutcome::Retry,
        };
        self.repository
            .finish_transfer_cleanup(&plan, lease, outcome)
            .await?;
        Ok(true)
    }
}

impl<G: super::mailbox::drafts::ports::DraftGateway> DraftRetirementGateway for G {
    async fn inspect(
        &self,
        plan: &DraftTransferPlan,
    ) -> Result<Option<RetiredDraftFacts>, EmailApiError> {
        let id = email_api_client::domain::models::ProviderId::new(
            plan.source_provider_id
                .clone()
                .ok_or(EmailApiError::NotFound)?,
        )?;
        self.get_draft(plan.source_mailbox, &id).await.map(|draft| {
            draft.map(|d| RetiredDraftFacts {
                is_draft: d.is_draft,
                version: d.version,
            })
        })
    }
    async fn retire(&self, plan: &DraftTransferPlan, version: &str) -> Result<(), EmailApiError> {
        let id = email_api_client::domain::models::ProviderId::new(
            plan.source_provider_id
                .clone()
                .ok_or(EmailApiError::NotFound)?,
        )?;
        self.delete_draft(plan.source_mailbox, &id, version).await
    }
}
