//! Permanent erasure of a document session. Internal-only: the document storage
//! service calls this after it has deleted the document and its files.

use tracing::warn;
use worker::{Method, Request, Response, Result};

use super::{DocumentSyncSession, response, status_codes};
use crate::{
    auth::is_internal,
    constants::USER_PEER_D1_BINDING,
    d1::delete_document_rows,
    storage::{get_snapshot_storage, snapshot::SnapshotStorage},
};

impl DocumentSyncSession {
    /// Erase the snapshot, operation log, socket metadata, peer mappings, and
    /// blame for `document_id`. Idempotent: a document that never had a
    /// session is already deleted.
    pub(super) async fn delete_handler(
        &self,
        req: &Request,
        document_id: &str,
    ) -> Result<Response> {
        if !is_internal(req, &self.env)? {
            return Ok(response(status_codes::UNAUTH));
        }
        if req.method() != Method::Delete {
            return Ok(response(405));
        }
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

    fn forget_session(&self) {
        *self.document_id.lock("delete document id") = None;
        *self.document_state.lock("delete document state") = None;
        *self.session_storage.lock("delete session storage") = None;
        *self.surface_lifecycle.lock("delete surface lifecycle") = None;
        *self.source_migration.lock("delete source state") = None;
        self.ws_meta_map.lock("delete socket metadata").clear();
        self.inbound.lock("delete inbound buffers").clear();
        self.pending_blame.lock("delete pending blame").clear();
        self.pending_editors.lock("delete pending editors").clear();
        for key in self.awareness.keys() {
            self.awareness.delete(&key);
        }
    }
}
