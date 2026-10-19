//! Draft synchronization and delivery share one fenced, durable state machine.
//! Local editing, provider acceptance and confirmed sending are distinct states.

pub mod content;
pub mod models;
pub mod ports;

#[cfg(test)]
mod test;

use super::MailboxError;
use chrono::{Duration, Utc};
use email_api_client::domain::models::*;
use models::*;
use ports::*;
use sha2::{Digest, Sha256};

const UNCERTAIN_WAIT: Duration = Duration::minutes(10);
const UPLOAD_RANGE_BYTES: usize = 10 * 320 * 1024;
const SMALL_ATTACHMENT_BYTES: u64 = 3_000_000;

pub struct MailboxDraftService<R, G, M> {
    repo: R,
    provider: G,
    materializer: M,
    claim_mode: DraftClaimMode,
}

impl<R, G, M> MailboxDraftService<R, G, M> {
    pub fn with_writes_enabled(mut self, enabled: bool) -> Self {
        self.claim_mode = if enabled {
            DraftClaimMode::All
        } else {
            DraftClaimMode::Reconciliation
        };
        self
    }
    pub fn new(repo: R, provider: G, materializer: M) -> Self {
        Self {
            repo,
            provider,
            materializer,
            claim_mode: DraftClaimMode::All,
        }
    }
}

impl<R: DraftRepository, G: DraftGateway, M: DraftMaterializer> MailboxDraftService<R, G, M> {
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_draft(macro_uuid::generate_uuid_v7(), self.claim_mode)
            .await?
        else {
            return Ok(false);
        };
        let result =
            super::maintain_lease(self.execute(&lease), || self.repo.renew_draft(&lease)).await;
        match result {
            Ok(()) => Ok(true),
            Err(MailboxError::Provider(EmailApiError::Conflict)) => {
                self.repo.fail_draft(&lease, DraftFailure::Conflict).await?;
                Ok(true)
            }
            Err(MailboxError::Provider(EmailApiError::Forbidden)) => {
                self.repo.fail_draft(&lease, DraftFailure::Denied).await?;
                Ok(true)
            }
            Err(MailboxError::Provider(EmailApiError::Permanent { .. })) => {
                self.repo.fail_draft(&lease, DraftFailure::Invalid).await?;
                Ok(true)
            }
            Err(error) => {
                if !matches!(error, MailboxError::Stale) {
                    self.repo
                        .release_draft(
                            &lease,
                            match &error {
                                MailboxError::Provider(e) => super::retry_seconds(e),
                                _ => 30,
                            },
                        )
                        .await?;
                }
                Err(error)
            }
        }
    }

    async fn execute(&self, lease: &DraftLease) -> Result<(), MailboxError> {
        let actor = lease
            .checkpoint
            .as_ref()
            .map_or(lease.actor_id.as_str(), |c| c.actor_id.as_str());
        let checking_outcome = lease.checkpoint.as_ref().is_some_and(|c| {
            matches!(
                c.stage,
                DraftStage::Creating | DraftStage::Submitting | DraftStage::Confirming
            )
        });
        let actor = if lease.delete_requested || checking_outcome {
            lease.actor_id.as_str()
        } else {
            actor
        };
        if !self.repo.draft_authorized(lease, actor).await? {
            return self.repo.fail_draft(lease, DraftFailure::Denied).await;
        }
        let mut checkpoint = match &lease.checkpoint {
            Some(checkpoint) => checkpoint.clone(),
            None => DraftCheckpoint {
                revision: lease.revision,
                actor_id: lease.actor_id.clone(),
                prepared: self.materializer.prepare_draft(lease).await?,
                stage: DraftStage::Inspect,
                stage_started_at: Utc::now(),
                submission_started: false,
                draft: None,
                completed_files: 0,
                completed_removals: 0,
                transfer: None,
            },
        };
        match checkpoint.stage {
            DraftStage::Inspect => self.inspect(lease, &mut checkpoint).await?,
            DraftStage::Creating => self.recover_creation(lease, &mut checkpoint).await?,
            DraftStage::Updating => self.update(lease, &mut checkpoint).await?,
            DraftStage::Attachments => self.attach(lease, &mut checkpoint).await?,
            DraftStage::Ready => return self.ready(lease, &mut checkpoint).await,
            DraftStage::Deleting => return self.delete(lease, &mut checkpoint).await,
            DraftStage::Submitting | DraftStage::Confirming => {
                return self.confirm(lease, &mut checkpoint).await;
            }
        }
        self.repo.checkpoint_draft(lease, &checkpoint).await?;
        self.repo.release_draft(lease, 2).await
    }

    async fn inspect(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let found = if let Some(id) = &lease.provider_id {
            match self.provider.get_draft(lease.mailbox, id).await? {
                Some(draft) => Some(draft),
                None if lease.delete_requested => None,
                None => return Err(EmailApiError::Conflict.into()),
            }
        } else {
            one_draft(
                self.provider
                    .find_drafts(lease.mailbox, lease.message_id)
                    .await?,
            )?
        };
        if let Some(draft) = found {
            if !draft.is_draft {
                checkpoint.draft = Some(draft);
                checkpoint.advance(DraftStage::Confirming);
                return Ok(());
            }
            if draft.version.is_none()
                || (!lease.delete_requested
                    && lease.provider_id.is_some()
                    && draft.version != lease.base_version)
            {
                return Err(EmailApiError::Conflict.into());
            }
            checkpoint.draft = Some(draft);
            if lease.delete_requested {
                checkpoint.advance(DraftStage::Deleting);
                return Ok(());
            }
            self.update(lease, checkpoint).await?;
        } else if lease.delete_requested {
            // There has never been a remote draft. No provider write is needed.
            checkpoint.advance(DraftStage::Deleting);
        } else {
            checkpoint.advance(DraftStage::Creating);
            self.repo.checkpoint_draft(lease, checkpoint).await?;
            match self
                .provider
                .create_draft(lease.mailbox, &draft_request(lease, checkpoint))
                .await
            {
                Ok(draft) => {
                    checkpoint.draft = Some(draft);
                    checkpoint.advance(DraftStage::Attachments);
                }
                Err(error) => {
                    if definitively_rejected(&error) {
                        checkpoint.advance(DraftStage::Inspect);
                        self.repo.checkpoint_draft(lease, checkpoint).await?;
                    }
                    return Err(error.into());
                }
            }
        }
        Ok(())
    }

    async fn recover_creation(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        if let Some(draft) = one_draft(
            self.provider
                .find_drafts(lease.mailbox, lease.message_id)
                .await?,
        )? {
            let stage = if draft.is_draft && lease.delete_requested {
                DraftStage::Deleting
            } else if draft.is_draft {
                DraftStage::Attachments
            } else {
                DraftStage::Confirming
            };
            let still_draft = draft.is_draft;
            checkpoint.draft = Some(draft);
            checkpoint.advance(stage);
            if still_draft && !lease.delete_requested {
                // Correlation proves identity, not that another client left its
                // content untouched after creation. Bind it, then request review.
                self.repo.checkpoint_draft(lease, checkpoint).await?;
                return Err(EmailApiError::Conflict.into());
            }
            return Ok(());
        }
        if Utc::now() - checkpoint.stage_started_at >= UNCERTAIN_WAIT {
            self.repo
                .fail_draft(lease, DraftFailure::CreationUnknown)
                .await?;
            // The caller must not checkpoint/release a terminal result.
            return Err(MailboxError::Stale);
        }
        // A missing result is not proof that an earlier POST did not succeed.
        Ok(())
    }

    async fn update(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let prior = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        let observed = self
            .provider
            .get_draft(lease.mailbox, &prior.id)
            .await?
            .ok_or(EmailApiError::Conflict)?;
        if !observed.is_draft {
            checkpoint.draft = Some(observed);
            checkpoint.advance(DraftStage::Confirming);
            return Ok(());
        }
        if observed.version.is_none() || observed.version != prior.version {
            return Err(EmailApiError::Conflict.into());
        }
        if lease.delete_requested {
            checkpoint.draft = Some(observed);
            checkpoint.advance(DraftStage::Deleting);
            return Ok(());
        }
        let version = observed
            .version
            .as_deref()
            .ok_or(EmailApiError::Conflict)?
            .to_owned();
        let id = observed.id.clone();
        checkpoint.draft = Some(observed);
        checkpoint.advance(DraftStage::Updating);
        self.repo.checkpoint_draft(lease, checkpoint).await?;
        let draft = self
            .provider
            .update_draft(
                lease.mailbox,
                &id,
                &draft_request(lease, checkpoint),
                &version,
            )
            .await?;
        checkpoint.draft = Some(draft);
        checkpoint.advance(DraftStage::Attachments);
        Ok(())
    }

    async fn attach(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let draft = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        let id = draft.id.clone();
        let observed = self
            .provider
            .get_draft(lease.mailbox, &id)
            .await?
            .ok_or(EmailApiError::Conflict)?;
        if !observed.is_draft {
            checkpoint.draft = Some(observed);
            checkpoint.advance(DraftStage::Confirming);
            return Ok(());
        }
        if draft.content_fingerprint.is_none()
            || observed.content_fingerprint != draft.content_fingerprint
        {
            return Err(EmailApiError::Conflict.into());
        }
        if lease.delete_requested {
            checkpoint.draft = Some(observed);
            checkpoint.advance(DraftStage::Deleting);
            return Ok(());
        }
        if let Some(attachment) = checkpoint
            .prepared
            .removals
            .get(checkpoint.completed_removals)
        {
            use crate::domain::models::draft_attachment_manifest::AttachmentRemoval;
            match attachment {
                AttachmentRemoval::ProviderId(attachment) => {
                    self.provider
                        .delete_attachment(
                            lease.mailbox,
                            &id,
                            &ProviderId::new(attachment.clone())?,
                        )
                        .await?;
                }
                AttachmentRemoval::ContentId(cid) => {
                    for attachment in self
                        .provider
                        .attachments(lease.mailbox, &id)
                        .await?
                        .into_iter()
                        .filter(|a| {
                            a.content_id
                                .as_deref()
                                .map(|value| value.trim_matches(['<', '>']))
                                == Some(cid.trim_matches(['<', '>']))
                        })
                    {
                        self.provider
                            .delete_attachment(lease.mailbox, &id, &attachment.id)
                            .await?;
                    }
                }
            }
            checkpoint.completed_removals += 1;
            return Ok(());
        }
        let Some(file) = checkpoint.prepared.files.get(checkpoint.completed_files) else {
            let stage = DraftStage::Ready;
            checkpoint.draft = Some(observed);
            checkpoint.advance(stage);
            return Ok(());
        };
        let attachments = self.provider.attachments(lease.mailbox, &id).await?;
        let matches: Vec<_> = attachments
            .iter()
            .filter(|a| {
                a.content_id
                    .as_deref()
                    .map(|value| value.trim_matches(['<', '>']))
                    == Some(file.content_id.trim_matches(['<', '>']))
            })
            .collect();
        if matches.len() > 1 {
            return Err(EmailApiError::Conflict.into());
        }
        if matches.len() == 1 {
            let found = matches[0];
            if found.size != file.size || found.name != file.name || found.inline != file.inline {
                return Err(EmailApiError::Conflict.into());
            }
            checkpoint.completed_files += 1;
            checkpoint.transfer = None;
            return Ok(());
        }
        let data = self.materializer.draft_file_bytes(lease, file).await?;
        if data.len() as u64 != file.size || format!("{:x}", Sha256::digest(&data)) != file.sha256 {
            return Err(EmailApiError::Conflict.into());
        }
        let file = file.clone();
        let content = AttachmentContent {
            name: &file.name,
            content_type: &file.content_type,
            content_id: &file.content_id,
            inline: file.inline,
            data: &data,
        };
        if file.size < SMALL_ATTACHMENT_BYTES {
            if let Some(transfer) = &checkpoint.transfer {
                if Utc::now() - transfer.started_at >= UNCERTAIN_WAIT {
                    self.repo
                        .fail_draft(lease, DraftFailure::AttachmentUnknown)
                        .await?;
                    return Err(MailboxError::Stale);
                }
                return Ok(());
            }
            checkpoint.transfer = Some(Transfer {
                index: checkpoint.completed_files,
                started_at: Utc::now(),
                session: None,
            });
            self.repo.checkpoint_draft(lease, checkpoint).await?;
            match self
                .provider
                .add_attachment(lease.mailbox, &id, content)
                .await
            {
                Ok(_) => {
                    checkpoint.completed_files += 1;
                    checkpoint.transfer = None;
                }
                Err(error) => {
                    if definitively_rejected(&error) {
                        checkpoint.transfer = None;
                        self.repo.checkpoint_draft(lease, checkpoint).await?;
                    }
                    return Err(error.into());
                }
            }
            return Ok(());
        }
        let Some(transfer) = checkpoint.transfer.as_mut() else {
            // Losing an empty session creation can orphan only an expiring upload
            // session, never a completed attachment; a fresh session is safe here.
            let session = self
                .provider
                .create_upload(lease.mailbox, &id, content)
                .await?;
            checkpoint.transfer = Some(Transfer {
                index: checkpoint.completed_files,
                started_at: Utc::now(),
                session: Some(session),
            });
            return Ok(());
        };
        let session = transfer.session.as_ref().ok_or(MailboxError::Persistence)?;
        let observed = match self
            .provider
            .inspect_upload(lease.mailbox, &session.url)
            .await
        {
            Ok(session) => session,
            Err(EmailApiError::NotFound | EmailApiError::OutdatedCursor) => {
                // Final PUT may have succeeded. Give the attachment read time to
                // converge; never restart and create a second attachment blindly.
                if Utc::now() - transfer.started_at >= UNCERTAIN_WAIT {
                    self.repo
                        .fail_draft(lease, DraftFailure::AttachmentUnknown)
                        .await?;
                    return Err(MailboxError::Stale);
                }
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        };
        let start = usize::try_from(observed.next_offset).map_err(|_| EmailApiError::Conflict)?;
        if start >= data.len() {
            return Err(EmailApiError::Conflict.into());
        }
        let end = start.saturating_add(UPLOAD_RANGE_BYTES).min(data.len());
        let result = self
            .provider
            .upload_range(
                lease.mailbox,
                &observed.url,
                observed.next_offset,
                file.size,
                &data[start..end],
            )
            .await?;
        if let UploadProgress::Continue(session) = result {
            transfer.session = Some(session);
        }
        // Completion is confirmed by listing the stable Content-ID on the next step.
        Ok(())
    }

    async fn ready(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        if lease.delete_requested {
            checkpoint.advance(DraftStage::Deleting);
            self.repo.checkpoint_draft(lease, checkpoint).await?;
            return self.repo.release_draft(lease, 0).await;
        }
        let prior = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        let observed = self
            .provider
            .get_draft(lease.mailbox, &prior.id)
            .await?
            .ok_or(EmailApiError::Conflict)?;
        if !observed.is_draft {
            checkpoint.draft = Some(observed);
            return self.repo.confirm_sent(lease, checkpoint).await;
        }
        if observed.version != prior.version || observed.version.is_none() {
            return Err(EmailApiError::Conflict.into());
        }
        checkpoint.advance(DraftStage::Submitting);
        checkpoint.submission_started = true;
        match self.repo.start_delivery(lease, checkpoint).await? {
            DeliveryStart::NotDue => {
                checkpoint.submission_started = false;
                checkpoint.advance(DraftStage::Ready);
                self.repo.settle_draft(lease, checkpoint).await
            }
            DeliveryStart::Denied => self.repo.fail_draft(lease, DraftFailure::Denied).await,
            DeliveryStart::Started => {
                let id = &checkpoint
                    .draft
                    .as_ref()
                    .ok_or(MailboxError::Persistence)?
                    .id;
                match self.provider.submit_draft(lease.mailbox, id).await {
                    Ok(SubmissionOutcome::Accepted | SubmissionOutcome::Unknown) => {
                        checkpoint.advance(DraftStage::Confirming);
                        self.repo.checkpoint_draft(lease, checkpoint).await?;
                        self.repo.release_draft(lease, 5).await
                    }
                    Err(error) => {
                        // Definitive rejections are surfaced for a deliberate retry.
                        // A crash after recording Submitting always resumes reads.
                        if definitively_rejected(&error) {
                            self.repo
                                .fail_draft(lease, DraftFailure::SendRejected)
                                .await?;
                            return Ok(());
                        }
                        Err(error.into())
                    }
                }
            }
        }
    }

    async fn confirm(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let prior = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        let found = self.provider.get_draft(lease.mailbox, &prior.id).await?;
        if let Some(draft) = found
            && !draft.is_draft
        {
            checkpoint.draft = Some(draft);
            return self.repo.confirm_sent(lease, checkpoint).await;
        }
        if Utc::now() - checkpoint.stage_started_at >= UNCERTAIN_WAIT {
            return self.repo.fail_draft(lease, DraftFailure::SendUnknown).await;
        }
        self.repo.release_draft(lease, 10).await
    }

    async fn delete(
        &self,
        lease: &DraftLease,
        checkpoint: &mut DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let Some(prior) = &checkpoint.draft else {
            return self.repo.confirm_deleted(lease).await;
        };
        let Some(draft) = self.provider.get_draft(lease.mailbox, &prior.id).await? else {
            return self.repo.confirm_deleted(lease).await;
        };
        if !draft.is_draft {
            checkpoint.draft = Some(draft);
            return self.repo.confirm_sent(lease, checkpoint).await;
        }
        if draft.version != prior.version {
            return Err(EmailApiError::Conflict.into());
        }
        self.provider
            .delete_draft(
                lease.mailbox,
                &draft.id,
                draft.version.as_deref().ok_or(EmailApiError::Conflict)?,
            )
            .await?;
        self.repo.confirm_deleted(lease).await
    }
}

fn draft_request(lease: &DraftLease, checkpoint: &DraftCheckpoint) -> DraftRequest {
    DraftRequest {
        reply_to: checkpoint.prepared.reply_to.clone(),
        correlation: lease.message_id,
        revision: checkpoint.revision as u64,
        content: checkpoint.prepared.request.clone(),
    }
}

fn one_draft(mut drafts: Vec<ProviderDraft>) -> Result<Option<ProviderDraft>, EmailApiError> {
    if drafts.len() > 1 {
        return Err(EmailApiError::Conflict);
    }
    Ok(drafts.pop())
}

fn definitively_rejected(error: &EmailApiError) -> bool {
    matches!(
        error,
        EmailApiError::AuthRequired
            | EmailApiError::Forbidden
            | EmailApiError::NotFound
            | EmailApiError::Conflict
            | EmailApiError::Permanent { .. }
            | EmailApiError::RateLimited { .. }
    )
}
