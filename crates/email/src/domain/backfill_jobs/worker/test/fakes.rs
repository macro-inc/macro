use super::*;
use crate::domain::backfill_jobs::BackfillJobRepository;
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::mailbox::inbox_sync::CrmContactRecipient;
use ::crm::domain::{
    email_privacy::EmailContributionMailbox,
    model::{CrmError, DepopulateContactOutcome},
};
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts};
use futures::future::BoxFuture;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(10);
pub(super) const JOB: Uuid = Uuid::from_u128(20);
pub(super) const TEAM: Uuid = Uuid::from_u128(30);

pub(super) struct State {
    pub calls: Vec<&'static str>,
    pub import: super::import_fakes::ImportState,
    pub faults: HashSet<&'static str>,
    pub job: Option<BackfillJob>,
    pub link: Option<Link>,
    pub team: Option<Uuid>,
    pub consent: bool,
    pub crm_contended: bool,
    pub document: bool,
    pub remaining_messages: bool,
    pub failed_transition: bool,
    pub slot: bool,
    pub provider: Result<Option<MessageWithCalendarParts>, EmailApiError>,
    pub upload: Option<BackfillUploadError>,
    pub removed: DepopulateContactOutcome,
    pub sent_contacts: Vec<CrmContactRecipient>,
    pub received_contacts: Vec<CrmContactRecipient>,
    pub sent: Vec<(BackfillPubsubMessage, Option<(i32, u32)>)>,
    pub connections: Vec<HashSet<MacroUserIdStr<'static>>>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            calls: vec![],
            import: Default::default(),
            faults: HashSet::new(),
            job: Some(job()),
            link: Some(link()),
            team: Some(TEAM),
            consent: true,
            crm_contended: true,
            document: false,
            remaining_messages: false,
            failed_transition: true,
            slot: true,
            provider: Ok(None),
            upload: None,
            removed: DepopulateContactOutcome::default(),
            sent_contacts: vec![],
            received_contacts: vec![],
            sent: vec![],
            connections: vec![],
        }
    }
}
#[derive(Clone, Default)]
pub(super) struct Fake(pub Arc<Mutex<State>>);
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct Error(&'static str);
impl ConnectionSourceError for Error {
    fn into_original(self) -> anyhow::Error {
        anyhow::anyhow!(self.0)
    }
}
impl Fake {
    pub fn call(&self, name: &'static str) -> Result<(), Error> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(name);
        if s.faults.contains(name)
            || s.import
                .fail_at
                .get(name)
                .is_some_and(|nth| *nth == s.calls.iter().filter(|called| **called == name).count())
        {
            Err(Error(name))
        } else {
            Ok(())
        }
    }
    pub fn calls(&self) -> Vec<&'static str> {
        self.0.lock().unwrap().calls.clone()
    }
    pub fn fail(&self, name: &'static str) {
        self.0.lock().unwrap().faults.insert(name);
    }
    fn crm_call(&self, name: &'static str) -> Result<(), CrmError> {
        self.call(name).map_err(|_| {
            if self.0.lock().unwrap().crm_contended {
                CrmError::Contended
            } else {
                CrmError::InvalidRequest("provider failure".into())
            }
        })
    }
}
pub(super) fn setup() -> (BackfillService<Fake, Fake, Fake, Fake, Fake, Fake>, Fake) {
    let f = Fake::default();
    (
        BackfillService {
            repository: f.clone(),
            gmail: f.clone(),
            queue: f.clone(),
            effects: f.clone(),
            crm: f.clone(),
            legacy: f.clone(),
            contacts_sync: true,
        },
        f,
    )
}
pub(super) fn link() -> Link {
    Link {
        id: LINK,
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        fusionauth_user_id: "owner".into(),
        email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}
pub(super) fn job() -> BackfillJob {
    BackfillJob {
        id: JOB,
        link_id: Some(LINK),
        fusionauth_user_id: "owner".into(),
        threads_requested_limit: None,
        total_threads: 1,
        status: BackfillJobStatus::InProgress,
        threads_retrieved_count: 1,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}
pub(super) fn scope<P>(payload: P) -> JobScopedPayload<P> {
    JobScopedPayload {
        link_id: LINK,
        job_id: JOB,
        payload,
    }
}
pub(super) fn input(operation: BackfillOperation) -> BackfillPubsubMessage {
    BackfillPubsubMessage {
        backfill_operation: operation,
    }
}
pub(super) fn metadata() -> BackfillPubsubMessage {
    input(BackfillOperation::UpdateThreadMetadata(scope(
        UpdateMetadataPayload {
            thread_db_id: Uuid::from_u128(40),
            thread_provider_id: "thread".into(),
        },
    )))
}
pub(super) fn crm_population() -> BackfillPubsubMessage {
    input(BackfillOperation::PopulateCrmContact(LinkScopedPayload {
        link_id: LINK,
        payload: PopulateCrmContactPayload {
            contact_email: "contact@example.com".into(),
            contact_name: None,
            first_at: Default::default(),
            last_at: Default::default(),
            is_sent: true,
        },
    }))
}
pub(super) fn crm_depopulation() -> BackfillPubsubMessage {
    input(BackfillOperation::DepopulateCrmContact(LinkScopedPayload {
        link_id: LINK,
        payload: DepopulateCrmContactPayload {
            contact_email: "contact@example.com".into(),
        },
    }))
}
pub(super) fn seed() -> BackfillPubsubMessage {
    input(BackfillOperation::SeedSentContact(scope(
        SeedSentContactPayload {
            message_provider_id: "message".into(),
        },
    )))
}
pub(super) fn population() -> BackfillPubsubMessage {
    input(BackfillOperation::PopulateCrmForUser(
        PopulateCrmForUserPayload {
            macro_id: link().macro_id,
        },
    ))
}
pub(super) fn depopulation() -> BackfillPubsubMessage {
    input(BackfillOperation::DepopulateCrmForUser(
        DepopulateCrmForUserPayload {
            macro_id: link().macro_id,
            team_id: TEAM,
        },
    ))
}

impl BackfillJobRepository for Fake {
    type Err = Error;
    async fn job(&self, id: Uuid) -> Result<Option<BackfillJob>, Error> {
        assert_eq!(id, JOB);
        self.call("job")?;
        Ok(self.0.lock().unwrap().job.clone())
    }
    async fn job_in_inbox(&self, _: Uuid, _: Uuid) -> Result<Option<BackfillJob>, Error> {
        panic!("unused")
    }
    async fn jobs_for_user(&self, _: &str) -> Result<Vec<BackfillJob>, Error> {
        panic!("unused")
    }
    async fn active_job(&self, _: Uuid) -> Result<Option<BackfillJob>, Error> {
        panic!("unused")
    }
    async fn inbox(&self, _: Uuid) -> Result<Option<Link>, Error> {
        panic!("unused")
    }
    async fn insert(
        &self,
        _: Uuid,
        _: &str,
        _: Option<i32>,
        _: bool,
    ) -> Result<Option<BackfillJob>, Error> {
        panic!("unused")
    }
    async fn set_status(&self, _: Uuid, _: BackfillJobStatus) -> Result<(), Error> {
        panic!("unused")
    }
    async fn fail_active(&self, id: Uuid) -> Result<bool, Error> {
        assert_eq!(id, JOB);
        self.call("fail")?;
        Ok(self.0.lock().unwrap().failed_transition)
    }
}
impl BackfillRepository for Fake {
    type Err = Error;
    type Jobs = Self;
    type Metadata = Self;
    fn jobs(&self) -> &Self {
        self
    }
    async fn link(&self, id: Uuid) -> Result<Option<Link>, Error> {
        assert_eq!(id, LINK);
        self.call("link")?;
        Ok(self.0.lock().unwrap().link.clone())
    }
    async fn link_by_email(&self, owner: &str, email: &str) -> Result<Option<Link>, Error> {
        assert_eq!(owner, "macro|owner@example.com");
        assert_eq!(email, "owner@example.com");
        self.call("link_by_email")?;
        Ok(self.0.lock().unwrap().link.clone())
    }
    async fn attachment_document(&self, id: Uuid, _: Uuid) -> Result<Option<String>, Error> {
        assert_eq!(id, LINK);
        self.call("document")?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .document
            .then_some("document".to_string()))
    }
    async fn has_contact_messages(&self, id: Uuid, email: &str) -> Result<bool, Error> {
        assert_eq!(id, LINK);
        assert_eq!(email, "contact@example.com");
        self.call("remaining")?;
        Ok(self.0.lock().unwrap().remaining_messages)
    }
    async fn sent_contacts(&self, id: Uuid) -> Result<Vec<CrmContactRecipient>, Error> {
        assert_eq!(id, LINK);
        self.call("sent_contacts")?;
        Ok(self.0.lock().unwrap().sent_contacts.clone())
    }
    async fn received_contacts(&self, id: Uuid) -> Result<Vec<CrmContactRecipient>, Error> {
        assert_eq!(id, LINK);
        self.call("received_contacts")?;
        Ok(self.0.lock().unwrap().received_contacts.clone())
    }
    async fn begin_metadata(&self) -> Result<Self, Error> {
        self.call("begin")?;
        Ok(self.clone())
    }
    async fn republish_completion(&self, id: Uuid) {
        assert_eq!(id, JOB);
        let _ = self.call("republish");
    }
}
impl BackfillMetadataTransaction for Fake {
    async fn update_metadata(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> Result<(), BackfillDatabaseError> {
        assert_eq!(thread, Uuid::from_u128(40));
        assert_eq!(link, LINK);
        self.call("metadata").map_err(|e| BackfillDatabaseError {
            source: e.into_original(),
            sqlstates: vec![],
        })
    }
    async fn update_replying_to(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> Result<(), BackfillDatabaseError> {
        assert_eq!(thread, Uuid::from_u128(40));
        assert_eq!(link, LINK);
        self.call("replying_to").map_err(|e| BackfillDatabaseError {
            source: e.into_original(),
            sqlstates: vec![],
        })
    }
    async fn complete(self, result: Result<(), ProcessingError>) -> Result<(), ProcessingError> {
        let step = if result.is_ok() { "commit" } else { "rollback" };
        self.call(step).map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })?;
        result
    }
}
impl BackfillGmail for Fake {
    fn list_threads<'a>(
        &'a self,
        _: Uuid,
        limit: u32,
        next: Option<&'a str>,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<email_api_client::domain::models::ThreadListPage, EmailApiError>>
    {
        Box::pin(async move {
            self.call("list_threads")
                .map_err(|e| EmailApiError::Transient {
                    message: e.to_string(),
                })?;
            let mut s = self.0.lock().unwrap();
            s.import.list_calls.push((
                limit,
                next.map(str::to_owned),
                labels.iter().map(|s| s.to_string()).collect(),
            ));
            s.import.pages.pop_front().unwrap_or_else(|| {
                Ok(email_api_client::domain::models::ThreadListPage {
                    threads: vec![],
                    next_page_token: None,
                })
            })
        })
    }
    fn list_messages<'a>(
        &'a self,
        _: Uuid,
        limit: u32,
        labels: &'a [&'a str],
    ) -> BoxFuture<'a, Result<Vec<String>, EmailApiError>> {
        Box::pin(async move {
            assert_eq!(limit, 200);
            assert_eq!(labels, ["SENT"]);
            self.call("list_sent")
                .map_err(|e| EmailApiError::Transient {
                    message: e.to_string(),
                })?;
            Ok(self.0.lock().unwrap().import.sent_ids.clone())
        })
    }
    fn thread<'a>(
        &'a self,
        _: Uuid,
        _: &'a str,
    ) -> BoxFuture<
        'a,
        Result<Vec<email_api_client::domain::models::MessageWithCalendarParts>, EmailApiError>,
    > {
        Box::pin(async move {
            self.call("get_thread")
                .map_err(|e| EmailApiError::Transient {
                    message: e.to_string(),
                })?;
            std::mem::replace(&mut self.0.lock().unwrap().import.thread, Ok(vec![]))
        })
    }

    fn message<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
    ) -> BoxFuture<'a, Result<Option<MessageWithCalendarParts>, EmailApiError>> {
        Box::pin(async move {
            assert_eq!(link, LINK);
            assert_eq!(provider, "message");
            self.call("provider").unwrap();
            std::mem::replace(&mut self.0.lock().unwrap().provider, Ok(None))
        })
    }
}
impl BackfillQueue for Fake {
    type Err = Error;
    async fn enqueue(&self, data: BackfillPubsubMessage) -> Result<(), Error> {
        self.call("enqueue")?;
        self.0.lock().unwrap().sent.push((data, None));
        Ok(())
    }
    async fn defer(
        &self,
        data: &BackfillPubsubMessage,
        seconds: i32,
        deferrals: u32,
    ) -> Result<(), Error> {
        self.call("defer")?;
        self.0.lock().unwrap().sent.push((
            BackfillPubsubMessage {
                backfill_operation: data.backfill_operation.clone(),
            },
            Some((seconds, deferrals)),
        ));
        Ok(())
    }
}
impl MacroEventBroker for Fake {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.call("event")
            .map_err(|_| EventBrokerError::Publish("broker unavailable".into()))?;
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
impl BackfillEffects for Fake {
    type Permit = Self;
    async fn delete_job_progress(&self, id: Uuid) {
        assert_eq!(id, JOB);
        let _ = self.call("delete_job_progress");
    }
    async fn delete_thread_progress(&self, id: Uuid, thread: &str) {
        assert_eq!(id, JOB);
        assert_eq!(thread, "thread");
        let _ = self.call("delete_thread_progress");
    }
    async fn upload(
        &self,
        _: &Link,
        _: &BackfillAttachmentPayload,
    ) -> Result<(), BackfillUploadError> {
        self.call("upload").unwrap();
        match self.0.lock().unwrap().upload.take() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    async fn connect(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), rootcause::Report> {
        self.call("connect").map_err(rootcause::Report::new)?;
        self.0.lock().unwrap().connections.push(users);
        Ok(())
    }
    async fn acquire_crm(&self, team: Uuid) -> anyhow::Result<Option<Self>> {
        assert_eq!(team, TEAM);
        self.call("acquire")
            .map_err(ConnectionSourceError::into_original)?;
        Ok(self.0.lock().unwrap().slot.then(|| self.clone()))
    }
    async fn notify_failed(&self, link: &Link) {
        assert_eq!(link.id, LINK);
        let _ = self.call("notify");
    }
}
impl BackfillWritePermit for Fake {
    async fn hold<F: Future + Send>(self, work: F) -> F::Output
    where
        F::Output: Send,
    {
        self.call("hold").unwrap();
        let result = work.await;
        self.call("release").unwrap();
        result
    }
}
impl BackfillCrm for Fake {
    async fn get_team_id_for_user(&self, user: &str) -> Result<Option<Uuid>, CrmError> {
        assert_eq!(user, "macro|owner@example.com");
        self.crm_call("team")?;
        Ok(self.0.lock().unwrap().team)
    }
    async fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        assert_eq!(team, TEAM);
        assert_eq!(user, "macro|owner@example.com");
        self.crm_call("consent")?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .consent
            .then(|| EmailContributionMailbox {
                link_id: LINK,
                email_address: "OWNER@example.com".into(),
            }))
    }
    async fn populate_contact(
        &self,
        team: &Uuid,
        link: &Link,
        p: &PopulateCrmContactPayload,
    ) -> Result<(), CrmError> {
        assert_eq!(*team, TEAM);
        assert_eq!(link.id, LINK);
        assert_eq!(p.contact_email, "contact@example.com");
        self.crm_call("populate")
    }
    async fn depopulate_contact(
        &self,
        team: &Uuid,
        link: &Uuid,
        email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        assert_eq!(*team, TEAM);
        assert_eq!(*link, LINK);
        assert_eq!(email, "contact@example.com");
        self.crm_call("depopulate")?;
        Ok(self.0.lock().unwrap().removed)
    }
    async fn depopulate_link_in_team(&self, team: &Uuid, link: &Uuid) -> Result<(), CrmError> {
        assert_eq!(*team, TEAM);
        assert_eq!(*link, LINK);
        self.crm_call("depopulate_link")
    }
}
impl LegacyBackfill for Fake {
    async fn init(
        &self,
        _: &JobScopedPayload<InitPayload>,
        _: &Link,
        _: &BackfillJob,
    ) -> Result<(), ProcessingError> {
        self.call("init").unwrap();
        Ok(())
    }
    async fn completed_job(&self, _: Uuid) -> Result<(), ProcessingError> {
        self.call("completed_job").map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })
    }
    async fn thread_attachments(&self, _: &Link, _: Uuid, _: Uuid) -> Result<(), ProcessingError> {
        self.call("thread_attachments").map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })
    }
    async fn enqueue_metadata(
        &self,
        _: &Link,
        _: Uuid,
        _: &str,
        _: Uuid,
    ) -> Result<(), ProcessingError> {
        self.call("enqueue_metadata").map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::SqsEnqueueFailed,
                source: e.into_original(),
            })
        })
    }
    async fn finalize(&self, _: Uuid, _: Uuid) -> Result<(), ProcessingError> {
        self.call("finalize").unwrap();
        Ok(())
    }
    async fn completed_thread(&self, _: &Link, _: Uuid) -> Result<(), ProcessingError> {
        self.call("completed_thread").map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })
    }
    async fn completed_message(
        &self,
        _: &Link,
        _: Uuid,
        _: &BackfillMessagePayload,
    ) -> Result<(), ProcessingError> {
        self.call("completed_message").map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: models_email::service::pubsub::FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })
    }
}

pub(super) fn provider_message(
    link_id: Uuid,
    thread_db_id: Uuid,
) -> models_email::service::message::Message {
    let now = chrono::DateTime::default();
    models_email::service::message::Message {
        db_id: Uuid::from_u128(60),
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

pub(super) fn attachment() -> BackfillPubsubMessage {
    use models_email::service::attachment::{
        AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
    };
    input(BackfillOperation::BackfillAttachment(scope(
        BackfillAttachmentPayload {
            metadata: AttachmentUploadArgs {
                attachment_metadata: AttachmentUploadMetadata {
                    attachment_db_id: Uuid::from_u128(50),
                    email_provider_id: "message".into(),
                    provider_attachment_id: "attachment".into(),
                    mime_type: "application/pdf".into(),
                    filename: Some("file.pdf".into()),
                    internal_date_ts: Default::default(),
                    message_db_id: Uuid::from_u128(60),
                    thread_db_id: Uuid::from_u128(40),
                    sender_email: None,
                    subject: None,
                },
                recipient_emails: vec![],
                backfill: true,
                upload_destination: AttachmentUploadDestination::Dss,
            },
        },
    )))
}
