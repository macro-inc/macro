use super::{
    fakes::{Call, Failure, Fake, LINK, MESSAGE, THREAD},
    *,
};
use crate::domain::{
    backfill_jobs::BackfillJobRepository,
    models::{EmailThreadPreview, PreviewCursorQuery},
};
use email_api_client::domain::models::{
    CalendarPart, ChangeBatch, EmailApiError, InboxChanges, MessageWithCalendarParts, SyncCursor,
};
use futures::future::BoxFuture;
use models_email::service;
use models_email::service::{
    attachment::{Attachment, AttachmentUploadArgs, AttachmentUploadMetadata},
    backfill::{BackfillJob, BackfillJobStatus},
};
use std::collections::{HashMap, VecDeque};

pub(super) struct ImportState {
    pub history: Option<String>,
    pub committed: Option<service::message::SimpleMessage>,
    pub provider_catalog: Result<Vec<service::label::Label>, EmailApiError>,
    pub catalog: Vec<service::label::Label>,
    pub changes: Result<ChangeBatch, EmailApiError>,
    pub fetched: Result<Option<MessageWithCalendarParts>, EmailApiError>,
    pub thread_messages: Result<Vec<MessageWithCalendarParts>, EmailApiError>,
    pub thread_exists: bool,
    pub jobs: VecDeque<Option<BackfillJob>>,
    pub insert_job: Option<BackfillJob>,
    pub documents: Vec<AttachmentUploadMetadata>,
    pub media: Vec<AttachmentUploadMetadata>,
    pub upload_results: VecDeque<Result<String, InboxSyncUploadError>>,
    pub senders: HashMap<Uuid, service::address::ContactInfo>,
    pub primaries: Vec<String>,
    pub previews: VecDeque<bool>,
    pub labels_during_fetch: Option<Vec<String>>,
}
impl Default for ImportState {
    fn default() -> Self {
        Self {
            committed: Some(super::fakes::message()),
            history: Some("100".into()),
            provider_catalog: Ok(vec![]),
            catalog: vec![],
            changes: Ok(ChangeBatch::new(
                InboxChanges::default(),
                SyncCursor::gmail("101"),
            )),
            fetched: Ok(None),
            thread_messages: Ok(vec![]),
            thread_exists: true,
            jobs: VecDeque::new(),
            insert_job: Some(job()),
            documents: vec![],
            media: vec![],
            upload_results: VecDeque::new(),
            senders: HashMap::new(),
            primaries: vec![],
            previews: VecDeque::new(),
            labels_during_fetch: None,
        }
    }
}
pub(super) fn job() -> BackfillJob {
    BackfillJob {
        id: Uuid::from_u128(50),
        link_id: Some(LINK),
        fusionauth_user_id: "fixture-owner".into(),
        threads_requested_limit: None,
        total_threads: 0,
        status: BackfillJobStatus::Init,
        threads_retrieved_count: 0,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}
impl Fake {
    fn io(&self, name: &'static str, value: impl serde::Serialize) -> Result<(), Failure> {
        self.step(
            name,
            Call::Import(name, serde_json::to_value(value).unwrap()),
        )
    }
}
impl InboxSyncHistoryFacts for Fake {
    async fn history_id(&self, address: &str) -> Result<Option<String>, Failure> {
        self.io("history", address)?;
        Ok(self.0.lock().unwrap().import.history.clone())
    }
    async fn repair_history(&self, _: Uuid, history: &str) -> Result<(), Failure> {
        self.io("repair", history)
    }
}
impl InboxSyncCatalog for Fake {
    async fn catalog(&self, _: Uuid) -> Result<Vec<service::label::Label>, Failure> {
        self.io("catalog", ())?;
        Ok(self.0.lock().unwrap().import.catalog.clone())
    }
    async fn delete_catalog(&self, _: Uuid, labels: Vec<String>) -> Result<u64, Failure> {
        self.io("delete_catalog", &labels)?;
        Ok(labels.len() as u64)
    }
    async fn upsert_catalog(&self, labels: Vec<service::label::Label>) -> Result<(), Failure> {
        self.io("upsert_catalog", labels)
    }
}
impl InboxSyncMessageStore for Fake {
    async fn thread_ids(&self, _: Uuid, provider: &str) -> Result<HashMap<String, Uuid>, Failure> {
        self.io("thread_ids", provider)?;
        Ok(if self.0.lock().unwrap().import.thread_exists {
            HashMap::from([(provider.into(), THREAD)])
        } else {
            HashMap::new()
        })
    }
    async fn insert_message(
        &self,
        _: Uuid,
        _: Uuid,
        message: &mut service::message::Message,
        resync: Option<&InboxSyncResync>,
    ) -> Result<(), Failure> {
        self.io(
            "insert_message",
            (
                &message.provider_id,
                resync.map(|r| (&r.stored_labels, &r.pending_labels)),
            ),
        )
    }
    async fn insert_thread(&self, _: Uuid, thread: service::thread::Thread) -> Result<(), Failure> {
        self.io("insert_thread", thread)
    }
    async fn message_ids(&self, _: Uuid, _: &str) -> Result<(Uuid, Uuid), Failure> {
        self.io("message_ids", ())?;
        let mut state = self.0.lock().unwrap();
        state.message = state.import.committed.clone();
        Ok((MESSAGE, THREAD))
    }
}
impl InboxSyncAttachmentStore for Fake {
    async fn document_attachments(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Vec<AttachmentUploadMetadata>, Failure> {
        self.io("documents", ())?;
        Ok(self.0.lock().unwrap().import.documents.clone())
    }
    async fn media_attachments(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Vec<AttachmentUploadMetadata>, Failure> {
        self.io("media", ())?;
        Ok(self.0.lock().unwrap().import.media.clone())
    }
    async fn attachment_recipients(
        &self,
        _: &[Uuid],
    ) -> Result<InboxSyncAttachmentRecipients, Failure> {
        self.io("attachment_recipients", ())?;
        Ok(HashMap::new())
    }
    async fn release_attachment(&self, id: Uuid) -> Result<(), Failure> {
        self.io("release", id)
    }
}
impl InboxSyncNotificationFacts for Fake {
    async fn sender_contacts(
        &self,
        _: &[Uuid],
    ) -> Result<HashMap<Uuid, service::address::ContactInfo>, Failure> {
        self.io("sender_contacts", ())?;
        Ok(self.0.lock().unwrap().import.senders.clone())
    }
    async fn primaries(&self, _: &str, _: Uuid) -> Result<Vec<String>, Failure> {
        self.io("primaries", ())?;
        Ok(self.0.lock().unwrap().import.primaries.clone())
    }
    async fn previews(
        &self,
        _: PreviewCursorQuery,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<EmailThreadPreview>, Failure> {
        self.io("previews", ())?;
        let yes = self
            .0
            .lock()
            .unwrap()
            .import
            .previews
            .pop_front()
            .unwrap_or(false);
        Ok(if yes {
            vec![EmailThreadPreview {
                id: THREAD,
                provider_id: None,
                owner_id: super::fakes::link().macro_id,
                inbox_visible: true,
                is_read: false,
                is_draft: false,
                is_important: true,
                is_signal: true,
                name: None,
                snippet: None,
                sender_email: None,
                sender_name: None,
                sender_photo_url: None,
                sort_ts: Default::default(),
                created_at: Default::default(),
                updated_at: Default::default(),
                viewed_at: None,
                project_id: None,
                link_id: LINK,
            }]
        } else {
            vec![]
        })
    }
}
impl InboxSyncImportGmail for Fake {
    fn catalog(&self, _: Uuid) -> BoxFuture<'_, Result<Vec<service::label::Label>, EmailApiError>> {
        Box::pin(async {
            self.io("provider_catalog", ()).unwrap();
            self.0.lock().unwrap().import.provider_catalog.clone()
        })
    }
    fn changes<'a>(
        &'a self,
        _: Uuid,
        cursor: &'a SyncCursor,
    ) -> BoxFuture<'a, Result<ChangeBatch, EmailApiError>> {
        Box::pin(async move {
            self.io("changes", cursor).unwrap();
            self.0.lock().unwrap().import.changes.clone()
        })
    }
    fn message<'a>(
        &'a self,
        _: Uuid,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Option<MessageWithCalendarParts>, EmailApiError>> {
        Box::pin(async {
            self.io("get_message", ()).unwrap();
            let mut state = self.0.lock().unwrap();
            if let Some(labels) = state.import.labels_during_fetch.take() {
                state.pending.push_back(labels);
            }
            state.import.fetched.clone()
        })
    }
    fn thread<'a>(
        &'a self,
        _: Uuid,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Vec<MessageWithCalendarParts>, EmailApiError>> {
        Box::pin(async {
            self.io("get_thread", ()).unwrap();
            self.0.lock().unwrap().import.thread_messages.clone()
        })
    }
}
impl InboxSyncHistory for Fake {
    type Jobs = Self;
    fn recovery_jobs(&self) -> Self {
        self.clone()
    }
    fn accept_history<'a>(
        &'a self,
        _: Uuid,
        expected: &'a str,
        batch: ChangeBatch,
    ) -> BoxFuture<'a, Result<(), crate::domain::mailbox::MailboxError>> {
        Box::pin(async move {
            self.io("accept", (expected, batch))
                .map_err(|_| crate::domain::mailbox::MailboxError::Persistence)
        })
    }
}
impl BackfillJobRepository for Fake {
    type Err = Failure;
    async fn job(&self, _: Uuid) -> Result<Option<BackfillJob>, Failure> {
        unreachable!()
    }
    async fn job_in_inbox(&self, _: Uuid, _: Uuid) -> Result<Option<BackfillJob>, Failure> {
        unreachable!()
    }
    async fn jobs_for_user(&self, _: &str) -> Result<Vec<BackfillJob>, Failure> {
        unreachable!()
    }
    async fn inbox(&self, _: Uuid) -> Result<Option<Link>, Failure> {
        unreachable!()
    }
    async fn set_status(&self, _: Uuid, _: BackfillJobStatus) -> Result<(), Failure> {
        unreachable!()
    }
    async fn active_job(&self, _: Uuid) -> Result<Option<BackfillJob>, Failure> {
        self.io("active_job", ())?;
        Ok(self.0.lock().unwrap().import.jobs.pop_front().flatten())
    }
    async fn insert(
        &self,
        _: Uuid,
        _: &str,
        limit: Option<i32>,
        recovery: bool,
    ) -> Result<Option<BackfillJob>, Failure> {
        assert_eq!(limit, None);
        assert!(recovery);
        self.io("insert_job", ())?;
        Ok(self.0.lock().unwrap().import.insert_job.clone())
    }
    async fn fail_active(&self, _: Uuid) -> Result<bool, Failure> {
        self.io("fail_job", ())?;
        Ok(true)
    }
}
impl InboxSyncPreparation for Fake {
    fn prepare_message<'a>(&'a self, _: &'a mut service::message::Message) -> BoxFuture<'a, ()> {
        Box::pin(async {
            self.io("prepare_message", ()).unwrap();
        })
    }
    fn prepare_threads<'a>(&'a self, _: &'a mut Vec<service::thread::Thread>) -> BoxFuture<'a, ()> {
        Box::pin(async {
            self.io("prepare_threads", ()).unwrap();
        })
    }
    fn save_invitations<'a>(
        &'a self,
        _: Uuid,
        _: &'a str,
        _: Uuid,
        parts: &'a [CalendarPart],
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.io("invitations", parts.len()).unwrap();
        })
    }
}
impl InboxSyncUploads for Fake {
    fn attachment_eligibility(&self, atts: &[Attachment]) -> (bool, bool) {
        (!atts.is_empty(), !atts.is_empty())
    }
    fn upload<'a>(
        &'a self,
        _: &'a Link,
        args: AttachmentUploadArgs,
    ) -> BoxFuture<'a, Result<String, InboxSyncUploadError>> {
        Box::pin(async move {
            self.io("upload", args).unwrap();
            self.0
                .lock()
                .unwrap()
                .import
                .upload_results
                .pop_front()
                .unwrap_or_else(|| Ok("uploaded".into()))
        })
    }
}
impl InboxSyncContacts for Fake {
    fn connect<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> BoxFuture<'a, anyhow::Result<()>> {
        Box::pin(async move {
            self.io("connect", contacts)
                .map_err(ConnectionSourceError::into_original)
        })
    }
}
impl InboxSyncNotifications for Fake {
    fn notify(&self, value: InboxSyncNotification) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let _ = self.io("notify", (value.recipients, value.realtime, value.apns));
        })
    }
}

use service::message::Message;
pub(super) fn received_message(link_id: Uuid, thread_db_id: Uuid) -> Message {
    let now = chrono::Utc::now();
    Message {
        db_id: Uuid::now_v7(),
        provider_id: Some("provider-message".to_string()),
        thread_db_id,
        provider_thread_id: Some("provider-thread".to_string()),
        replying_to_id: None,
        global_id: Some("<received@example.com>".to_string()),
        link_id,
        subject: Some("hello".to_string()),
        snippet: None,
        provider_history_id: None,
        internal_date_ts: Some(now),
        sent_at: Some(now),
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: false,
        from: None,
        to: vec![],
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_text: Some("body".to_string()),
        body_html_sanitized: None,
        body_macro: None,
        attachments: vec![],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: now,
        updated_at: now,
    }
}
