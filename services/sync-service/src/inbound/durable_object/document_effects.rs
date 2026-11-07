//! Worker notification adapter for the document update use case.

use macro_sync_service_jwt::session::SessionKind;
use tracing::{error, warn};
use worker::Env;

use super::{SyncSession, bump_alarm, surface_api::session_kind_from_storage_key, take_editors};
use crate::{
    domain::document::{
        DocumentAttribution, DocumentError, DocumentUpdateEffects, DocumentUpdatePort,
    },
    dss_internal::InteractionReason,
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
    crate::outbound::document_publication::report_new_doc_state(
        session_key,
        snapshot,
        env,
        editors,
    )
    .await;
}

pub(super) async fn report_interaction(session_key: &str, env: &Env, reason: InteractionReason) {
    if session_kind_from_storage_key(session_key) != SessionKind::Document {
        return;
    }
    crate::outbound::document_publication::report_interaction(session_key, env, reason).await;
}

pub(super) struct WorkerDocumentEffects<'a, 'room> {
    pub session: &'a mut SyncSession<'room>,
    pub document_state: &'a DocumentState,
    pub document_id: &'a str,
    pub attribution: Option<&'a DocumentAttribution>,
    pub store_attribution: bool,
}

fn notification_error(error: impl std::fmt::Debug) -> DocumentError {
    error!(error = ?error, "failed to notify document update");
    DocumentError::Notification
}

impl DocumentUpdateEffects for WorkerDocumentEffects<'_, '_> {
    fn broadcast(&mut self, update: &[u8]) -> Result<(), DocumentError> {
        for socket in self.session.get_sockets() {
            if let Err(error) = socket.send(sync_protocol::FromRemote::RemoteUpdate {
                update: bebop::SliceWrapper::Raw(update),
            }) {
                warn!(error = ?error, "failed to broadcast document update; continuing");
            }
        }
        Ok(())
    }

    fn publish_changed_document(&mut self) -> Result<(), DocumentError> {
        self.session.record_editor(self.attribution);
        let snapshot = self
            .document_state
            .export_shallow_snapshot()
            .map_err(notification_error)?;
        let editors = take_editors(&mut self.session.pending_editors);
        let env = self.session.env.clone();
        let document_id = self.document_id.to_owned();
        self.session.state.wait_until(crate::background(async move {
            report_new_doc_state(&document_id, &snapshot, &env, editors).await;
            report_interaction(&document_id, &env, InteractionReason::Edited).await;
        }));
        Ok(())
    }

    async fn keep_alive(&mut self) -> Result<(), DocumentError> {
        bump_alarm(&self.session.state)
            .await
            .map_err(notification_error)
    }
}

impl DocumentUpdatePort for WorkerDocumentEffects<'_, '_> {
    fn document(&self) -> &loro::LoroDoc {
        &self.document_state.loro_doc
    }
    async fn apply_and_persist(&mut self, update: &[u8]) -> Result<(), DocumentError> {
        // Attribution is stored for signed agent actors only, as before.
        let attribution = self.attribution.filter(|_| self.store_attribution);
        self.session
            .apply_update(update, attribution)
            .await
            .map(|_| ())
            .map_err(|error| {
                tracing::error!(error = ?error, "failed to persist document update");
                DocumentError::Persistence
            })
    }
}
