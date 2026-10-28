//! Sending an email with files attached: Macro documents, or files the
//! caller produced itself, such as an event's iCalendar file.
//!
//! The scheduled sender attaches whatever `email_attachments_drafts` rows a
//! message has when its delivery runs, so attachments must be staged on a
//! draft row before the send is committed. A plain `send_message` has no row
//! until it commits, and the undo window it then enqueues is a few
//! seconds: staging after it would race delivery. This service therefore
//! sends in three steps - save the draft, stage every attachment on it, then
//! send that draft - and resolves every attachment before the first step so
//! a document that cannot be attached leaves nothing behind.

use std::pin::Pin;
use std::sync::Arc;

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use sha2::{Digest, Sha256};

use crate::domain::{
    models::{
        AttachmentDraft, CreateDraftInput, CreatedDraft, EmailErr, Link,
        MAX_DRAFT_ATTACHMENTS_BYTES, SourcedAttachment,
    },
    ports::{
        DraftAttachmentRepo, DraftAttachmentSource, DraftAttachmentStorage, DraftSendService,
        EmailAttachmentSendService, EmailFileSendService,
    },
};

/// [`EmailFileSendService`] over a [`DraftSendService`] (any
/// `EmailService`) for the draft and the send, plus the draft attachment
/// record and its object store: sends files the caller already holds.
pub struct StagedAttachmentSender<Svc, R, St> {
    email: Arc<Svc>,
    repo: R,
    storage: St,
}

impl<Svc, R, St> StagedAttachmentSender<Svc, R, St> {
    /// Compose the sender from the email service and the staging ports.
    pub fn new(email: Arc<Svc>, repo: R, storage: St) -> Self {
        Self {
            email,
            repo,
            storage,
        }
    }
}

/// [`EmailAttachmentSendService`] over a [`StagedAttachmentSender`], with
/// the documents a send names resolved into files through `source`.
pub struct DraftAttachmentSender<Svc, R, S, St> {
    staged: StagedAttachmentSender<Svc, R, St>,
    source: S,
}

impl<Svc, R, S, St> DraftAttachmentSender<Svc, R, S, St> {
    /// Compose the sender from the email service and the attachment ports.
    pub fn new(email: Arc<Svc>, repo: R, source: S, storage: St) -> Self {
        Self {
            staged: StagedAttachmentSender::new(email, repo, storage),
            source,
        }
    }
}

/// The object key a staged attachment is stored under: the same layout the
/// draft attachment API uses, so the scheduled sender and its cleanup treat
/// both alike.
pub(crate) fn draft_attachment_key(draft_id: uuid::Uuid, attachment_id: uuid::Uuid) -> String {
    format!("draft/{draft_id}/{attachment_id}")
}

/// Add up the attachments' raw sizes, refusing the set once it crosses the
/// per-message ceiling.
pub(crate) fn total_attachment_bytes(attachments: &[SourcedAttachment]) -> Result<usize, EmailErr> {
    let total_bytes = attachments.iter().map(|a| a.bytes.len()).sum::<usize>();
    if total_bytes > MAX_DRAFT_ATTACHMENTS_BYTES {
        return Err(EmailErr::AttachmentsTooLarge {
            total_bytes,
            limit_bytes: MAX_DRAFT_ATTACHMENTS_BYTES,
        });
    }
    Ok(total_bytes)
}

/// The send input re-targeted at the draft the attachments were staged on,
/// so the send updates that row instead of minting another.
pub(crate) fn input_for_staged_draft(
    mut input: CreateDraftInput,
    draft: &CreatedDraft,
) -> CreateDraftInput {
    input.db_id = Some(draft.db_id);
    input.thread_db_id = Some(draft.thread_db_id);
    input.provider_thread_id = draft.provider_thread_id.clone();
    input.headers_json = draft.headers_json.clone();
    input
}

impl<Svc, R, St> StagedAttachmentSender<Svc, R, St>
where
    Svc: DraftSendService,
    R: DraftAttachmentRepo,
    St: DraftAttachmentStorage,
    anyhow::Error: From<R::Err>,
{
    async fn stage(
        &self,
        link: &Link,
        draft: &CreatedDraft,
        attachments: Vec<SourcedAttachment>,
    ) -> Result<(), EmailErr> {
        for sourced in attachments {
            let attachment_id = macro_uuid::generate_uuid_v7();
            let s3_key = draft_attachment_key(draft.db_id, attachment_id);
            let sha = format!("{:x}", Sha256::digest(&sourced.bytes));
            self.storage
                .put_attachment(&s3_key, &sourced.content_type, &sourced.bytes)
                .await?;
            let record = AttachmentDraft {
                id: attachment_id,
                draft_id: draft.db_id,
                file_name: sourced.file_name,
                content_type: sourced.content_type,
                sha,
                // Bounded by MAX_DRAFT_ATTACHMENTS_BYTES, well inside i32.
                size: sourced.bytes.len() as i32,
                s3_key,
                upload_pending: false,
                content_id: None,
                is_inline: false,
            };
            self.repo
                .insert_draft_attachment(link.id, &record)
                .await
                .map_err(anyhow::Error::from)?;
        }
        Ok(())
    }

    /// A failure after the draft row exists would otherwise surface it in
    /// the user's drafts with the email they never got to send; remove it.
    /// Best effort: the original error is what the caller hears.
    async fn discard_draft(&self, input: &CreateDraftInput, draft: &CreatedDraft) {
        let Some(actor) = input.actor.as_ref() else {
            return;
        };
        if let Err(error) = self
            .email
            .delete_draft_for_user(actor.clone(), draft.db_id, 0)
            .await
        {
            tracing::warn!(
                ?error,
                draft_id = %draft.db_id,
                "failed to discard the draft of a send whose attachments could not be staged"
            );
        }
    }

    /// Send `input` with `files` staged on its draft first; with no files
    /// it is exactly a send. An oversized set is refused before any draft
    /// exists.
    pub async fn send_with_files(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
        files: Vec<SourcedAttachment>,
    ) -> Result<CreatedDraft, EmailErr> {
        if files.is_empty() {
            return self
                .email
                .send_message(link, accessible_inboxes, input)
                .await;
        }
        total_attachment_bytes(&files)?;
        let sourced = files;

        let mut draft_input = input.clone();
        draft_input.send_time = None;
        let draft = self
            .email
            .create_draft(link, accessible_inboxes, draft_input)
            .await?;

        if let Err(error) = self.stage(link, &draft, sourced).await {
            self.discard_draft(&input, &draft).await;
            return Err(error);
        }

        let send_input = input_for_staged_draft(input, &draft);
        self.email
            .send_message(link, accessible_inboxes, send_input)
            .await
    }
}

impl<Svc, R, St> EmailFileSendService for StagedAttachmentSender<Svc, R, St>
where
    Svc: DraftSendService,
    R: DraftAttachmentRepo,
    St: DraftAttachmentStorage,
    anyhow::Error: From<R::Err>,
{
    fn send_message_with_files(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
        files: Vec<SourcedAttachment>,
    ) -> impl Future<Output = Result<CreatedDraft, EmailErr>> + Send {
        self.send_with_files(link, accessible_inboxes, input, files)
    }
}

impl<Svc, R, S, St> DraftAttachmentSender<Svc, R, S, St>
where
    Svc: DraftSendService,
    R: DraftAttachmentRepo,
    S: DraftAttachmentSource,
    St: DraftAttachmentStorage,
    anyhow::Error: From<R::Err>,
{
    async fn send_with_attachments(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
        attachments: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<CreatedDraft, EmailErr> {
        // Check the running total after each download, so an oversized set
        // fails as soon as it crosses the limit rather than after every file
        // is held in memory.
        let mut sourced = Vec::with_capacity(attachments.len());
        for receipt in attachments {
            sourced.push(self.source.fetch_attachment(receipt).await?);
            total_attachment_bytes(&sourced)?;
        }
        self.staged
            .send_with_files(link, accessible_inboxes, input, sourced)
            .await
    }
}

impl<Svc, R, S, St> EmailAttachmentSendService for DraftAttachmentSender<Svc, R, S, St>
where
    Svc: DraftSendService,
    R: DraftAttachmentRepo,
    S: DraftAttachmentSource,
    St: DraftAttachmentStorage,
    anyhow::Error: From<R::Err>,
{
    fn send_message_with_attachments<'a>(
        &'a self,
        link: &'a Link,
        accessible_inboxes: &'a [Link],
        input: CreateDraftInput,
        attachments: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Pin<Box<dyn Future<Output = Result<CreatedDraft, EmailErr>> + Send + 'a>> {
        Box::pin(self.send_with_attachments(link, accessible_inboxes, input, attachments))
    }
}

#[cfg(test)]
mod test;
