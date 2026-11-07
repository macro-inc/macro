//! Isolated surface transport and persisted lifecycle. No document API fallback.

use bebop::Record;
use macro_sync_service_jwt::session::{SessionIdentity, SessionKind};
use sync_protocol::InitializeFromSnapshotRequest;
use worker::{Method, Request, Response, Result};

use super::{HttpHandlers, response, status_codes};
use crate::error::ResultExt;

impl HttpHandlers<'_> {
    pub(in crate::inbound) async fn surface_handler(
        &mut self,
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
        use sync_server_core::domain::room::{SurfacePreparation, SurfaceRequest};
        let operation_kind = match *operation {
            "revoke" => SurfaceRequest::Revoke,
            "initialize" => SurfaceRequest::Initialize,
            "initialize_verified" | "import" | "verify" | "activate" => SurfaceRequest::Migration,
            _ => SurfaceRequest::Read,
        };
        let storage_key = sync_server_core::domain::types::SessionKey::new(key.clone());
        match self
            .room
            .prepare_surface(&storage_key, operation_kind)
            .await
            .map_err(super::room_error)?
        {
            SurfacePreparation::Return(status) => return Ok(surface_response(status)),
            SurfacePreparation::Proceed => {}
        }
        if matches!(
            *operation,
            "initialize_verified" | "import" | "verify" | "activate"
        ) {
            return self.target_migration_handler(req, &key, operation).await;
        }
        if *operation == "initialize" {
            return self.initialize_surface(req, &key).await;
        }
        match *operation {
            "connect" => {
                let Some(claims) = claims else {
                    return Ok(response(status_codes::UNAUTH));
                };
                self.connect(claims, &key).await
            }
            "snapshot" => {
                let snapshot = self
                    .room
                    .surface_snapshot()
                    .await
                    .map_err(super::room_error)?;
                Ok(Response::builder().body(worker::ResponseBody::Body(snapshot)))
            }
            "peer" => self.peer_handler(&key, rest.first().copied()).await,
            "active_peers" => self.active_peer_ids_handler(true).await,
            "exists" => Ok(response(status_codes::OK)),
            _ => Ok(response(status_codes::NOT_FOUND)),
        }
    }

    async fn initialize_surface(&mut self, mut req: Request, key: &str) -> Result<Response> {
        let bytes = req.bytes().await?;
        let body = InitializeFromSnapshotRequest::deserialize(&bytes)
            .context("invalid surface snapshot request")?;
        let faults = super::surface_migration::fault_plan(&req)?;
        let status = self
            .room
            .initialize_surface(
                &sync_server_core::domain::types::SessionKey::new(key.to_owned()),
                &body.snapshot,
                faults,
            )
            .await
            .map_err(super::room_error)?;
        Ok(surface_response(status))
    }
}

fn surface_response(status: sync_server_core::domain::room::SurfaceStatus) -> Response {
    use sync_server_core::domain::room::SurfaceStatus;
    response(match status {
        SurfaceStatus::Ok => 200,
        SurfaceStatus::Conflict => 409,
        SurfaceStatus::Forbidden => 403,
    })
}
