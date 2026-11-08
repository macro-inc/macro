//! Metadata for a publication read, without pinning live pending records.
use super::*;

/// Scope owner for derived publication captures. Dropping it revokes their origin.
#[derive(Default)]
pub struct ForeignReadLease(pub(super) Arc<()>);

/// Owned update metadata; this does not retain the pending node map or editor.
pub struct ForeignReadContext {
    pub(super) registry: Arc<Registry>,
    pub(super) origin: ReadOrigin,
    pub(super) native_calls: Option<Arc<crate::foreign::native::NativeCalls>>,
    pub(super) previous_selection: Option<Selection>,
    pub(super) previous_selection_identity: Option<ForeignSelectionIdentity>,
    pub(super) current_selection: Option<Selection>,
    pub(super) composition_key: Option<NodeKey>,
    pub(super) detached: Vec<Option<Selection>>,
    pub(super) selection_identities: crate::foreign::selections::SelectionIdentities,
    pub(super) retired_records: crate::state::NodeMap,
}
impl Clone for ForeignReadContext {
    fn clone(&self) -> Self {
        Self {
            registry: self.registry.clone(),
            origin: self.origin.clone(),
            native_calls: self.native_calls.clone(),
            previous_selection: self
                .previous_selection
                .as_ref()
                .map(Selection::snapshot_for_foreign_read),
            previous_selection_identity: self.previous_selection_identity.clone(),
            current_selection: self
                .current_selection
                .as_ref()
                .map(Selection::snapshot_for_foreign_read),
            composition_key: self.composition_key,
            detached: self
                .detached
                .iter()
                .map(|value| value.as_ref().map(Selection::snapshot_for_foreign_read))
                .collect(),
            selection_identities: self.selection_identities.clone(),
            retired_records: self.retired_records.clone(),
        }
    }
}
impl ReadOrigin {
    pub(super) fn matches_lease(&self, lease: Option<&ForeignReadLease>) -> bool {
        match (&self.lease, lease) {
            (None, None) => true,
            (Some(actual), Some(expected)) => {
                actual.ptr_eq(&Arc::downgrade(&expected.0)) && actual.upgrade().is_some()
            }
            _ => false,
        }
    }

    pub(super) fn matches(
        &self,
        editor: &ForeignEditorIdentity,
        update: &ForeignUpdateIdentity,
    ) -> bool {
        Arc::ptr_eq(&self.editor, &editor.0)
            && Arc::ptr_eq(&self.update, &update.0)
            && self
                .lease
                .as_ref()
                .is_none_or(|lease| lease.upgrade().is_some())
    }
}
impl ForeignReadContext {
    /// Whether this context carries the exact lease, or an ordinary update origin for None.
    pub fn matches_read_lease(&self, lease: Option<&ForeignReadLease>) -> bool {
        self.origin.matches_lease(lease)
    }

    /// Whether the source editor/update and any enclosing preparation lease match.
    pub fn matches_origin(
        &self,
        editor: &ForeignEditorIdentity,
        update: &ForeignUpdateIdentity,
    ) -> bool {
        self.origin.matches(editor, update)
    }
}
impl StateRef<'_> {
    /// Save update read metadata without making live records shared before cache writes.
    /// Originless immutable states cannot supply an update context.
    pub fn context_for_foreign_read(self) -> Result<ForeignReadContext, Error> {
        Ok(ForeignReadContext {
            registry: self.state.registry.clone(),
            origin: self
                .foreign_origin
                .ok_or(Error::Invariant("read context requires an update origin"))?
                .capture(),
            native_calls: self.foreign_native_calls.cloned(),
            previous_selection: self
                .previous_selection
                .map(Selection::snapshot_for_foreign_read),
            previous_selection_identity: self.foreign_previous_selection_identity.cloned(),
            current_selection: self
                .state
                .selection
                .as_ref()
                .map(Selection::snapshot_for_foreign_read),
            composition_key: self.composition_key,
            detached: self
                .detached_selections
                .iter()
                .map(|value| value.as_ref().map(Selection::snapshot_for_foreign_read))
                .collect(),
            selection_identities: self
                .foreign_selection_identities
                .cloned()
                .unwrap_or_else(|| crate::foreign::selections::SelectionIdentities {
                    current: self.state.foreign_selection_identity.clone(),
                    detached: Vec::new(),
                }),
            retired_records: self.retired_records.cloned().unwrap_or_default(),
        })
    }
}
