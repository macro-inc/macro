//! Compatibility identities over the common unpublished update.
use crate::*;
use std::sync::Arc;
/// Opaque runtime host identity for an editor, independent of its state.
/// Clones retain only an identity marker, never the editor or its callbacks.
#[derive(Clone)]
pub struct ForeignEditorIdentity(pub(super) Arc<()>);

impl ForeignEditorIdentity {
    /// Whether a current transaction belongs to this identity's editor.
    pub fn matches(&self, tx: &Transaction<'_>) -> bool {
        Arc::ptr_eq(&self.0, &tx.editor.suspend_owner)
    }
}

/// Opaque identity of one pending update, preserved across suspend/resume.
/// Retaining this marker does not retain pending state or callbacks.
#[derive(Clone)]
pub struct ForeignUpdateIdentity(pub(super) Arc<()>);

impl ForeignUpdateIdentity {
    /// Whether the transaction is the same pending update, rather than a fresh
    /// transaction belonging to the same editor and committed publication.
    pub fn matches(&self, tx: &Transaction<'_>) -> bool {
        Arc::ptr_eq(&self.0, &tx.foreign_update)
    }
}

impl Transaction<'_> {
    /// Capture editor identity without retaining its state or registry.
    pub fn foreign_editor_identity(&self) -> ForeignEditorIdentity {
        ForeignEditorIdentity(self.editor.suspend_owner.clone())
    }

    /// Capture pending-update identity without retaining its model state.
    pub fn foreign_update_identity(&self) -> ForeignUpdateIdentity {
        ForeignUpdateIdentity(self.foreign_update.clone())
    }

    /// Compatibility name for the common staged-effects predicate.
    pub fn has_foreign_effects(&self) -> bool {
        self.has_staged_effects()
    }
}
#[path = "admission.rs"]
mod admission;
#[cfg(test)]
mod test;
