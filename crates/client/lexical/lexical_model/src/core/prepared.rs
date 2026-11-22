//! Preparation on the actual core, without publication or a borrowed scope escaping.
use super::*;

impl EditorCore {
    /// Seal the completed main transition on this same editor.
    /// No after-commit hook, history or output listener runs here. A failure
    /// returns the exact pending value; publication still requires admission.
    pub fn prepare_staged_update(
        &mut self,
        pending: PendingUpdate,
    ) -> Result<PreparedUpdate, PreparationFailure> {
        self.editor.resume_owned(pending)?.prepare()
    }

    /// Encode only the sealed main transition using this core's actual options.
    /// Final paste parity must instead inspect the drained output after finish.
    pub fn prepared_diff(&self, prepared: &PreparedUpdate) -> Result<Diff, Error> {
        prepared.pending.check_owner(&self.editor)?;
        prepared.diff(&self.config.diff)
    }
}

#[cfg(test)]
mod test;
