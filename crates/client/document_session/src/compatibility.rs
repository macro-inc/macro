//! Compatibility aliases over generic same-core staging and admission.
use super::*;
use lexical_model::*;
#[cfg(test)]
use std::sync::Arc;
/// Compatibility name for the common single-consumption staged update.
pub type CompatUpdate = crate::StagedUpdate;
/// Core registry and exactly the common admission handler, without behavior plugins.
pub fn compat_editor_builder(mode: EditorMode, peer: u64) -> EditorBuilder {
    crate::staging_editor_builder(mode, peer)
}
impl DocumentSession<EditorSurface> {
    /// Start an unpublished compatibility update on the existing core.
    pub fn suspend_compat_update(&mut self) -> PendingUpdate {
        self.suspend_staged_update()
    }
    /// Scope compatibility work without publishing or changing its authority.
    pub fn with_compat_update<T>(
        &mut self,
        pending: PendingUpdate,
        body: impl FnOnce(&mut Transaction<'_>) -> T,
    ) -> Result<(PendingUpdate, T), Error> {
        self.with_staged_update(pending, body)
    }
}
#[cfg(test)]
#[path = "compatibility/test.rs"]
mod test;
