//! Worker notification adapter for the document update use case.

use macro_sync_service_jwt::session::SessionKind;
use tracing::{error, warn};
use worker::Env;

use super::{SyncSession, bump_alarm, surface_api::session_kind_from_storage_key, take_editors};
use crate::{
    domain::{
        document::{DocumentAttribution, DocumentError, DocumentUpdateEffects},
        fanout::{self, DeliveryPort, FanoutDebt, PendingOperations, StatePort},
    },
    dss_internal::{DssInternal, DssInternalClient, InteractionReason},
    state::DocumentState,
};

/// All document-only effects pass through this boundary, including socket joins,
/// initialization, alarms, HTTP updates and disconnects. The persisted storage key
/// is a kind-discriminated identity; surface keys never reach document consumers.
pub(super) async fn report_new_doc_state(
    session_key: &str,
    snapshot: &[u8],
    env: &Env,
    editors: Vec<DocumentAttribution>,
) {
    if session_kind_from_storage_key(session_key) != SessionKind::Document {
        return;
    }
    if let Err(error) = DssInternalClient::new(env)
        .publish_shallow_snapshot(session_key, snapshot)
        .await
    {
        warn!(error = ?error, "failed to push snapshot to DSS");
    }
    #[cfg(feature = "search-service")]
    if let Err(error) = DssInternalClient::new(env)
        .publish_sync_content_updated(session_key, editors)
        .await
    {
        warn!(error = ?error, "failed to publish document content change");
    }
}

pub(super) async fn report_interaction(session_key: &str, env: &Env, reason: InteractionReason) {
    if session_kind_from_storage_key(session_key) != SessionKind::Document {
        return;
    }
    if let Err(error) = DssInternalClient::new(env)
        .publish_interaction(session_key, reason)
        .await
    {
        warn!(error = ?error, "failed to push interaction to DSS");
    }
}

impl SyncSession {
    /// Delegate delivery completion to the transport-independent use case.
    pub(crate) async fn release_resolved_pending(
        &self,
        document: &DocumentState,
        storage: &crate::storage::SessionStorage,
    ) -> worker::Result<()> {
        fanout::release(&WorkerFanoutDelivery {
            session: self,
            document,
            storage,
        })
        .await
    }

    pub(crate) async fn release_resolved_pending_revision(
        &self,
        document: &DocumentState,
        storage: &crate::storage::SessionStorage,
    ) -> worker::Result<Option<Vec<u8>>> {
        fanout::release_with_revision(&WorkerFanoutDelivery {
            session: self,
            document,
            storage,
        })
        .await
    }

    /// A failed append may have imported operations before the storage await.
    /// Discard both caches so retry/alarm cannot publish unpersisted history.
    pub(crate) fn discard_failed_append(&self) {
        *self.document_state.lock("failed append document cache") = None;
        *self.session_storage.lock("failed append storage cache") = None;
    }
}

struct WorkerFanoutDelivery<'a> {
    session: &'a SyncSession,
    document: &'a DocumentState,
    storage: &'a crate::storage::SessionStorage,
}
impl StatePort for WorkerFanoutDelivery<'_> {
    fn with_pending<T>(&self, apply: impl FnOnce(&mut PendingOperations) -> T) -> T {
        self.storage.with_pending(apply)
    }
}
impl DeliveryPort for WorkerFanoutDelivery<'_> {
    type Error = worker::Error;
    fn known(&self) -> loro::VersionVector {
        self.document.loro_doc.oplog_vv()
    }
    fn export_since(&self, base: &loro::VersionVector) -> worker::Result<Vec<u8>> {
        self.document.export_updates_since(base)
    }
    fn notify_all(&self, update: &[u8]) -> worker::Result<()> {
        let mut failure = None;
        for socket in self.session.get_sockets() {
            if let Err(error) = socket.send(crate::generated::schema::FromRemote::RemoteUpdate {
                update: bebop::SliceWrapper::Raw(update),
            }) {
                warn!(error = ?error, "failed to send resolved history; retaining debt");
                if failure.is_none() {
                    failure = Some(error);
                }
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
    async fn persist_debt(&self, next: Option<&FanoutDebt>) -> worker::Result<()> {
        self.storage.persist_fanout_debt(next).await
    }
}

pub(super) struct WorkerDocumentEffects<'a> {
    pub session: &'a SyncSession,
    pub document_state: &'a DocumentState,
    pub document_id: &'a str,
    pub attribution: Option<&'a DocumentAttribution>,
}

fn notification_error(error: impl std::fmt::Debug) -> DocumentError {
    error!(error = ?error, "failed to notify document update");
    DocumentError::Notification
}

impl DocumentUpdateEffects for WorkerDocumentEffects<'_> {
    fn broadcast(&self, update: &[u8]) -> Result<(), DocumentError> {
        for socket in self.session.get_sockets() {
            if let Err(error) = socket.send(crate::generated::schema::FromRemote::RemoteUpdate {
                update: bebop::SliceWrapper::Raw(update),
            }) {
                warn!(error = ?error, "failed to broadcast document update; continuing");
            }
        }
        Ok(())
    }

    fn publish_changed_document(&self) -> Result<(), DocumentError> {
        self.session.record_editor(self.attribution);
        let snapshot = self
            .document_state
            .export_shallow_snapshot()
            .map_err(notification_error)?;
        let editors = take_editors(&self.session.pending_editors);
        let env = self.session.env.clone();
        let document_id = self.document_id.to_owned();
        self.session.state.wait_until(async move {
            report_new_doc_state(&document_id, &snapshot, &env, editors).await;
            report_interaction(&document_id, &env, InteractionReason::Edited).await;
        });
        Ok(())
    }

    async fn keep_alive(&self) -> Result<(), DocumentError> {
        bump_alarm(&self.session.state)
            .await
            .map_err(notification_error)
    }
}
