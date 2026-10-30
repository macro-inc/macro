#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct VersionIndicator {
    /// Json has trouble with peer id bigints, so we need to serialize from a string
    pub peer: String,
    pub counter: i32,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CopyDocumentRequest {
    pub target_document_id: String,
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GetSnapshotRequest {
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DocumentMetadata {
    pub id: String,
    pub peers: Vec<PeerWithUserId>,
    pub version_id: String,
}

#[derive(serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerResponse {
    pub peer_id: String,
    pub user_id: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerWithUserId {
    pub peer_id: String,
    pub user_id: String,
    /// Signed agent actor (`bot|<uuid>`) the peer edited as; null for humans.
    pub actor: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BlameRow {
    pub peer_id: String,
    pub user_id: Option<String>,
    /// Signed agent actor (`bot|<uuid>`) the peer edited as; null for humans.
    pub actor: Option<String>,
    pub timestamp_ms: i64,
}
