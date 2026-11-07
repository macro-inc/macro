#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// A peer and operation counter identifying a revision.
pub struct VersionIndicator {
    /// Json has trouble with peer id bigints, so we need to serialize from a string
    pub peer: String,
    /// The operation counter within the peer.
    pub counter: i32,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// A request to copy a document at an optional revision.
pub struct CopyDocumentRequest {
    /// Identity of the destination document.
    pub target_document_id: String,
    /// The requested or current revision.
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// A request for the current or specified document snapshot.
pub struct GetSnapshotRequest {
    /// The requested or current revision.
    pub version_id: Option<VersionIndicator>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// Document identity, registered peers and current revision.
pub struct DocumentMetadata {
    /// The document identity.
    pub id: String,
    /// The registered peer identities.
    pub peers: Vec<PeerWithUserId>,
    /// The requested or current revision.
    pub version_id: String,
}

#[derive(serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// The recorded user identity for a peer.
pub struct PeerResponse {
    /// The decimal peer identifier.
    pub peer_id: String,
    /// The user identity associated with the grant or peer.
    pub user_id: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// A peer and its recorded editing identity.
pub struct PeerWithUserId {
    /// The decimal peer identifier.
    pub peer_id: String,
    /// The user identity associated with the grant or peer.
    pub user_id: String,
    /// Signed agent actor (`bot|<uuid>`) the peer edited as; null for humans.
    pub actor: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
/// The recorded attribution for a node edit.
pub struct BlameRow {
    /// The decimal peer identifier.
    pub peer_id: String,
    /// The user identity associated with the grant or peer.
    pub user_id: Option<String>,
    /// Signed agent actor (`bot|<uuid>`) the peer edited as; null for humans.
    pub actor: Option<String>,
    /// The edit time in Unix milliseconds.
    pub timestamp_ms: i64,
}
