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
    creates: usize,
    updates: usize,
    submissions: usize,
    submitted_bodies: usize,
    submission_error: Option<EmailApiError>,
    read_error: Option<EmailApiError>,
    additions: usize,
    /// Checkpoints after a provider update that time out on a busy mailbox.
    locked_checkpoints: u32,
    locked_deferred_deliveries: u32,
    release_delays: Vec<u32>,
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
    };
    let checkpoint = stage.map(|stage| DraftCheckpoint {
        revision: 1,
        actor_id: "macro|owner@example.com".into(),
        prepared: prepared.clone(),
        stage,
        stage_started_at: Utc::now(),
        submission_started: matches!(stage, DraftStage::Submitting | DraftStage::Confirming),
        local_contention_retries: 0,
        send_rejection_reason: None,
        send_refusal: None,
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
        creates: 0,
        updates: 0,
        submissions: 0,
        submitted_bodies: 0,
        submission_error: None,
        read_error: None,
        additions: 0,
        locked_checkpoints: 0,
        locked_deferred_deliveries: 0,
        release_delays: Vec::new(),
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
    async fn release_draft(&self, _: &DraftLease, seconds: u32) -> Result<(), MailboxError> {
        self.0.lock().unwrap().release_delays.push(seconds);
        Ok(())
    }
    async fn fail_draft(&self, _: &DraftLease, f: DraftFailure) -> Result<(), MailboxError> {
        let mut s = self.0.lock().unwrap();
        s.failure = Some(f);
        s.stopped = true;
        Ok(())
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
    async fn defer_unsubmitted_delivery(
        &self,
        _: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let mut state = self.0.lock().unwrap();
        if state.locked_deferred_deliveries > 0 {
            state.locked_deferred_deliveries -= 1;
            return Err(MailboxError::database(DatabaseFailure::Sqlstate(
                LOCK_NOT_AVAILABLE.into(),
            )));
        }
        state.lease.checkpoint = Some(checkpoint.clone());
        Ok(())
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
        let mut state = self.0.lock().unwrap();
        if let Some(error) = state.read_error.take() {
            return Err(error);
        }
        Ok(state.remote.clone())
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
        _: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        let mut s = self.0.lock().unwrap();
        s.updates += 1;
        Ok(s.remote.clone().unwrap())
    }
    async fn delete_draft(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &str,
    ) -> Result<(), EmailApiError> {
        self.0.lock().unwrap().remote = None;
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
        if let Some(error) = s.submission_error.take() {
            return Err(error);
        }
        s.submitted_bodies += 1;
        Ok(SubmissionOutcome::Unknown)
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
async fn typed_pre_data_rejection_fails_once_and_retains_the_reason() {
    for reason in [
        SendRejectionReason::ProviderRejected,
        SendRejectionReason::ConnectionUnavailable,
    ] {
        let refusal = matches!(reason, SendRejectionReason::ProviderRejected).then_some(
            models_email::service::message::SubmissionRefusal {
                phase: models_email::service::message::SubmissionRefusalPhase::Recipient,
                recipient_index: Some(1),
                reply_class: Some(
                    models_email::service::message::SubmissionRefusalClass::Permanent,
                ),
            },
        );
        let h = harness(Some(DraftStage::Ready));
        h.0.lock().unwrap().submission_error = Some(EmailApiError::SendRejected {
            reason,
            refusal,
            message: "Synthetic definite non-submission".into(),
        });
        let service = service(&h);
        assert!(service.execute_once().await.unwrap());
        assert!(matches!(
            h.0.lock().unwrap().failure,
            Some(DraftFailure::SendRejected)
        ));
        assert_eq!(
            h.0.lock()
                .unwrap()
                .lease
                .checkpoint
                .as_ref()
                .unwrap()
                .send_rejection_reason,
            Some(reason)
        );
        assert_eq!(
            h.0.lock()
                .unwrap()
                .lease
                .checkpoint
                .as_ref()
                .unwrap()
                .send_refusal,
            refusal
        );
        assert_eq!(h.0.lock().unwrap().submissions, 1);
        assert!(!service.execute_once().await.unwrap());
        assert_eq!(h.0.lock().unwrap().submissions, 1);
    }
}

#[tokio::test]
async fn pre_data_checkpoint_recovers_failure_without_a_read_or_another_submit() {
    let h = harness(Some(DraftStage::Submitting));
    {
        let mut state = h.0.lock().unwrap();
        state
            .lease
            .checkpoint
            .as_mut()
            .unwrap()
            .send_rejection_reason = Some(SendRejectionReason::ConnectionUnavailable);
        state.read_error = Some(EmailApiError::Transient {
            message: "Synthetic service outage".into(),
        });
    }
    assert!(service(&h).execute_once().await.unwrap());
    let state = h.0.lock().unwrap();
    assert!(matches!(state.failure, Some(DraftFailure::SendRejected)));
    assert!(state.read_error.is_some());
    assert_eq!(state.submissions, 0);
}

#[tokio::test]
async fn generic_service_failure_has_no_pre_data_certainty_and_never_replays() {
    let h = harness(Some(DraftStage::Ready));
    h.0.lock().unwrap().submission_error = Some(EmailApiError::Transient {
        message: "Synthetic generic 503".into(),
    });
    let service = service(&h);
    assert!(service.execute_once().await.is_err());
    assert!(
        h.0.lock()
            .unwrap()
            .lease
            .checkpoint
            .as_ref()
            .unwrap()
            .send_rejection_reason
            .is_none()
    );
    assert!(service.execute_once().await.unwrap());
    assert!(h.0.lock().unwrap().failure.is_none());
    h.0.lock()
        .unwrap()
        .lease
        .checkpoint
        .as_mut()
        .unwrap()
        .stage_started_at = Utc::now() - UNCERTAIN_WAIT - Duration::seconds(1);
    assert!(service.execute_once().await.unwrap());
    assert!(matches!(
        h.0.lock().unwrap().failure,
        Some(DraftFailure::SendUnknown)
    ));
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
async fn reconciliation_read_outages_cannot_extend_the_unknown_send_deadline() {
    let h = harness(Some(DraftStage::Confirming));
    {
        let mut state = h.0.lock().unwrap();
        state.read_error = Some(EmailApiError::Transient {
            message: "Synthetic provider read outage".into(),
        });
        state.lease.checkpoint.as_mut().unwrap().stage_started_at =
            Utc::now() - Duration::minutes(11);
    }
    assert!(service(&h).execute_once().await.unwrap());
    let state = h.0.lock().unwrap();
    assert!(matches!(state.failure, Some(DraftFailure::SendUnknown)));
    assert_eq!(state.submissions, 0);
}

#[tokio::test]
async fn remote_edit_conflicts_without_overwriting_the_local_revision() {
    let h = harness(Some(DraftStage::Inspect));
    h.0.lock().unwrap().remote.as_mut().unwrap().version = Some("remote-edit".into());
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
    h.0.lock().unwrap().remote.as_mut().unwrap().version =
        Some("remote-edit-after-our-patch".into());
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
async fn confirmation_permission_failures_do_not_claim_non_delivery() {
    for error in [
        EmailApiError::Forbidden,
        EmailApiError::Conflict,
        EmailApiError::Permanent {
            message: "Synthetic read refusal".into(),
        },
    ] {
        let h = harness(Some(DraftStage::Confirming));
        h.0.lock().unwrap().read_error = Some(error);
        assert!(service(&h).execute_once().await.unwrap());
        {
            let mut state = h.0.lock().unwrap();
            assert!(state.failure.is_none());
            assert_eq!(state.submissions, 0);
            state.lease.checkpoint.as_mut().unwrap().stage_started_at =
                Utc::now() - Duration::minutes(11);
        }
        assert!(service(&h).execute_once().await.unwrap());
        assert!(matches!(
            h.0.lock().unwrap().failure,
            Some(DraftFailure::SendUnknown)
        ));
        assert_eq!(h.0.lock().unwrap().submissions, 0);
    }
}

#[tokio::test]
async fn revoked_access_after_submission_preserves_the_unknown_outcome_without_provider_io() {
    let h = harness(Some(DraftStage::Submitting));
    h.0.lock().unwrap().authorized = false;
    assert!(service(&h).execute_once().await.unwrap());
    let state = h.0.lock().unwrap();
    assert!(matches!(state.failure, Some(DraftFailure::SendUnknown)));
    assert_eq!(state.submissions, 0);
}

#[tokio::test]
async fn a_due_send_retries_local_account_contention_promptly_without_shortening_provider_backoff()
{
    for (origin, expected) in [
        (RateLimitOrigin::Local, 5),
        (RateLimitOrigin::Provider { concurrency: false }, 60),
    ] {
        let h = harness(Some(DraftStage::Ready));
        {
            let mut state = h.0.lock().unwrap();
            state.lease.input.send_time = Some(Utc::now() - Duration::seconds(1));
            state.read_error = Some(EmailApiError::RateLimited {
                retry_after: Some(std::time::Duration::from_secs(60)),
                origin,
            });
        }
        assert!(service(&h).execute_once().await.is_err());
        assert_eq!(h.0.lock().unwrap().release_delays, [expected]);
        assert!(service(&h).execute_once().await.unwrap());
        assert_eq!(h.0.lock().unwrap().submissions, 1);
    }
}

#[tokio::test]
async fn local_contention_at_submit_returns_to_ready_and_retries_without_a_failed_send() {
    let h = harness(Some(DraftStage::Ready));
    h.0.lock().unwrap().submission_error = Some(EmailApiError::RateLimited {
        retry_after: Some(std::time::Duration::from_secs(60)),
        origin: RateLimitOrigin::Local,
    });
    assert!(matches!(
        service(&h).execute_once().await,
        Err(MailboxError::Provider(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Local,
            ..
        }))
    ));
    {
        let state = h.0.lock().unwrap();
        assert!(state.failure.is_none());
        let checkpoint = state.lease.checkpoint.as_ref().unwrap();
        assert_eq!(checkpoint.stage, DraftStage::Ready);
        assert!(!checkpoint.submission_started);
        assert_eq!(state.release_delays, [5]);
        assert_eq!(state.submitted_bodies, 0);
    }
    assert!(service(&h).execute_once().await.unwrap());
    assert_eq!(h.0.lock().unwrap().submitted_bodies, 1);
}

#[tokio::test(start_paused = true)]
async fn an_unsent_local_retry_survives_a_momentarily_locked_reset() {
    let h = harness(Some(DraftStage::Ready));
    {
        let mut state = h.0.lock().unwrap();
        state.locked_deferred_deliveries = 2;
        state.submission_error = Some(EmailApiError::RateLimited {
            retry_after: Some(std::time::Duration::from_secs(5)),
            origin: RateLimitOrigin::Local,
        });
    }
    let started = tokio::time::Instant::now();
    assert!(matches!(
        service(&h).execute_once().await,
        Err(MailboxError::Provider(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Local,
            ..
        }))
    ));
    assert_eq!(started.elapsed(), 2 * AFTER_PROVIDER_RETRY_DELAY);
    {
        let state = h.0.lock().unwrap();
        assert_eq!(state.locked_deferred_deliveries, 0);
        assert_eq!(
            state.lease.checkpoint.as_ref().unwrap().stage,
            DraftStage::Ready
        );
        assert!(!state.lease.checkpoint.as_ref().unwrap().submission_started);
        assert!(state.failure.is_none());
        assert_eq!(state.submitted_bodies, 0);
    }
    assert!(service(&h).execute_once().await.unwrap());
    assert_eq!(h.0.lock().unwrap().submitted_bodies, 1);
}

#[tokio::test]
async fn repeated_local_contention_backs_off_and_progress_clears_the_count() {
    let h = harness(Some(DraftStage::Ready));
    for expected in [5, 10, 20, 40, 60, 60] {
        h.0.lock().unwrap().submission_error = Some(EmailApiError::RateLimited {
            retry_after: Some(std::time::Duration::from_secs(5)),
            origin: RateLimitOrigin::Local,
        });
        assert!(service(&h).execute_once().await.is_err());
        let state = h.0.lock().unwrap();
        assert_eq!(state.release_delays.last().copied(), Some(expected));
        assert_eq!(state.submitted_bodies, 0);
        assert!(state.failure.is_none());
    }
    assert!(service(&h).execute_once().await.unwrap());
    let state = h.0.lock().unwrap();
    assert_eq!(state.submitted_bodies, 1);
    assert_eq!(
        state
            .lease
            .checkpoint
            .as_ref()
            .unwrap()
            .local_contention_retries,
        0
    );
}
