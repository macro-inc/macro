//! Persisted connection data and time-explicit grant policy.
use super::{
    ai_peer::is_ai_peer,
    permissions::{AccessLevel, WriteAccess},
};
use macro_sync_service_jwt::session::SessionKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

mod u64_serde_strings;
fn document_kind() -> SessionKind {
    SessionKind::Document
}

#[derive(Debug, Serialize, Deserialize, Clone)]
/// Persisted metadata for one hibernatable connection.
pub struct ConnectionMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// The optional signed agent invocation identifier.
    pub agent_correlation_id: Option<uuid_types::Uuid>,
    /// The user identity associated with the grant or peer.
    pub user_id: Option<String>,
    /// The ordered access granted to this connection.
    pub access_level: AccessLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// The signed editing actor.
    pub actor: Option<String>,
    #[serde(with = "u64_serde_strings")]
    /// Registered peer IDs encoded as decimal strings in storage.
    pub peer_ids: BTreeSet<u64>,
    #[serde(default = "document_kind")]
    /// The document or surface kind bound to this grant.
    pub session_kind: SessionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    /// Optional grant expiry in Unix seconds.
    pub expires_at: Option<usize>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
/// Persisted or in-flight initialization state of a surface.
pub enum SurfaceLifecycle {
    #[default]
    /// No completed initialization is stored.
    Pending,
    /// In-flight initialization; only kept in memory, never considered ready.
    Initializing,
    /// Initialization completed and the surface can be used.
    Ready,
    /// The surface has been revoked.
    Revoked,
}

impl ConnectionMetadata {
    /// Whether this grant matches the kind and remains active at Unix seconds `now`.
    pub fn grant_active(&self, kind: SessionKind, now: u64) -> bool {
        self.session_kind == kind
            && match kind {
                SessionKind::Document => true,
                SessionKind::Surface => self.expires_at.is_some_and(|expiry| expiry as u64 > now),
            }
    }

    /// Resolve writes at Unix seconds `now`, including surface expiry.
    pub fn write_access(&self, now: u64) -> WriteAccess {
        if !self.grant_active(self.session_kind, now) {
            return WriteAccess::None;
        }
        self.access_level.write_access_for(self.session_kind)
    }
}

impl ConnectionMetadata {
    /// Return registered peers, optionally including signed and legacy agent peers.
    pub fn active_peer_ids(&self, include_ai: bool) -> Vec<u64> {
        if !include_ai && self.actor.is_some() {
            return Vec::new();
        }
        self.peer_ids
            .iter()
            .copied()
            .filter(|peer| include_ai || !is_ai_peer(*peer))
            .collect()
    }
}

#[cfg(test)]
mod test;
