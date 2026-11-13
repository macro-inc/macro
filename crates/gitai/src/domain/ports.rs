use std::collections::HashSet;

use chrono::{DateTime, Utc};

use super::ingest::{CommitRecord, SessionChunk, TokenBucket, TokenDelta};
use super::metrics::Metric;
use super::models::{CredentialHash, CredentialId, CredentialInfo, Email, Hostname};

/// The two buckets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Bucket {
    /// Raw batches, notes, commit and usage rows. Kept.
    Events,
    /// Transcripts and the session index. Expire after 180 days.
    Sessions,
}

/// Durable storage (S3). The source of truth; the [`IndexStore`] can be
/// rebuilt from it. Keys come from [`super::layout`].
pub trait ObjectStore: Send + Sync + 'static {
    /// Adapter failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Writes (or overwrites) one object.
    fn put(
        &self,
        bucket: Bucket,
        key: &str,
        body: Vec<u8>,
        content_type: &'static str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Reads one object; `None` when it does not exist.
    fn get(
        &self,
        bucket: Bucket,
        key: &str,
    ) -> impl Future<Output = Result<Option<Vec<u8>>, Self::Err>> + Send;
}

/// A credential as stored: its metadata and the hash it is found by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCredential {
    /// Metadata.
    pub info: CredentialInfo,
    /// SHA-256 of the secret.
    pub hash: CredentialHash,
}

/// What one ingest step adds to a session's index entry. Every field is
/// optional so a commit, a transcript chunk and a token bucket can each
/// update the entry on their own.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SessionUpdate {
    /// git-ai session id (`s_…`), the entry's key.
    pub session_id: String,
    /// The agent's own session id.
    pub external_session_id: Option<String>,
    /// Agent; kept from the first update that knows it.
    pub tool: Option<String>,
    /// Model; the latest known model wins (`unknown` is ignored).
    pub model: Option<String>,
    /// Repository (`host/owner/name`).
    pub repository: Option<String>,
    /// Credential email of whoever uploaded it.
    pub author: Option<Email>,
    /// Credential hostname.
    pub hostname: Option<Hostname>,
    /// Transcript prefix in the sessions bucket.
    pub transcript_prefix: Option<String>,
    /// Earliest event time in this update (unix s); the entry keeps the minimum.
    pub first_seen: Option<u64>,
    /// Latest event time in this update; the entry keeps the maximum.
    pub last_seen: Option<u64>,
    /// Transcript lines added.
    pub event_count: u64,
    /// Token and cost change.
    pub tokens: TokenDelta,
    /// Commits this session wrote lines of.
    pub commit_shas: Vec<String>,
}

/// Lookups by key (DynamoDB): device credentials, commits, sessions.
pub trait IndexStore: Send + Sync + 'static {
    /// Adapter failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Stores a new credential.
    fn insert_credential(
        &self,
        credential: &StoredCredential,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The credential with this hash, revoked or not.
    fn credential_by_hash(
        &self,
        hash: &CredentialHash,
    ) -> impl Future<Output = Result<Option<CredentialInfo>, Self::Err>> + Send;

    /// Every credential, oldest first.
    fn list_credentials(
        &self,
    ) -> impl Future<Output = Result<Vec<CredentialInfo>, Self::Err>> + Send;

    /// Marks a credential revoked (keeping an earlier revocation time).
    /// `false` when no credential has this id.
    fn revoke_credential(
        &self,
        id: CredentialId,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Records a use of the credential.
    fn touch_credential(
        &self,
        hash: &CredentialHash,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Writes a commit's index entry. `true` when the commit was not indexed
    /// before, so counters count each commit once across client retries.
    fn put_commit(
        &self,
        commit: &CommitRecord,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Which of these commits are indexed.
    fn known_commits(
        &self,
        shas: &[String],
    ) -> impl Future<Output = Result<HashSet<String>, Self::Err>> + Send;

    /// Indexes one stored transcript chunk under its session, at `s3_key`.
    /// `false` when that chunk was already indexed (a retried batch).
    fn put_session_chunk(
        &self,
        chunk: &SessionChunk,
        s3_key: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Stores a token bucket revision if it is newer than the stored one, and
    /// returns how much it changed the totals; `None` for a stale revision.
    fn record_token_bucket(
        &self,
        bucket: &TokenBucket,
    ) -> impl Future<Output = Result<Option<TokenDelta>, Self::Err>> + Send;

    /// Applies an update to a session's entry, creating it if needed. `true`
    /// when it was created.
    fn update_session(
        &self,
        update: &SessionUpdate,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Counters exported to Grafana. Never carries content: only the labels
/// named in [`Metric`].
pub trait IngestMetrics: Send + Sync + 'static {
    /// Adds to one counter.
    fn record(&self, metric: Metric);
}
