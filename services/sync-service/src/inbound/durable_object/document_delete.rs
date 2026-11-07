//! Permanent erasure of a document session. Internal-only: the document storage
//! service calls this after it has deleted the document and its files.

use tracing::warn;
use worker::{Response, Result};

use super::{SyncSession, response, status_codes};
use crate::{
    constants::USER_PEER_D1_BINDING,
    d1::delete_document_rows,
    storage::{get_snapshot_storage, snapshot::SnapshotStorage},
};

impl SyncSession<'_> {
    /// Erase the snapshot, operation log, socket metadata, peer mappings, and
    /// blame for `document_id`. Idempotent: a document that never had a
    /// session is already deleted.
    pub(in crate::inbound) async fn delete_handler(
        &mut self,
        document_id: &str,
    ) -> Result<Response> {
        for socket in self.state.get_websockets() {
            if let Err(error) = socket.close(Some(1008), Some("document deleted")) {
                warn!(error = ?error, "failed to close socket of deleted document");
            }
        }
        delete_document_rows(self.env.d1(USER_PEER_D1_BINDING)?, document_id).await?;
        // The KV fallback snapshot lives outside this object. Remove it before
        // emptying local storage, or `exists` would restore the session from it.
        get_snapshot_storage(&self.env, &self.state, document_id.to_owned())?
            .delete_snapshot()
            .await?;
        let storage = self.state.storage();
        // Before compatibility date 2026-02-24, `delete_all` keeps the alarm.
        storage.delete_alarm().await?;
        storage.delete_all().await?;
        self.forget_session();
        Ok(response(status_codes::OK))
    }

    fn forget_session(&mut self) {
        self.session_key = None;
        self.document = None;
        self.operation_log = None;
        self.room.ports_mut().session_storage = None;
        self.surface_lifecycle = None;
        self.source_migration = None;
        self.connections.clear();
        self.inbound.clear();
        self.pending_blame.clear();
        self.pending_editors.clear();
        for key in self.awareness.keys() {
            self.awareness.delete(&key);
        }
    }
}
