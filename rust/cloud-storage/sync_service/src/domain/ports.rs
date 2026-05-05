pub trait SyncWakeupService: Send + Sync + 'static {
    /// Dispatch wakeups for the given documents and return the number accepted for dispatch.
    ///
    /// Implementations should not wait for sync-service responses.
    fn bulk_wakeup(&self, document_ids: Vec<String>) -> usize;
}
