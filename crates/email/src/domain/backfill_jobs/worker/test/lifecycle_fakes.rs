use super::*;
use crate::domain::mailbox::inbox_sync::{InboxSyncAttachmentRecipients, LabelCatalogRepository};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::link::Link;
use models_email::service::{attachment::AttachmentUploadMetadata, label::Label};
use tokio::sync::oneshot;

pub(super) struct LifecycleState {
    pub claim: InitLeaseClaim,
    pub renew: InitLeaseRenewal,
    pub completion: BackfillCompletion,
    pub completion_token: Option<Uuid>,
    pub completion_pending: bool,
    pub renew_completion: bool,
    pub finalize: bool,
    pub labels: Vec<Label>,
    pub stored_labels: Vec<Label>,
    pub thread_count: u64,
    pub totals: Vec<i32>,
    pub progress: BackfillProgress,
    pub message_complete: bool,
    pub attachments: Vec<AttachmentUploadMetadata>,
    pub media: Vec<AttachmentUploadMetadata>,
    pub recipients: InboxSyncAttachmentRecipients,
    pub emails: Vec<String>,
    pub connections: Vec<MacroUserIdStr<'static>>,
    pub refreshes: Vec<(Uuid, BackfillProgress)>,
    pub contact_gate: Option<(oneshot::Sender<()>, oneshot::Receiver<()>)>,
}
impl Default for LifecycleState {
    fn default() -> Self {
        Self {
            claim: InitLeaseClaim::Complete,
            renew: InitLeaseRenewal::Renewed,
            completion: BackfillCompletion::Completed,
            completion_token: None,
            completion_pending: false,
            renew_completion: true,
            finalize: true,
            labels: vec![],
            stored_labels: vec![],
            thread_count: 1,
            totals: vec![],
            progress: BackfillProgress {
                completed_threads: 2,
                total_threads: 10,
                job_complete: false,
            },
            message_complete: false,
            attachments: vec![],
            media: vec![],
            recipients: Default::default(),
            emails: vec![],
            connections: vec![],
            refreshes: vec![],
            contact_gate: None,
        }
    }
}
impl Fake {
    fn lifecycle_call(&self, name: &'static str) -> anyhow::Result<()> {
        self.call(name)
            .map_err(crate::domain::mailbox::connection::ConnectionSourceError::into_original)
    }
}
impl LabelCatalogRepository for Fake {
    type CatalogError = BackfillDatabaseError;
    async fn stored_catalog(&self, _: Uuid) -> Result<Vec<Label>, Self::CatalogError> {
        self.lifecycle_call("catalog")
            .map_err(|source| BackfillDatabaseError {
                source,
                sqlstates: vec![],
            })?;
        Ok(self.0.lock().unwrap().lifecycle.stored_labels.clone())
    }
    async fn delete_stored_catalog(
        &self,
        _: Uuid,
        labels: Vec<String>,
    ) -> Result<u64, Self::CatalogError> {
        self.lifecycle_call("delete_catalog")
            .map_err(|source| BackfillDatabaseError {
                source,
                sqlstates: vec![],
            })?;
        Ok(labels.len() as u64)
    }
    async fn upsert_stored_catalog(&self, labels: Vec<Label>) -> Result<(), Self::CatalogError> {
        self.lifecycle_call("upsert_catalog")
            .map_err(|source| BackfillDatabaseError {
                source,
                sqlstates: vec![],
            })?;
        self.0.lock().unwrap().lifecycle.stored_labels = labels;
        Ok(())
    }
}
impl BackfillInitRepository for Fake {
    async fn claim_init_lease(&self, job: Uuid) -> anyhow::Result<InitLeaseClaim> {
        assert_eq!(job, JOB);
        self.lifecycle_call("init")?;
        Ok(self.0.lock().unwrap().lifecycle.claim)
    }
    async fn renew_init_lease(&self, job: Uuid, _: Uuid) -> anyhow::Result<InitLeaseRenewal> {
        assert_eq!(job, JOB);
        self.lifecycle_call("renew_init")?;
        Ok(self.0.lock().unwrap().lifecycle.renew)
    }
    async fn release_init_lease(&self, job: Uuid, _: Uuid) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.lifecycle_call("release_init")
    }
    async fn update_total_threads(&self, job: Uuid, total: i32) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.lifecycle_call("update_total")?;
        self.0.lock().unwrap().lifecycle.totals.push(total);
        Ok(())
    }
    async fn finalize_initialization(&self, job: Uuid, _: Uuid) -> anyhow::Result<bool> {
        assert_eq!(job, JOB);
        self.lifecycle_call("finalize_init")?;
        Ok(self.0.lock().unwrap().lifecycle.finalize)
    }
}

impl BackfillCompletionRepository for Fake {
    async fn complete_job(&self, job: Uuid, _: Option<Uuid>) -> anyhow::Result<BackfillCompletion> {
        assert_eq!(job, JOB);
        self.lifecycle_call("completed_job")?;
        Ok(self.0.lock().unwrap().lifecycle.completion)
    }
    async fn claim_completion(&self, job: Uuid) -> anyhow::Result<Option<Uuid>> {
        assert_eq!(job, JOB);
        self.lifecycle_call("finalize")?;
        Ok(self.0.lock().unwrap().lifecycle.completion_token)
    }
    async fn completion_pending(&self, job: Uuid) -> anyhow::Result<bool> {
        assert_eq!(job, JOB);
        self.lifecycle_call("completion_pending")?;
        Ok(self.0.lock().unwrap().lifecycle.completion_pending)
    }
    async fn release_completion(&self, job: Uuid, _: Uuid) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.lifecycle_call("release_completion")
    }
    async fn renew_completion(&self, job: Uuid, _: Uuid) -> anyhow::Result<bool> {
        assert_eq!(job, JOB);
        self.lifecycle_call("renew_completion")?;
        Ok(self.0.lock().unwrap().lifecycle.renew_completion)
    }
    async fn retire_completion(&self, job: Uuid, _: Uuid) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.lifecycle_call("retire_completion")
    }
}

impl BackfillFollowupRepository for Fake {
    async fn job_attachments(&self, _: Uuid) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
        self.lifecycle_call("job_attachments")?;
        Ok(self.0.lock().unwrap().lifecycle.attachments.clone())
    }
    async fn thread_attachments(
        &self,
        _: Uuid,
    ) -> anyhow::Result<(Vec<AttachmentUploadMetadata>, Vec<AttachmentUploadMetadata>)> {
        self.lifecycle_call("thread_attachments")?;
        let s = self.0.lock().unwrap();
        Ok((s.lifecycle.attachments.clone(), s.lifecycle.media.clone()))
    }
    async fn attachment_recipients(
        &self,
        _: &[Uuid],
    ) -> anyhow::Result<InboxSyncAttachmentRecipients> {
        self.lifecycle_call("attachment_recipients")?;
        Ok(self.0.lock().unwrap().lifecycle.recipients.clone())
    }
    async fn contact_emails(&self, _: Uuid) -> anyhow::Result<Vec<String>> {
        self.lifecycle_call("contact_emails")?;
        Ok(self.0.lock().unwrap().lifecycle.emails.clone())
    }
}

impl BackfillLifecycleEffects for Fake {
    async fn sync_contacts(&self, _: &Link) -> anyhow::Result<()> {
        self.lifecycle_call("sync_contacts")?;
        let gate = self.0.lock().unwrap().lifecycle.contact_gate.take();
        if let Some((arrived, resume)) = gate {
            let _ = arrived.send(());
            let _ = resume.await;
        }
        Ok(())
    }
    async fn colleague_dms(&self, _: &Link) {
        self.lifecycle_call("colleague_dms").unwrap();
    }
    async fn top_contact_dms(&self, _: &Link) {
        self.lifecycle_call("top_contact_dms").unwrap();
    }
    async fn init_progress(&self, job: Uuid, _: i32) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.lifecycle_call("init_progress")
    }
    async fn increment_threads(&self, job: Uuid) -> anyhow::Result<BackfillProgress> {
        assert_eq!(job, JOB);
        self.lifecycle_call("completed_thread")?;
        Ok(self.0.lock().unwrap().lifecycle.progress)
    }
    async fn increment_messages(&self, job: Uuid, _: &str) -> anyhow::Result<bool> {
        assert_eq!(job, JOB);
        self.lifecycle_call("completed_message")?;
        Ok(self.0.lock().unwrap().lifecycle.message_complete)
    }
    async fn refresh_progress(
        &self,
        _: &MacroUserIdStr<'static>,
        link_id: Uuid,
        progress: BackfillProgress,
    ) {
        self.lifecycle_call("refresh_progress").unwrap();
        self.0
            .lock()
            .unwrap()
            .lifecycle
            .refreshes
            .push((link_id, progress));
    }
    async fn connect_contacts(
        &self,
        _: &MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), rootcause::Report> {
        self.lifecycle_call("connect_contacts")
            .map_err(|e| rootcause::report!("{e}"))?;
        let gate = self.0.lock().unwrap().lifecycle.contact_gate.take();
        if let Some((arrived, resume)) = gate {
            let _ = arrived.send(());
            let _ = resume.await;
        }
        self.0.lock().unwrap().lifecycle.connections = contacts;
        Ok(())
    }
}
