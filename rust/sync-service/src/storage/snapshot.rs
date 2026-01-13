pub trait SnapshotStorage {
    /// Stores a snapshot in the storage
    async fn store_snapshot(&self, snapshot: &[u8]) -> worker::Result<()>;
    /// Retrieves a snpashot from the storage
    async fn get_snapshot(&self) -> worker::Result<Vec<u8>>;
    /// Checks if a snapshot exists in the storage
    async fn has_snapshot(&self) -> worker::Result<bool>;
}
