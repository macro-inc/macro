use serde::{Deserialize, Serialize};
use tracing::error;

use crate::domain::document_id::DocumentId;

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, Copy, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
#[derive(Default, enum_map::Enum)]
pub enum AccessLevel {
    /// User can view the document
    #[default]
    View = 0,
    /// User can comment on the document
    /// In this context, this is the same thing as [AccessLevel::View]
    Comment = 1,
    /// User can edit the document
    Edit = 2,
    /// User is the owner of the document
    Owner = 3,
    /// Internal communication
    Admin = 4,
}

impl AccessLevel {
    pub fn can_edit(&self) -> bool {
        self >= &AccessLevel::Comment
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct AuthToken {
    pub user_id: Option<String>,
    document_id: DocumentId,
    pub access_level: AccessLevel,
}

impl AuthToken {
    pub fn has_permission(&self, al: &AccessLevel) -> bool {
        if self.access_level < *al {
            error!(
                "Current permission level [{:?}] is not enough for [{:?}]",
                self.access_level, al
            );
            return false;
        }
        true
    }
    pub fn has_document_id_access(&self, document_id: &DocumentId) -> bool {
        if !(self.document_id == *document_id || matches!(self.access_level, AccessLevel::Admin)) {
            error!(
                "Don't have permission for document: [{:?}]
Auth'd document [{:?}]
access level [{:?}]",
                document_id, self.document_id, self.access_level
            );
            return false;
        }
        true
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    #[allow(clippy::nonminimal_bool, reason = "demonstrate ordering")]
    fn orderable() {
        let view = AccessLevel::View;
        let comment = AccessLevel::Comment;
        let edit = AccessLevel::Edit;
        let owner = AccessLevel::Owner;

        assert!(view < comment);
        assert!(view <= view);
        assert!(!(view < view));
        assert!(edit <= owner);
        assert!(view <= edit);
        assert!(view < owner);
        assert!(!(owner < view));
    }
}
