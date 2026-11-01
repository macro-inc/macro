use macro_sync_service_jwt::session::SessionKind;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
pub enum AccessLevel {
    #[default]
    View = 0,
    /// Document sockets may write comment marks; surfaces may not write.
    Comment = 1,
    Edit = 2,
    Owner = 3,
    Admin = 4,
}

/// What a session may change in the document it is connected to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteAccess {
    None,
    /// Comment anchors live in the document body, so commenting writes it;
    /// every other change must be rejected.
    CommentMarks,
    Full,
}

/// Verified grant normalized at the dedicated session access boundary.
#[derive(Debug)]
pub struct AuthToken {
    pub user_id: Option<String>,
    pub(crate) document_id: String,
    pub access_level: AccessLevel,
    pub actor: Option<String>,
    pub session_kind: SessionKind,
    pub expires_at: Option<usize>,
}

impl AccessLevel {
    pub fn write_access_for(&self, kind: SessionKind) -> WriteAccess {
        match (self, kind) {
            (Self::View, _) | (Self::Comment, SessionKind::Surface) => WriteAccess::None,
            (Self::Comment, SessionKind::Document) => WriteAccess::CommentMarks,
            (Self::Edit | Self::Owner | Self::Admin, _) => WriteAccess::Full,
        }
    }
}

impl AuthToken {
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
