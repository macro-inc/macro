/// Durable storage: raw ingest batches, notes and session transcripts (S3).
/// S3 is the source of truth; the [`IndexStore`] can be rebuilt from it.
pub trait ObjectStore: Send + Sync + 'static {}

/// Lookups by key: device credentials, commits, sessions and pull requests
/// (DynamoDB).
pub trait IndexStore: Send + Sync + 'static {}
