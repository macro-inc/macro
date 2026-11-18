//! Host reconciliation seals its already-normalized pending update before admission.
use crate::*;

/// One native host reconciliation phase on an exact unpublished update.
/// The protocol host validates its stage acknowledgement before consuming this token.
pub struct ForeignReconcileStage {
    owner: ForeignEditorIdentity,
    update: ForeignUpdateIdentity,
}
impl Transaction<'_> {
    /// Open a host-owned reconcile phase after synchronous normalization.
    /// This grants no publication authority and cannot be used by native cache owners.
    pub fn begin_foreign_reconciliation(&self) -> Result<ForeignReconcileStage, Error> {
        self.guard_write()?;
        if !self.defer_publication || self.pending.registry.derive_view_caches {
            return Err(Error::Invariant("host reconciliation is not delegated"));
        }
        if self.needs_flush() || !self.nested.is_empty() {
            return Err(Error::Invariant(
                "host reconciliation requires a flushed update",
            ));
        }
        Ok(ForeignReconcileStage {
            owner: self.editor.foreign_instance_owner(),
            update: self.foreign_update_identity(),
        })
    }
    /// Seal the acknowledged host phase without replaying transforms or GC.
    /// Call only after successful callback operations and acknowledgement validation.
    /// On callback failure, keep the update open rather than invoking this method.
    pub fn finish_foreign_reconciliation(
        &mut self,
        stage: ForeignReconcileStage,
    ) -> Result<(), Error> {
        self.guard_write()?;
        if !self.defer_publication
            || self.pending.registry.derive_view_caches
            || !stage.owner.matches(self)
            || !stage.update.matches(self)
        {
            return Err(Error::Invariant("host reconciliation update mismatch"));
        }
        if !self.nested.is_empty() {
            return Err(Error::Invariant(
                "host reconciliation has queued native updates",
            ));
        }
        self.check_pending_foreign_payloads()?;
        self.dirty_since_flush = false;
        self.sealed = true;
        Ok(())
    }
    /// Reopen after ordinary admission refused the still-unpublished sealed update.
    /// Existing writes and host instance identities remain unchanged.
    pub fn reopen_foreign_reconciliation(&mut self) -> Result<(), Error> {
        ForeignReadOperation::check()?;
        if self.foreign_read_only
            || !self.defer_publication
            || self.pending.registry.derive_view_caches
        {
            return Err(Error::Invariant("host reconciliation is not delegated"));
        }
        if !self.sealed {
            return Err(Error::Invariant("host reconciliation is not sealed"));
        }
        self.sealed = false;
        Ok(())
    }
}

#[cfg(test)]
mod test;
