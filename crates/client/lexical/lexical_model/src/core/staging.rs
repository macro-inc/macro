//! Short, scoped access to unpublished host transactions on this same core.
use super::*;

impl EditorCore {
    /// Begin an unpublished update; normal input handling still owns admission.
    pub fn suspend_staged_update(&mut self) -> PendingUpdate {
        let mut tx = self.editor.transaction();
        tx.defer_publication = true;
        tx.suspend()
    }

    /// Resume without exposing or replacing the core editor. The body result
    /// remains opaque, including a host exception carried as its return value.
    pub fn with_staged_update<T>(
        &mut self,
        pending: PendingUpdate,
        body: impl FnOnce(&mut Transaction<'_>) -> T,
    ) -> Result<(PendingUpdate, T), Error> {
        let mut tx = self.editor.resume(pending)?;
        let value = body(&mut tx);
        Ok((tx.suspend(), value))
    }
}

#[cfg(test)]
mod test;
