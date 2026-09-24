//! Worker notification adapter for the document update use case.

use bebop::{Record, SubRecord};
use macro_sync_service_jwt::session::SessionKind;
use tracing::{error, warn};
use worker::Env;

use super::{
    DocumentSyncSession, bump_alarm, surface_api::session_kind_from_storage_key, take_editors,
};
use crate::{
    domain::document::{DocumentAttribution, DocumentError, DocumentUpdateEffects},
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

pub(super) struct WorkerDocumentEffects<'a> {
    pub session: &'a DocumentSyncSession,
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
        let message = crate::generated::schema::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::Raw(update),
        };
        let mut message_bytes = Vec::with_capacity(message.serialized_size());
        message
            .serialize(&mut message_bytes)
            .map_err(notification_error)?;
        for socket in self.session.get_websockets() {
            if let Err(error) = socket.send_with_bytes(&message_bytes) {
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
