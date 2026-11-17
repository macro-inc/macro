//! Backfill-specific persistence with the original transaction and savepoint boundaries.
use super::BackfillDatabaseError;
use crate::domain::mailbox::inbox_sync::{InboxSyncResync, MessageResyncRepository};
use models_email::service::{
    message::{Message, SimpleMessage},
    thread::ThreadProviderMap,
};
use std::collections::HashSet;
use uuid::Uuid;

/// A message rejected by its contacts write or message savepoint.
#[derive(Debug)]
pub struct SkippedBackfillMessage {
    /// Position in the original message slice.
    pub index: usize,
    /// Original failure, retained for the existing warning.
    pub error: anyhow::Error,
}

/// Stored-message facts and the atomic writers already used by backfill.
pub trait BackfillImportRepository:
    MessageResyncRepository<ResyncError = BackfillDatabaseError> + Send + Sync + 'static
{
    /// Increment the normal sweep's discovery count.
    fn retrieved_threads(
        &self,
        job: Uuid,
        count: i32,
    ) -> impl Future<Output = Result<(), BackfillDatabaseError>> + Send;
    /// Read a provider thread's stored identity.
    fn existing_threads(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<ThreadProviderMap, BackfillDatabaseError>> + Send;
    /// Read the stored provider messages before recovery import.
    fn existing_messages(
        &self,
        link: Uuid,
        providers: &[String],
    ) -> impl Future<Output = Result<HashSet<String>, BackfillDatabaseError>> + Send;
    /// Read the one-message import's pre-fetch snapshot.
    fn stored_message(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<Option<SimpleMessage>, BackfillDatabaseError>> + Send;
    /// Write a new thread atomically, preserving per-message savepoints.
    fn insert_thread(
        &self,
        link: Uuid,
        provider: &str,
        messages: &mut [Message],
    ) -> impl Future<
        Output = Result<Option<(Uuid, Vec<SkippedBackfillMessage>)>, BackfillDatabaseError>,
    > + Send;
    /// Write recovery messages atomically into an existing thread.
    fn insert_messages(
        &self,
        link: Uuid,
        thread: Uuid,
        messages: &mut [Message],
    ) -> impl Future<Output = Result<Vec<SkippedBackfillMessage>, BackfillDatabaseError>> + Send;
    /// Write one legacy message, preserving its pending-label resync snapshot.
    fn insert_message(
        &self,
        link: Uuid,
        thread: Uuid,
        message: &mut Message,
        snapshot: Option<&InboxSyncResync>,
    ) -> impl Future<Output = Result<(), BackfillDatabaseError>> + Send;
    /// Resolve a committed invitation's message identity.
    fn invitation_message(
        &self,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = Result<(Uuid, Uuid), BackfillDatabaseError>> + Send;
}
