//! Attach accepted editors to existing document notifications without extra I/O.
use super::*;

impl DocumentSyncSession {
    pub(crate) fn record_edit_activity(&self, attribution: Option<&DocumentAttribution>) {
        if let Some(attribution) = attribution {
            self.pending_editors
                .lock("record document editor")
                .record(attribution);
        }
    }

    pub(super) fn take_editors(&self) -> Vec<DocumentAttribution> {
        self.pending_editors.lock("take document editors").take()
    }
}
