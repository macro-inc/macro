use super::*;
use crate::domain::mailbox::{
    connection::ConnectionSourceError,
    inbox_sync::{InboxSyncPreparation, InboxSyncResync, MessageResyncRepository},
};
use email_api_client::domain::models::{
    CalendarPart, EmailApiError, MessageWithCalendarParts, ThreadListPage,
};
use futures::future::BoxFuture;
use models_email::service::{
    message::{Message, SimpleMessage},
    thread::{Thread, ThreadProviderMap},
};
use std::collections::{HashMap, HashSet, VecDeque};

pub(super) struct ImportState {
    pub fail_at: HashMap<&'static str, usize>,
    pub retrieved: Vec<i32>,
    pub totals: Vec<i32>,
    pub pages: VecDeque<Result<ThreadListPage, EmailApiError>>,
    pub list_calls: Vec<(u32, Option<String>, Vec<String>)>,
    pub sent_ids: Vec<String>,
    pub thread: Result<Vec<MessageWithCalendarParts>, EmailApiError>,
    pub existing_threads: ThreadProviderMap,
    pub existing_messages: HashSet<String>,
    pub stored: Option<SimpleMessage>,
    pub labels: Vec<String>,
    pub pending: VecDeque<Vec<String>>,
    pub snapshots: Vec<Option<InboxSyncResync>>,
    pub persisted: Vec<Message>,
    pub skipped: Vec<SkippedBackfillMessage>,
    pub concurrent: bool,
    pub sqlstate: Option<String>,
}
impl Default for ImportState {
    fn default() -> Self {
        Self {
            fail_at: HashMap::new(),
            retrieved: vec![],
            totals: vec![],
            pages: VecDeque::new(),
            list_calls: vec![],
            sent_ids: vec![],
            thread: Ok(vec![]),
            existing_threads: HashMap::new(),
            existing_messages: HashSet::new(),
            stored: None,
            labels: vec![],
            pending: VecDeque::new(),
            snapshots: vec![],
            persisted: vec![],
            skipped: vec![],
            concurrent: false,
            sqlstate: None,
        }
    }
}
impl Fake {
    fn import_call(&self, name: &'static str) -> Result<(), BackfillDatabaseError> {
        self.call(name).map_err(|e| BackfillDatabaseError {
            source: e.into_original(),
            sqlstates: self
                .0
                .lock()
                .unwrap()
                .import
                .sqlstate
                .iter()
                .cloned()
                .collect(),
        })
    }
}
impl MessageResyncRepository for Fake {
    type ResyncError = BackfillDatabaseError;
    async fn resync_labels(&self, _: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        self.import_call("resync_labels")?;
        Ok(self.0.lock().unwrap().import.labels.clone())
    }
    async fn resync_pending_labels(&self, _: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        self.import_call("resync_pending")?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .import
            .pending
            .pop_front()
            .unwrap_or_default())
    }
}
impl BackfillImportRepository for Fake {
    async fn retrieved_threads(&self, job: Uuid, count: i32) -> Result<(), BackfillDatabaseError> {
        assert_eq!(job, JOB);
        self.import_call("retrieved")?;
        self.0.lock().unwrap().import.retrieved.push(count);
        Ok(())
    }
    async fn existing_threads(
        &self,
        link: Uuid,
        _: &str,
    ) -> Result<ThreadProviderMap, BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("existing_threads")?;
        Ok(self.0.lock().unwrap().import.existing_threads.clone())
    }
    async fn existing_messages(
        &self,
        link: Uuid,
        _: &[String],
    ) -> Result<HashSet<String>, BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("existing_messages")?;
        Ok(self.0.lock().unwrap().import.existing_messages.clone())
    }
    async fn stored_message(
        &self,
        link: Uuid,
        _: &str,
    ) -> Result<Option<SimpleMessage>, BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("stored")?;
        Ok(self.0.lock().unwrap().import.stored.clone())
    }
    async fn insert_thread(
        &self,
        link: Uuid,
        _: &str,
        messages: &mut [Message],
    ) -> Result<Option<(Uuid, Vec<SkippedBackfillMessage>)>, BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("insert_thread")?;
        let mut s = self.0.lock().unwrap();
        s.import.persisted.extend_from_slice(messages);
        if s.import.concurrent {
            Ok(None)
        } else {
            Ok(Some((
                Uuid::from_u128(40),
                std::mem::take(&mut s.import.skipped),
            )))
        }
    }
    async fn insert_messages(
        &self,
        link: Uuid,
        _: Uuid,
        messages: &mut [Message],
    ) -> Result<Vec<SkippedBackfillMessage>, BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("insert_messages")?;
        let mut s = self.0.lock().unwrap();
        s.import.persisted.extend_from_slice(messages);
        Ok(std::mem::take(&mut s.import.skipped))
    }
    async fn insert_message(
        &self,
        link: Uuid,
        _: Uuid,
        message: &mut Message,
        snapshot: Option<&InboxSyncResync>,
    ) -> Result<(), BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("insert_message")?;
        let mut s = self.0.lock().unwrap();
        s.import.persisted.push(message.clone());
        s.import.snapshots.push(snapshot.cloned());
        Ok(())
    }
    async fn invitation_message(
        &self,
        link: Uuid,
        _: &str,
    ) -> Result<(Uuid, Uuid), BackfillDatabaseError> {
        assert_eq!(link, LINK);
        self.import_call("invitation_id")?;
        Ok((Uuid::from_u128(60), Uuid::from_u128(40)))
    }
}
impl InboxSyncPreparation for Fake {
    fn prepare_message<'a>(&'a self, message: &'a mut Message) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.call("prepare").unwrap();
            message.snippet = Some("prepared".into());
        })
    }
    fn prepare_threads<'a>(&'a self, _: &'a mut Vec<Thread>) -> BoxFuture<'a, ()> {
        Box::pin(async { panic!("unused") })
    }
    fn save_invitations<'a>(
        &'a self,
        link: Uuid,
        _: &'a str,
        _: Uuid,
        parts: &'a [CalendarPart],
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            assert_eq!(link, LINK);
            assert!(!parts.is_empty());
            self.call("invitations").unwrap();
        })
    }
}
impl BackfillImportEffects for Fake {
    type WritePermit = Self;
    async fn add_total_threads(&self, job: Uuid, count: i32) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.call("add_total")
            .map_err(ConnectionSourceError::into_original)?;
        self.0.lock().unwrap().import.totals.push(count);
        Ok(())
    }
    async fn delete_listing_progress(&self, job: Uuid) -> anyhow::Result<()> {
        assert_eq!(job, JOB);
        self.call("delete_listing")
            .map_err(ConnectionSourceError::into_original)
    }
    async fn acquire_write(&self) -> anyhow::Result<Option<Self>> {
        self.call("acquire_write")
            .map_err(ConnectionSourceError::into_original)?;
        Ok(self.0.lock().unwrap().slot.then(|| self.clone()))
    }
}
