use utoipa::OpenApi;

use crate::domain::models::{
    BlameRow, CopyDocumentRequest, DocumentMetadata, GetSnapshotRequest, PeerResponse,
    PeerWithUserId, VersionIndicator,
};

/// OpenAPI spec for the sync service's JSON HTTP endpoints.
///
/// The WebSocket sync protocol is bebop-encoded and lives in the bebop schema
/// (`/schema`); only the JSON control-plane endpoints are described here.
#[derive(OpenApi)]
#[openapi(
    info(title = "Sync Service", description = "Document sync service JSON control plane"),
    paths(
        crate::inbound::worker::copy_route,
        crate::inbound::router::exists_route,
        crate::inbound::router::metadata_route,
        crate::inbound::router::blame_route,
        crate::inbound::router::raw_route,
        crate::inbound::router::active_peers_route,
        crate::inbound::router::peer_route,
        crate::inbound::router::wakeup_route,
        crate::inbound::router::snapshot_route,
        crate::inbound::router::initialize_route,
    ),
    components(schemas(
        CopyDocumentRequest,
        GetSnapshotRequest,
        VersionIndicator,
        DocumentMetadata,
        PeerResponse,
        PeerWithUserId,
        BlameRow,
    )),
    tags((name = "sync_service", description = "Sync service"))
)]
pub struct ApiDoc;
