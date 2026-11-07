//! Isolated surface transport and persisted lifecycle. No document API fallback.

use bebop::Record;
use macro_sync_service_jwt::session::{SessionIdentity, SessionKind};
use sync_protocol::InitializeFromSnapshotRequest;
use worker::{Date, Method, Request, Response, Result, WebSocket};

use super::{SyncSession, Wsm, response, status_codes};
use crate::{
    error::ResultExt,
    state::DocumentState,
    storage::{get_snapshot_storage, snapshot::SnapshotStorage},
};

#[cfg(test)]
mod test;

pub(super) const LIFECYCLE_KEY: &str = "SURFACE_LIFECYCLE";

/// The discriminant is part of the persisted DOCUMENT_ID key, not the current
/// request URL. Legacy document keys are unchanged and cannot use this prefix.
pub(super) fn session_kind_from_storage_key(key: &str) -> SessionKind {
    if key.starts_with("surface:") {
        SessionKind::Surface
    } else {
        SessionKind::Document
    }
}

pub(super) use sync_server_core::domain::connection::SurfaceLifecycle;

/// A pending session has no writers. Exact seed bytes identify a retry of the
/// binary initializer, which has no separate operation ID. Unknown seeds must
/// be rolled back before another initialization can write a replacement.
async fn prepare_surface_snapshot(storage: &impl SnapshotStorage, snapshot: &[u8]) -> Result<bool> {
    if storage.has_snapshot().await? {
        if storage.get_snapshot().await? != snapshot {
            storage.delete_snapshot().await?;
            return Ok(false);
        }
    } else {
        storage.store_snapshot(snapshot).await?;
    }
    Ok(true)
}

pub(super) fn now_seconds() -> u64 {
    let now = Date::now().as_millis();
    #[cfg(feature = "transcript")]
    crate::transcript::clock("surface_expiry_ms", now);
    // Preserve the adapter's original target-width conversion before widening.
    ((now / 1000) as usize) as u64
}

impl SyncSession {
    pub(super) async fn surface_lifecycle(&self) -> Result<SurfaceLifecycle> {
        if let Some(value) = *self.surface_lifecycle.lock("surface lifecycle cached") {
            return Ok(value);
        }
        let value = self
            .state
            .storage()
            .get(LIFECYCLE_KEY)
            .await?
            .unwrap_or_default();
        let mut cached = self.surface_lifecycle.lock("surface lifecycle loaded");
        // Do not overwrite a transition made while the storage read was pending.
        Ok(*cached.get_or_insert(value))
    }

    pub(in crate::inbound) async fn surface_handler(
        &self,
        req: Request,
        claims: Option<crate::auth::AuthToken>,
    ) -> Result<Response> {
        let url = req.url()?;
        let segments: Vec<_> = url.path().split('/').collect();
        let ["", "surface", id, operation, rest @ ..] = segments.as_slice() else {
            return Ok(response(status_codes::NOT_FOUND));
        };
        let Ok(identity) = SessionIdentity::new(SessionKind::Surface, id) else {
            return Ok(response(400));
        };
        // Explicit allowlist: no document copy, raw, debug, CAS, or wakeup API.
        let allowed_method = match (*operation, rest) {
            ("connect" | "exists" | "active_peers", []) | ("peer", [_]) => Method::Get,
            (
                "initialize"
                | "revoke"
                | "snapshot"
                | "initialize_verified"
                | "import"
                | "verify"
                | "activate",
                [],
            ) => Method::Post,
            _ => return Ok(response(status_codes::NOT_FOUND)),
        };
        if req.method() != allowed_method {
            return Ok(response(405));
        }
        let key = identity.storage_key();
        let persisted: Option<String> = self.state.storage().get(super::DOCUMENT_ID_KEY).await?;
        if persisted.is_some_and(|persisted| persisted != key) {
            return Ok(response(409));
        }
        self.maybe_set_document_id(&key).await?;
        if *operation == "revoke" {
            return self.revoke_surface().await;
        }
        let lifecycle = self.surface_lifecycle().await?;
        if lifecycle == SurfaceLifecycle::Revoked {
            return Ok(response(status_codes::FORBIDDEN));
        }
        if matches!(
            *operation,
            "initialize_verified" | "import" | "verify" | "activate"
        ) {
            return self.target_migration_handler(req, &key, operation).await;
        }
        if *operation == "initialize" {
            if self.has_target_migration().await? {
                return Ok(response(409));
            }
            return self.initialize_surface(req, &key).await;
        }
        if lifecycle != SurfaceLifecycle::Ready {
            return Ok(response(409));
        }
        // Missing/corrupt snapshots must not trigger create-default-state, even
        // when that development feature is enabled for documents.
        self.document_state().await?;
        if !self.validate_surface_sockets(None).await? {
            return Ok(response(status_codes::FORBIDDEN));
        }
        match *operation {
            "connect" => {
                let Some(claims) = claims else {
                    return Ok(response(status_codes::UNAUTH));
                };
                self.connect(claims, &key).await
            }
            "snapshot" => {
                let snapshot = self.document_state().await?.export_snapshot(None)?;
                Ok(Response::builder().body(worker::ResponseBody::Body(snapshot)))
            }
            "peer" => self.peer_handler(&key, rest.first().copied()).await,
            "active_peers" => self.active_peer_ids_handler(true).await,
            "exists" => Ok(response(status_codes::OK)),
            _ => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    async fn initialize_surface(&self, mut req: Request, key: &str) -> Result<Response> {
        let bytes = req.bytes().await?;
        let body = InitializeFromSnapshotRequest::deserialize(&bytes)
            .context("invalid surface snapshot request")?;
        DocumentState::try_from_snapshot(&body.snapshot).context("invalid surface snapshot")?;
        // Claim synchronously before awaiting snapshot IO; a second initializer
        // must not overwrite either the winner or an existing snapshot.
        match self.surface_lifecycle().await? {
            SurfaceLifecycle::Revoked => return Ok(response(status_codes::FORBIDDEN)),
            SurfaceLifecycle::Ready | SurfaceLifecycle::Initializing => return Ok(response(409)),
            SurfaceLifecycle::Pending => {}
        }
        *self.surface_lifecycle.lock("claim surface initialization") =
            Some(SurfaceLifecycle::Initializing);
        let result: Result<Response> = async {
            let storage = get_snapshot_storage(&self.env, &self.state, key.to_owned())?;
            if !prepare_surface_snapshot(&storage, &body.snapshot).await? {
                return Ok(response(409));
            }
            #[cfg(feature = "migration-test-hooks")]
            if req.headers().get("x-sync-test-stop-after")?.as_deref() == Some("surface_snapshot") {
                return Err(worker::Error::from("injected surface persistence failure"));
            }
            if self.surface_lifecycle().await? == SurfaceLifecycle::Revoked {
                return Ok(response(status_codes::FORBIDDEN));
            }
            self.state
                .storage()
                .put(LIFECYCLE_KEY, SurfaceLifecycle::Ready)
                .await?;
            if self.surface_lifecycle().await? == SurfaceLifecycle::Revoked {
                return Ok(response(status_codes::FORBIDDEN));
            }
            *self.surface_lifecycle.lock("surface ready") = Some(SurfaceLifecycle::Ready);
            Ok(response(status_codes::OK))
        }
        .await;
        if !result
            .as_ref()
            .is_ok_and(|response| response.status_code() == status_codes::OK)
        {
            let mut lifecycle = self
                .surface_lifecycle
                .lock("release surface initialization");
            if *lifecycle != Some(SurfaceLifecycle::Revoked) {
                // A failed Ready write may have committed. Reload durable truth
                // rather than admitting a new initializer against a ready seed.
                *lifecycle = None;
            }
        }
        result
    }

    pub(super) async fn revoke_surface(&self) -> Result<Response> {
        // Deny in-flight callbacks before yielding, and persist the tombstone
        // before acknowledging. Retrying revocation is safe, including pending IDs.
        *self.surface_lifecycle.lock("revoke surface") = Some(SurfaceLifecycle::Revoked);
        self.state
            .storage()
            .put(LIFECYCLE_KEY, SurfaceLifecycle::Revoked)
            .await?;
        for socket in self.state.get_websockets() {
            socket.close(Some(1008), Some("surface revoked"))?;
        }
        Ok(response(status_codes::OK))
    }

    /// Reload socket grants after hibernation before accepting messages or
    /// selecting broadcast recipients. Cached grants avoid per-message IO.
    pub(crate) async fn validate_surface_sockets(
        &self,
        sender: Option<&WebSocket>,
    ) -> Result<bool> {
        let key = self.document_id().await?;
        if session_kind_from_storage_key(&key) == SessionKind::Document {
            return Ok(true);
        }
        let ready = self.surface_lifecycle().await? == SurfaceLifecycle::Ready;
        let now = now_seconds();
        for socket in self.state.get_websockets() {
            let mut wsm = Wsm::new(self, &socket);
            wsm.maybe_update_ws_meta_map().await?;
            let ws_id = wsm.get_ws_id()?;
            let active = ready
                && self
                    .ws_meta_map
                    .lock("validate surface grant")
                    .get(ws_id)
                    .is_some_and(|meta| meta.grant_active(SessionKind::Surface, now));
            if !active {
                socket.close(Some(1008), Some("surface grant expired or revoked"))?;
            }
        }
        // Metadata restoration can yield. Use current lifecycle and time, not
        // the values observed before those reads, when authorizing the sender.
        Ok(self.surface_lifecycle().await? == SurfaceLifecycle::Ready
            && sender.is_none_or(|sender| self.active_websockets().contains(sender)))
    }

    pub(super) fn active_websockets(&self) -> Vec<WebSocket> {
        let key = self.document_id.lock("broadcast session identity");
        let Some(key) = key.as_ref() else {
            return Vec::new();
        };
        if session_kind_from_storage_key(key) == SessionKind::Document {
            return self.state.get_websockets();
        }
        if *self.surface_lifecycle.lock("broadcast surface lifecycle")
            != Some(SurfaceLifecycle::Ready)
        {
            return Vec::new();
        }
        let metas = self.ws_meta_map.lock("broadcast surface grants");
        let now = now_seconds();
        self.state
            .get_websockets()
            .into_iter()
            .filter(|socket| {
                super::get_ws_id(&self.state, socket)
                    .ok()
                    .and_then(|id| metas.get(&id))
                    .is_some_and(|meta| meta.grant_active(SessionKind::Surface, now))
            })
            .collect()
    }
}
