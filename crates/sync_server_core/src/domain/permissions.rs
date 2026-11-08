use macro_sync_service_jwt::session::SessionKind;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
/// Ordered access granted by a verified session token.
pub enum AccessLevel {
    #[default]
    /// Read-only access.
    View = 0,
    /// Document sockets may write comment marks; surfaces may not write.
    Comment = 1,
    /// Document editing access.
    Edit = 2,
    /// Document owner access.
    Owner = 3,
    /// Legacy administrator access.
    Admin = 4,
}

/// What a session may change in the document it is connected to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteAccess {
    /// No write capability.
    None,
    /// Comment anchors live in the document body, so commenting writes it;
    /// every other change must be rejected.
    CommentMarks,
    /// Unrestricted document editing.
    Full,
}

/// Verified grant normalized at the dedicated session access boundary.
#[derive(Debug)]
pub struct AuthToken {
    /// The optional signed agent invocation identifier.
    pub agent_correlation_id: Option<uuid_types::Uuid>,
    /// The user identity associated with the grant or peer.
    pub user_id: Option<String>,
    document_id: String,
    /// The ordered access granted to this connection.
    pub access_level: AccessLevel,
    /// The signed editing actor.
    pub actor: Option<String>,
    /// The document or surface kind bound to this grant.
    pub session_kind: SessionKind,
    /// Optional grant expiry in Unix seconds.
    pub expires_at: Option<usize>,
}

impl AccessLevel {
    /// Resolve the write capability for this grant and session kind.
    pub fn write_access_for(&self, kind: SessionKind) -> WriteAccess {
        match (self, kind) {
            (Self::View, _) | (Self::Comment, SessionKind::Surface) => WriteAccess::None,
            (Self::Comment, SessionKind::Document) => WriteAccess::CommentMarks,
            (Self::Edit | Self::Owner | Self::Admin, _) => WriteAccess::Full,
        }
    }
}

impl AuthToken {
    /// Normalize claims only after the adapter has verified the grant.
    pub fn new(
        document_id: String,
        access_level: AccessLevel,
        session_kind: SessionKind,
        user_id: Option<String>,
        actor: Option<String>,
        agent_correlation_id: Option<uuid_types::Uuid>,
        expires_at: Option<usize>,
    ) -> Self {
        Self {
            document_id,
            access_level,
            session_kind,
            user_id,
            actor,
            agent_correlation_id,
            expires_at,
        }
    }

    /// Whether a legacy document grant permits access to the requested identity.
    pub fn has_document_id_access(&self, document_id: &str) -> bool {
        self.session_kind == SessionKind::Document
            && (self.document_id == document_id || self.access_level == AccessLevel::Admin)
    }
}

impl AuthToken {
    /// Validate legacy document access, including document-admin grants.
    pub fn require_document_permission(
        &self,
        id: &str,
        level: &AccessLevel,
    ) -> Result<(), super::document::DocumentError> {
        if !self.has_document_id_access(id) || self.access_level < *level {
            return Err(super::document::DocumentError::Unauthorized);
        }
        Ok(())
    }

    /// Atomic reads/updates always require an exact document-scoped grant.
    pub fn document_access(
        &self,
        id: &str,
    ) -> Result<super::document::DocumentAccess, super::document::DocumentError> {
        if self.session_kind != SessionKind::Document {
            return Err(super::document::DocumentError::Unauthorized);
        }
        super::document::DocumentAccess::authorize(
            id,
            &self.document_id,
            self.access_level >= AccessLevel::Edit,
        )
    }
}

#[cfg(test)]
mod test;
