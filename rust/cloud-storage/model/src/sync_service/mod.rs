use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema, PartialEq, Eq, Clone)]
pub struct SyncServiceVersionID {
    pub peer: String,
    pub counter: i32,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, PartialEq, Eq, Clone)]
pub struct PeerWithUserId {
    pub peer_id: String,
    pub user_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, Clone)]
pub struct DocumentMetadata {
    pub id: String,
    pub peers: Vec<PeerWithUserId>,
    pub version_id: String,
}
