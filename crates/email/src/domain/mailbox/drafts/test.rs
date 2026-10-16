use super::*;
use crate::domain::{mailbox::MailboxKey, models::ResolvedDraftInput};
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
    additions: usize,
}

fn harness(stage: Option<DraftStage>) -> Harness {
    let message = Uuid::now_v7();
    let link = Uuid::now_v7();
    let input:ResolvedDraftInput = serde_json::from_value(serde_json::json!({"db_id":message,"thread_db_id":Uuid::now_v7(),"subject":"Saved locally","to":[],"cc":[],"bcc":[],"actor_id":"macro|owner@example.com"})).unwrap();
    let prepared = PreparedDraft {
        reply_to: None,
        request: SendRequest {
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
        additions: 0,
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
        self.0.lock().unwrap().lease.checkpoint = Some(c.clone());
        Ok(())
    }
    async fn release_draft(&self, _: &DraftLease, _: u32) -> Result<(), MailboxError> {
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
