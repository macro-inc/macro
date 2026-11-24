use super::*;
use crate::domain::models::error::LOCK_NOT_AVAILABLE;
use crate::domain::{
    mailbox::{AFTER_PROVIDER_ATTEMPTS, AFTER_PROVIDER_RETRY_DELAY, DatabaseFailure, MailboxKey},
    models::ResolvedDraftInput,
};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone)]
struct Harness(Arc<Mutex<State>>);
struct State {
    lease: DraftLease,
    prepared: PreparedDraft,
    remote: Option<ProviderDraft>,
    attachments: Vec<DraftAttachment>,
    authorized: bool,
    due: bool,
    stopped: bool,
    sent: bool,
    failure: Option<DraftFailure>,
    /// Send attempts waiting on the draft.
    attempts: Vec<Uuid>,
    creates: usize,
    updates: usize,
    deletes: usize,
    submissions: usize,
    additions: usize,
    /// Updates refused because the version moved after it was read.
    refusals: usize,
    /// The content an edit leaves as it makes an update be refused.
    refused_by_edit: Option<String>,
    /// Checkpoints after a provider update that time out on a busy mailbox.
    locked_checkpoints: u32,
}

fn harness(stage: Option<DraftStage>) -> Harness {
    let message = Uuid::now_v7();
    let link = Uuid::now_v7();
    let input:ResolvedDraftInput = serde_json::from_value(serde_json::json!({"db_id":message,"thread_db_id":Uuid::now_v7(),"subject":"Saved locally","to":[],"cc":[],"bcc":[],"actor_id":"macro|owner@example.com"})).unwrap();
    let prepared = PreparedDraft {
        reply_to: None,
        request: SendRequest {
            message_id: None,
            message: serde_json::from_value(
                serde_json::json!({"db_id":message,"link_id":link,"subject":"Saved locally"}),
            )
            .unwrap(),
            from: models_email::service::address::ContactInfo {
                email: "owner@example.com".into(),
                name: None,
                photo_url: None,
            },
            parent_message_id: None,
            references: None,
        },
        files: Vec::new(),
        removals: Vec::new(),
    };
    let remote = ProviderDraft {
        id: ProviderId::new("draft").unwrap(),
        conversation_id: ProviderId::new("conversation").unwrap(),
        version: Some("v1".into()),
        is_draft: true,
        app_revision: Some(1),
        content_fingerprint: Some("unchanged-body".into()),
        field_digests: [("body".to_owned(), "unchanged-body".to_owned())].into(),
    };
    let checkpoint = stage.map(|stage| DraftCheckpoint {
        revision: 1,
        actor_id: "macro|owner@example.com".into(),
        prepared: prepared.clone(),
        stage,
        stage_started_at: Utc::now(),
        submission_started: matches!(stage, DraftStage::Submitting | DraftStage::Confirming),
        draft: Some(remote.clone()),
        completed_files: 0,
        completed_removals: 0,
        transfer: None,
    });
    Harness(Arc::new(Mutex::new(State {
        lease: DraftLease {
            message_id: message,
            lease_id: Uuid::now_v7(),
            mailbox: MailboxKey {
                link_id: link,
                sync_generation: 1,
                grant_generation: 1,
            },
            revision: 1,
            actor_id: "macro|owner@example.com".into(),
            input,
            attachments: Default::default(),
            provider_id: stage.map(|_| remote.id.clone()),
            base_version: Some("v1".into()),
            base_content: Some(DraftContent {
                fingerprint: "unchanged-body".into(),
                fields: [("body".to_owned(), "unchanged-body".to_owned())].into(),
            }),
            delete_requested: false,
            checkpoint,
        },
        prepared,
        remote: stage.map(|_| remote),
        attachments: Vec::new(),
        authorized: true,
        due: true,
        stopped: false,
        sent: false,
        failure: None,
        attempts: Vec::new(),
        creates: 0,
        updates: 0,
        deletes: 0,
        submissions: 0,
        additions: 0,
        refusals: 0,
        refused_by_edit: None,
        locked_checkpoints: 0,
    })))
}

impl DraftRepository for Harness {
    async fn claim_draft(
        &self,
        id: Uuid,
        _mode: DraftClaimMode,
    ) -> Result<Option<DraftLease>, MailboxError> {
        let mut s = self.0.lock().unwrap();
        if s.stopped {
            return Ok(None);
        }
        s.lease.lease_id = id;
        Ok(Some(s.lease.clone()))
    }
    async fn renew_draft(&self, _: &DraftLease) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn draft_authorized(&self, _: &DraftLease, _: &str) -> Result<bool, MailboxError> {
        Ok(self.0.lock().unwrap().authorized)
    }
    async fn checkpoint_draft(
        &self,
        _: &DraftLease,
        c: &DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let mut s = self.0.lock().unwrap();
        if s.updates > 0 && s.locked_checkpoints > 0 {
            s.locked_checkpoints -= 1;
            return Err(MailboxError::database(DatabaseFailure::Sqlstate(
                LOCK_NOT_AVAILABLE.into(),
            )));
        }
        s.lease.checkpoint = Some(c.clone());
        Ok(())
    }
    async fn release_draft(&self, _: &DraftLease, _: u32) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn fail_draft(&self, _: &DraftLease, f: DraftFailure) -> Result<Vec<Uuid>, MailboxError> {
        let mut s = self.0.lock().unwrap();
        s.failure = Some(f);
        s.stopped = true;
        Ok(s.attempts.clone())
    }
    async fn settle_draft(&self, _: &DraftLease, c: &DraftCheckpoint) -> Result<(), MailboxError> {
        let mut s = self.0.lock().unwrap();
        s.lease.checkpoint = Some(c.clone());
        s.stopped = true;
        Ok(())
    }
    async fn start_delivery(
        &self,
        _: &DraftLease,
        c: &DraftCheckpoint,
    ) -> Result<DeliveryStart, MailboxError> {
        let mut s = self.0.lock().unwrap();
        if !s.due {
            return Ok(DeliveryStart::NotDue);
        }
        assert_eq!(c.stage, DraftStage::Submitting);
        s.lease.checkpoint = Some(c.clone());
        Ok(DeliveryStart::Started)
    }
    async fn confirm_sent(&self, _: &DraftLease, c: &DraftCheckpoint) -> Result<(), MailboxError> {
        assert!(!c.draft.as_ref().unwrap().is_draft);
        let mut s = self.0.lock().unwrap();
        s.sent = true;
        s.stopped = true;
        Ok(())
    }
    async fn confirm_deleted(&self, _: &DraftLease) -> Result<(), MailboxError> {
        self.0.lock().unwrap().stopped = true;
        Ok(())
    }
}

impl DraftMaterializer for Harness {
    async fn prepare_draft(&self, _: &DraftLease) -> Result<PreparedDraft, MailboxError> {
        Ok(self.0.lock().unwrap().prepared.clone())
    }
    async fn draft_file_bytes(
        &self,
        _: &DraftLease,
        _: &DraftFile,
    ) -> Result<Vec<u8>, MailboxError> {
        Ok(b"abc".to_vec())
    }
}

impl DraftGateway for Harness {
    async fn get_draft(
        &self,
        _: MailboxKey,
        _: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        Ok(self.0.lock().unwrap().remote.clone())
    }
    async fn find_drafts(
        &self,
        _: MailboxKey,
        _: Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        Ok(self.0.lock().unwrap().remote.clone().into_iter().collect())
    }
    async fn create_draft(
        &self,
        _: MailboxKey,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(
            s.lease.checkpoint.as_ref().unwrap().stage,
            DraftStage::Creating
        );
        s.creates += 1;
        s.remote = Some(ProviderDraft {
            id: ProviderId::new("created").unwrap(),
            conversation_id: ProviderId::new("conversation").unwrap(),
            version: Some("v1".into()),
            is_draft: true,
            app_revision: Some(request.revision),
            content_fingerprint: Some("unchanged-body".into()),
            field_digests: Default::default(),
        });
        Err(EmailApiError::Transient {
            message: "response lost".into(),
        })
    }
    async fn update_draft(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &DraftRequest,
        version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        let mut s = self.0.lock().unwrap();
        s.updates += 1;
        if s.refusals > 0 {
            s.refusals -= 1;
            let version = format!("moved-{}", s.updates);
            let edit = s.refused_by_edit.clone();
            let remote = s.remote.as_mut().unwrap();
            remote.version = Some(version);
            if let Some(content) = edit {
                remote.content_fingerprint = Some(content);
            }
            return Err(EmailApiError::Conflict);
        }
        assert_eq!(s.remote.as_ref().unwrap().version.as_deref(), Some(version));
        Ok(s.remote.clone().unwrap())
    }
    async fn delete_draft(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        version: &str,
    ) -> Result<(), EmailApiError> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(s.remote.as_ref().unwrap().version.as_deref(), Some(version));
        s.deletes += 1;
        s.remote = None;
        Ok(())
    }
    async fn attachments(
        &self,
        _: MailboxKey,
        _: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        Ok(self.0.lock().unwrap().attachments.clone())
    }
    async fn add_attachment(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        let mut s = self.0.lock().unwrap();
        s.additions += 1;
        assert!(s.lease.checkpoint.as_ref().unwrap().transfer.is_some());
        s.attachments.push(DraftAttachment {
            id: ProviderId::new("attachment").unwrap(),
            name: content.name.into(),
            size: content.data.len() as u64,
            content_id: Some(content.content_id.into()),
            inline: content.inline,
        });
        Err(EmailApiError::Transient {
            message: "response lost".into(),
        })
    }
    async fn delete_attachment(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        let mut state = self.0.lock().unwrap();
        assert!(state.attachments.iter().any(|file| file.id == *attachment));
        state.attachments.retain(|file| file.id != *attachment);
        Ok(())
    }
    async fn create_upload(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        panic!("unexpected upload")
    }
    async fn inspect_upload(
        &self,
        _: MailboxKey,
        _: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        panic!("unexpected upload")
    }
    async fn upload_range(
        &self,
        _: MailboxKey,
        _: &UploadUrl,
        _: u64,
        _: u64,
        _: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        panic!("unexpected upload")
    }
    async fn submit_draft(
        &self,
        _: MailboxKey,
        _: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        let mut s = self.0.lock().unwrap();
        assert_eq!(
            s.lease.checkpoint.as_ref().unwrap().stage,
            DraftStage::Submitting
        );
        s.submissions += 1;
        Ok(SubmissionOutcome::Unknown)
    }
}

/// Another client saves the draft with different content.
fn edit(h: &Harness, version: &str) {
    let mut state = h.0.lock().unwrap();
    let remote = state.remote.as_mut().unwrap();
    remote.version = Some(version.into());
    remote.content_fingerprint = Some(version.into());
    remote.field_digests = [("body".to_owned(), version.to_owned())].into();
}

/// The mailbox stamps the draft: its version moves, its content does not.
fn stamp(h: &Harness, version: &str) {
    let mut state = h.0.lock().unwrap();
    state.remote.as_mut().unwrap().version = Some(version.into());
}

fn file() -> DraftFile {
    DraftFile {
        source: AttachmentSource::Uploaded {
            key: "immutable-key".into(),
        },
        name: "notes.txt".into(),
        content_type: "text/plain".into(),
        content_id: "stable-cid".into(),
        inline: false,
        size: 3,
        sha256: format!("{:x}", Sha256::digest(b"abc")),
    }
}

fn uploaded(name: &str) -> DraftAttachment {
    DraftAttachment {
        id: ProviderId::new("uploaded-earlier").unwrap(),
        name: name.into(),
        size: 3 + 212,
        content_id: Some("stable-cid".into()),
        inline: false,
    }
}

fn service(h: &Harness) -> MailboxDraftService<Harness, Harness, Harness> {
    MailboxDraftService::new(h.clone(), h.clone(), h.clone())
}

#[tokio::test]
async fn lost_creation_response_recovers_the_same_draft_without_a_second_post() {
    let h = harness(None);
    let service = service(&h);
    assert!(service.execute_once().await.is_err());
    assert_eq!(
        h.0.lock().unwrap().lease.checkpoint.as_ref().unwrap().stage,
        DraftStage::Creating
    );
    service.execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert_eq!(s.creates, 1);
    assert_eq!(
        s.lease
            .checkpoint
            .as_ref()
            .unwrap()
            .draft
            .as_ref()
            .unwrap()
            .id
            .as_str(),
        "created"
    );
}

#[tokio::test]
async fn unknown_send_is_only_read_back_until_a_sent_copy_is_confirmed() {
    let h = harness(Some(DraftStage::Ready));
    let service = service(&h);
    service.execute_once().await.unwrap();
    for _ in 0..4 {
        service.execute_once().await.unwrap();
    }
    assert_eq!(h.0.lock().unwrap().submissions, 1);
    assert!(!h.0.lock().unwrap().sent);
    h.0.lock().unwrap().remote.as_mut().unwrap().is_draft = false;
    service.execute_once().await.unwrap();
    assert!(h.0.lock().unwrap().sent);
    assert_eq!(h.0.lock().unwrap().submissions, 1);
}

#[tokio::test]
async fn crash_after_submission_marker_never_replays_the_send() {
    let h = harness(Some(DraftStage::Submitting));
    let service = service(&h);
    service.execute_once().await.unwrap();
    assert_eq!(h.0.lock().unwrap().submissions, 0);
    h.0.lock()
        .unwrap()
        .lease
        .checkpoint
        .as_mut()
        .unwrap()
        .stage_started_at = Utc::now() - Duration::minutes(11);
    service.execute_once().await.unwrap();
    assert!(matches!(
        h.0.lock().unwrap().failure,
        Some(DraftFailure::SendUnknown)
    ));
}

#[tokio::test]
async fn remote_edit_conflicts_without_overwriting_the_local_revision() {
    let h = harness(Some(DraftStage::Inspect));
    edit(&h, "remote-edit");
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
    assert_eq!(s.updates, 0);
    assert_eq!(s.lease.input.subject, "Saved locally");
}

#[tokio::test]
async fn revoked_delegation_prevents_provider_writes() {
    let h = harness(Some(DraftStage::Ready));
    h.0.lock().unwrap().authorized = false;
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Denied)));
    assert_eq!(s.submissions, 0);
}

#[tokio::test]
async fn lost_attachment_response_recovers_by_content_id_without_a_second_post() {
    let h = harness(Some(DraftStage::Attachments));
    h.0.lock()
        .unwrap()
        .lease
        .checkpoint
        .as_mut()
        .unwrap()
        .prepared
        .files
        .push(DraftFile {
            source: AttachmentSource::Uploaded {
                key: "immutable-key".into(),
            },
            name: "notes.txt".into(),
            content_type: "text/plain".into(),
            content_id: "stable-cid".into(),
            inline: false,
            size: 3,
            sha256: format!("{:x}", Sha256::digest(b"abc")),
        });
    let service = service(&h);
    assert!(service.execute_once().await.is_err());
    h.0.lock().unwrap().attachments[0].content_id = Some("<stable-cid>".into());
    service.execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert_eq!(s.additions, 1);
    assert_eq!(s.lease.checkpoint.as_ref().unwrap().completed_files, 1);
}

#[tokio::test]
async fn resync_keeps_an_uploaded_attachment_whose_provider_size_counts_its_properties() {
    let h = harness(Some(DraftStage::Attachments));
    {
        let mut state = h.0.lock().unwrap();
        state
            .lease
            .checkpoint
            .as_mut()
            .unwrap()
            .prepared
            .files
            .push(DraftFile {
                source: AttachmentSource::Uploaded {
                    key: "immutable-key".into(),
                },
                name: "notes.txt".into(),
                content_type: "text/plain".into(),
                content_id: "stable-cid".into(),
                inline: false,
                size: 3,
                sha256: format!("{:x}", Sha256::digest(b"abc")),
            });
        // Graph reports PidTagAttachSize: the content plus the attachment's properties.
        state.attachments.push(DraftAttachment {
            id: ProviderId::new("uploaded-earlier").unwrap(),
            name: "notes.txt".into(),
            size: 3 + 212,
            content_id: Some("stable-cid".into()),
            inline: false,
        });
    }
    let service = service(&h);
    for _ in 0..3 {
        service.execute_once().await.unwrap();
    }
    let state = h.0.lock().unwrap();
    assert!(state.failure.is_none(), "{:?}", state.failure);
    assert_eq!(state.additions, 0);
    assert_eq!(state.submissions, 1);
}

#[tokio::test]
async fn forwarded_removal_matches_a_bracketed_provider_content_id() {
    use crate::domain::models::draft_attachment_manifest::AttachmentRemoval;
    let h = harness(Some(DraftStage::Attachments));
    {
        let mut state = h.0.lock().unwrap();
        state
            .lease
            .checkpoint
            .as_mut()
            .unwrap()
            .prepared
            .removals
            .push(AttachmentRemoval::ContentId("forwarded@cid".into()));
        state.attachments.push(DraftAttachment {
            id: ProviderId::new("forwarded-file").unwrap(),
            name: "notes.txt".into(),
            size: 3,
            content_id: Some("<forwarded@cid>".into()),
            inline: true,
        });
    }
    service(&h).execute_once().await.unwrap();
    let state = h.0.lock().unwrap();
    assert!(state.attachments.is_empty());
    assert_eq!(
        state.lease.checkpoint.as_ref().unwrap().completed_removals,
        1
    );
    assert_eq!(state.additions, 0);
}

#[tokio::test]
async fn an_external_content_edit_during_upload_cannot_become_a_new_send_baseline() {
    let h = harness(Some(DraftStage::Attachments));
    h.0.lock()
        .unwrap()
        .remote
        .as_mut()
        .unwrap()
        .content_fingerprint = Some("externally-modified-body".into());
    service(&h).execute_once().await.unwrap();
    let state = h.0.lock().unwrap();
    assert!(matches!(state.failure, Some(DraftFailure::Conflict)));
    assert_eq!(state.submissions, 0);
    assert_eq!(state.additions, 0);
}
#[tokio::test]
async fn revision_marker_does_not_prove_external_clients_left_content_untouched() {
    let h = harness(Some(DraftStage::Updating));
    edit(&h, "remote-edit-after-our-patch");
    service(&h).execute_once().await.unwrap();
    let state = h.0.lock().unwrap();
    assert!(matches!(state.failure, Some(DraftFailure::Conflict)));
    assert_eq!(state.updates, 0);
    assert_eq!(state.submissions, 0);
}
#[tokio::test]
async fn draft_sent_by_another_client_stops_attachment_writes() {
    let h = harness(Some(DraftStage::Attachments));
    h.0.lock().unwrap().remote.as_mut().unwrap().is_draft = false;
    service(&h).execute_once().await.unwrap();
    service(&h).execute_once().await.unwrap();
    let state = h.0.lock().unwrap();
    assert!(state.sent);
    assert_eq!(state.additions, 0);
    assert_eq!(state.submissions, 0);
}

#[tokio::test]
async fn discard_during_uncertain_creation_deletes_the_recovered_draft() {
    let h = harness(None);
    let service = service(&h);
    assert!(service.execute_once().await.is_err());
    h.0.lock().unwrap().lease.delete_requested = true;
    service.execute_once().await.unwrap();
    assert_eq!(
        h.0.lock().unwrap().lease.checkpoint.as_ref().unwrap().stage,
        DraftStage::Deleting
    );
    service.execute_once().await.unwrap();
    let state = h.0.lock().unwrap();
    assert!(state.stopped);
    assert!(state.failure.is_none());
    assert_eq!(state.creates, 1);
    assert_eq!(state.submissions, 0);
}

#[tokio::test(start_paused = true)]
async fn a_checkpoint_after_a_provider_write_waits_out_a_busy_mailbox() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().locked_checkpoints = 2;
    let started = tokio::time::Instant::now();
    assert!(service(&h).execute_once().await.unwrap());
    assert_eq!(started.elapsed(), 2 * AFTER_PROVIDER_RETRY_DELAY);
    let s = h.0.lock().unwrap();
    assert_eq!(s.updates, 1);
    assert_eq!(
        s.lease.checkpoint.as_ref().unwrap().stage,
        DraftStage::Attachments
    );
    assert!(s.failure.is_none());
}

#[tokio::test(start_paused = true)]
async fn a_checkpoint_that_stays_locked_gives_up_inside_the_lease() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().locked_checkpoints = u32::MAX;
    let started = tokio::time::Instant::now();
    let error = service(&h).execute_once().await.unwrap_err();
    assert!(error.is_lock_timeout(), "{error:?}");
    assert!(started.elapsed() < std::time::Duration::from_secs(180));
    let s = h.0.lock().unwrap();
    assert_eq!(s.locked_checkpoints, u32::MAX - AFTER_PROVIDER_ATTEMPTS);
    assert_eq!(
        s.lease.checkpoint.as_ref().unwrap().stage,
        DraftStage::Updating
    );
}

#[tokio::test]
async fn a_draft_the_mailbox_stamped_before_its_update_still_syncs_and_sends() {
    let h = harness(Some(DraftStage::Inspect));
    stamp(&h, "stamped");
    let service = service(&h);
    for _ in 0..3 {
        service.execute_once().await.unwrap();
    }
    let s = h.0.lock().unwrap();
    assert!(s.failure.is_none(), "{:?}", s.failure);
    assert_eq!(s.updates, 1);
    assert_eq!(s.submissions, 1);
}

#[tokio::test]
async fn a_draft_the_mailbox_stamped_before_its_send_still_sends() {
    let h = harness(Some(DraftStage::Ready));
    stamp(&h, "stamped");
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(s.failure.is_none(), "{:?}", s.failure);
    assert_eq!(s.submissions, 1);
}

#[tokio::test]
async fn a_moved_version_with_no_recorded_content_conflicts() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().lease.base_content = None;
    stamp(&h, "stamped");
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
    assert_eq!(s.updates, 0);
}

#[tokio::test]
async fn an_edit_before_the_send_is_never_sent() {
    let h = harness(Some(DraftStage::Ready));
    edit(&h, "remote-edit");
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
    assert_eq!(s.submissions, 0);
}

#[tokio::test]
async fn an_update_refused_by_a_stamp_is_written_at_the_new_version() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().refusals = 2;
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(s.failure.is_none(), "{:?}", s.failure);
    assert_eq!(s.updates, 3);
    assert_eq!(
        s.lease.checkpoint.as_ref().unwrap().stage,
        DraftStage::Attachments
    );
}

#[tokio::test]
async fn an_update_refused_every_time_conflicts_after_three_writes() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().refusals = usize::MAX;
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
    assert_eq!(s.updates, 3);
}

#[tokio::test]
async fn an_update_refused_by_an_edit_is_not_written_again() {
    let h = harness(Some(DraftStage::Inspect));
    {
        let mut s = h.0.lock().unwrap();
        s.refusals = 1;
        s.refused_by_edit = Some("edited-between-read-and-write".into());
    }
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
    assert_eq!(s.updates, 1);
}

#[tokio::test]
async fn a_stamped_draft_sends_only_with_the_files_the_person_approved() {
    for (attachments, sends) in [
        (vec![uploaded("notes.txt")], 1),
        (vec![], 0),
        (vec![uploaded("replaced.txt")], 0),
    ] {
        let h = harness(Some(DraftStage::Ready));
        stamp(&h, "stamped");
        {
            let mut s = h.0.lock().unwrap();
            let checkpoint = s.lease.checkpoint.as_mut().unwrap();
            checkpoint.prepared.files.push(file());
            s.attachments = attachments;
        }
        service(&h).execute_once().await.unwrap();
        let s = h.0.lock().unwrap();
        assert_eq!(s.submissions, sends);
        assert_eq!(s.failure.is_some(), sends == 0);
    }
}

#[tokio::test]
async fn a_discard_deletes_a_stamped_draft_and_keeps_an_edited_one() {
    let h = harness(Some(DraftStage::Deleting));
    h.0.lock().unwrap().lease.delete_requested = true;
    stamp(&h, "stamped");
    service(&h).execute_once().await.unwrap();
    assert_eq!(h.0.lock().unwrap().deletes, 1);

    let h = harness(Some(DraftStage::Deleting));
    h.0.lock().unwrap().lease.delete_requested = true;
    edit(&h, "remote-edit");
    service(&h).execute_once().await.unwrap();
    let s = h.0.lock().unwrap();
    assert_eq!(s.deletes, 0);
    assert!(matches!(s.failure, Some(DraftFailure::Conflict)));
}

#[test]
fn a_change_names_the_fields_that_differ_and_nothing_else() {
    let mut observed = ProviderDraft {
        id: ProviderId::new("draft").unwrap(),
        conversation_id: ProviderId::new("conversation").unwrap(),
        version: Some("v2".into()),
        is_draft: true,
        app_revision: None,
        content_fingerprint: Some("edited".into()),
        field_digests: [
            ("subject".to_owned(), "same".to_owned()),
            ("body".to_owned(), "edited".to_owned()),
        ]
        .into(),
    };
    let prior = |fingerprint: &str| DraftContent {
        fingerprint: fingerprint.into(),
        fields: [
            ("subject".to_owned(), "same".to_owned()),
            ("body".to_owned(), "original".to_owned()),
        ]
        .into(),
    };
    let between = |fingerprint: Option<&str>, observed: &ProviderDraft| {
        DraftChange::between(Some("v1"), fingerprint.map(prior).as_ref(), observed)
    };
    assert_eq!(
        between(Some("original"), &observed),
        Some(DraftChange::Content(vec!["body".into()]))
    );
    assert_eq!(between(None, &observed), Some(DraftChange::Unknown));
    assert_eq!(between(Some("edited"), &observed), None);
    observed.version = Some("v1".into());
    assert_eq!(between(None, &observed), None);
}

#[tokio::test]
async fn a_failed_draft_is_logged_with_its_mailbox_message_and_attempts() {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let attempt = Uuid::now_v7();
    let fail = || async {
        let h = harness(Some(DraftStage::Ready));
        h.0.lock().unwrap().attempts = vec![attempt];
        edit(&h, "remote-edit");
        service(&h).execute_once().await.unwrap();
        let state = h.0.lock().unwrap();
        state.lease.clone()
    };
    // The other tests here reach the same callsites as this one installs its
    // subscriber, and can cache them as disabled. Once this thread has reached
    // them too, recomputing covers every one.
    fail().await;
    tracing::callsite::rebuild_interest_cache();
    let lease = fail().await;

    let link_id = lease.mailbox.link_id.to_string();
    let events = telemetry.events("outlook draft failed");
    let event = events.iter().find(|(_, event)| event["link_id"] == link_id);
    let Some((level, event)) = event else {
        panic!("expected the failure to be logged, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::WARN);
    assert_eq!(event["message_id"], lease.message_id.to_string());
    assert_eq!(event["attempt_ids"], attempt.to_string());
    assert_eq!(event["code"], "draft_conflict");
    assert_eq!(event["stage"], "ready");
    assert_eq!(event["change"], "content");
    assert_eq!(event["changed_fields"], "body");
    let spans = telemetry.spans("outlook.draft.step");
    let span = spans.iter().find(|span| span["mailbox.link_id"] == link_id);
    let Some(span) = span else {
        panic!("expected the step's span, got {spans:?}");
    };
    assert_eq!(span["email.message_id"], lease.message_id.to_string());
    assert_eq!(span["draft.error_code"], "draft_conflict");
}

#[tokio::test]
async fn an_edit_found_at_inspection_names_the_fields_that_changed() {
    let h = harness(Some(DraftStage::Inspect));
    edit(&h, "remote-edit");
    let lease = h.0.lock().unwrap().lease.clone();
    let remote = h.0.lock().unwrap().remote.clone().unwrap();
    assert_eq!(
        DraftChange::between(
            lease.base_version.as_deref(),
            lease.base_content.as_ref(),
            &remote
        ),
        Some(DraftChange::Content(vec!["body".into()]))
    );
}

#[tokio::test]
async fn a_moved_version_without_an_edit_is_logged() {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let send = || async {
        let h = harness(Some(DraftStage::Ready));
        stamp(&h, "stamped");
        service(&h).execute_once().await.unwrap();
        let state = h.0.lock().unwrap();
        state.lease.clone()
    };
    // See the failure log test: the first run registers the callsites.
    send().await;
    tracing::callsite::rebuild_interest_cache();
    let lease = send().await;

    let events = telemetry.events("outlook draft version moved without an edit");
    let link_id = lease.mailbox.link_id.to_string();
    let event = events.iter().find(|(_, event)| event["link_id"] == link_id);
    let Some((level, event)) = event else {
        panic!("expected the moved version to be logged, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::INFO);
    assert_eq!(event["message_id"], lease.message_id.to_string());
    assert_eq!(event["stage"], "ready");
}
