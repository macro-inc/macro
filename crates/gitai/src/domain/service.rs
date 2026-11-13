use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tracing::field::Empty;

use super::ingest::{
    CommitRecord, EventError, IngestPlan, SessionChunk, StoredLine, TokenBucket, TokenDelta, jsonl,
    jsonl_zst, plan_batch,
};
use super::layout;
use super::metrics::{BatchResult, Endpoint, EventResult, LineKind, Metric, TokenKind};
use super::models::{
    ClientHeaders, CredentialId, CredentialInfo, DeviceCredential, DeviceIdentity, Email,
    GitaiError, Hostname, MintedCredential, PINNED_CLIENT_VERSION, PINNED_SHA256SUMS_CHECKSUM,
    RELEASE_DOWNLOAD_BASE_URL, SharedKey,
};
use super::ports::{
    Bucket, IndexStore, IngestMetrics, ObjectStore, SessionUpdate, StoredCredential,
};
use super::redaction::{RedactionHits, redact_text};
use super::wire::MetricsBatch;

#[cfg(test)]
mod test;

/// A credential's `last_used_at` is rewritten at most this often.
const LAST_USED_RESOLUTION: Duration = Duration::minutes(5);

/// Most commits one notes read may ask for (the notes contract's limit).
const MAX_NOTES_PER_READ: usize = 100;

/// Release channels the client may ask about; all offer the pinned version.
pub const RELEASE_CHANNELS: [&str; 4] = ["latest", "next", "enterprise-latest", "enterprise-next"];

/// `client_version` label when the `User-Agent` names none.
const UNKNOWN_CLIENT_VERSION: &str = "unknown";

/// Longest client version kept as a label.
const MAX_CLIENT_VERSION_LEN: usize = 32;

/// Tool and model labels of human-written lines.
const HUMAN_LABEL: &str = "human";

const ZSTD_JSONL: &str = "application/zstd";
const JSONL: &str = "application/x-ndjson";
const NOTE_TEXT: &str = "text/plain; charset=utf-8";

/// One release channel's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReleaseChannel {
    /// `v<semver>` tag.
    pub version: String,
    /// SHA-256 of the release's `SHA256SUMS`.
    pub checksum: &'static str,
}

/// Outcome of a notes upload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct NotesUploadOutcome {
    /// Notes stored.
    pub success_count: usize,
    /// Notes refused: malformed, or for a commit not known from an accepted
    /// Committed event (the only way to know a note's repository).
    pub failure_count: usize,
}

#[derive(Deserialize)]
struct NotesUpload {
    entries: Vec<NoteEntry>,
}

#[derive(Deserialize)]
struct NoteEntry {
    commit_sha: String,
    content: String,
}

#[derive(Deserialize)]
struct CasUpload {
    objects: Vec<CasObject>,
}

#[derive(Deserialize)]
struct CasObject {
    hash: String,
}

#[derive(Deserialize)]
struct LogsUpload {
    events: Vec<Value>,
}

/// The git-ai use cases. Inbound adapters call it; it reaches storage only
/// through its ports.
pub struct GitaiService<Objects, Index, Metrics> {
    objects: Objects,
    index: Index,
    metrics: Metrics,
    shared_key: SharedKey,
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> GitaiError {
    GitaiError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>
    GitaiService<Objects, Index, Metrics>
{
    /// A service over the given adapters.
    pub fn new(objects: Objects, index: Index, metrics: Metrics, shared_key: SharedKey) -> Self {
        Self {
            objects,
            index,
            metrics,
            shared_key,
        }
    }

    /// Checks the operator's shared key (constant time).
    pub fn authorize_operator(&self, presented: Option<&str>) -> Result<(), GitaiError> {
        match presented {
            Some(key) if self.shared_key.matches(key) => Ok(()),
            _ => Err(GitaiError::Unauthorized),
        }
    }

    /// The identity behind a device credential. The shared key is not a
    /// device credential and is refused here.
    /// A refused key is expected client behaviour, so it is logged as a
    /// warning; storage failures are logged as errors where they are answered.
    #[tracing::instrument(name = "gitai.authenticate", skip_all, fields(credential_id = Empty), err(level = "warn"))]
    pub async fn authenticate_device(
        &self,
        presented: Option<&str>,
    ) -> Result<DeviceIdentity, GitaiError> {
        let credential = presented
            .and_then(DeviceCredential::parse)
            .ok_or(GitaiError::Unauthorized)?;
        let hash = credential.hash();
        let info = self
            .index
            .credential_by_hash(&hash)
            .await
            .map_err(internal)?
            .filter(|info| info.revoked_at.is_none())
            .ok_or(GitaiError::Unauthorized)?;
        tracing::Span::current().record("credential_id", tracing::field::display(info.id));

        let now = Utc::now();
        let stale = info
            .last_used_at
            .is_none_or(|last_used| now - last_used >= LAST_USED_RESOLUTION);
        if stale {
            // Usage tracking must not fail an upload.
            let _ = self.index.touch_credential(&hash, now).await.inspect_err(
                |error| tracing::warn!(error = ?error, "could not record credential use"),
            );
        }

        Ok(DeviceIdentity {
            credential_id: info.id,
            email: info.email,
            hostname: info.hostname,
        })
    }

    /// `GET /v1/whoami`.
    pub async fn whoami(&self, presented: Option<&str>) -> Result<DeviceIdentity, GitaiError> {
        self.authenticate_device(presented).await
    }

    /// Mints a device credential bound to a person and machine.
    #[tracing::instrument(name = "gitai.credentials.mint", skip_all, fields(credential_id = Empty), err(level = "warn"))]
    pub async fn mint_credential(
        &self,
        presented: Option<&str>,
        email: &str,
        hostname: &str,
    ) -> Result<MintedCredential, GitaiError> {
        self.authorize_operator(presented)?;
        let email = Email::parse(email)?;
        let hostname = Hostname::parse(hostname)?;

        let credential = DeviceCredential::generate();
        let info = CredentialInfo {
            id: CredentialId::generate(),
            email,
            hostname,
            created_at: Utc::now(),
            last_used_at: None,
            revoked_at: None,
        };
        self.index
            .insert_credential(&StoredCredential {
                info: info.clone(),
                hash: credential.hash(),
            })
            .await
            .map_err(internal)?;
        tracing::Span::current().record("credential_id", tracing::field::display(info.id));
        Ok(MintedCredential { info, credential })
    }

    /// Every credential, without secrets.
    pub async fn list_credentials(
        &self,
        presented: Option<&str>,
    ) -> Result<Vec<CredentialInfo>, GitaiError> {
        self.authorize_operator(presented)?;
        self.index.list_credentials().await.map_err(internal)
    }

    /// Revokes a credential; its next request gets 401.
    #[tracing::instrument(
        name = "gitai.credentials.revoke",
        skip(self, presented),
        err(level = "warn")
    )]
    pub async fn revoke_credential(
        &self,
        presented: Option<&str>,
        id: CredentialId,
    ) -> Result<(), GitaiError> {
        self.authorize_operator(presented)?;
        let found = self
            .index
            .revoke_credential(id, Utc::now())
            .await
            .map_err(internal)?;
        if found {
            Ok(())
        } else {
            Err(GitaiError::NotFound)
        }
    }

    /// Authenticates a client request before its body is read. A refusal is
    /// counted in `gitai.ingest.batches` as `unauthorized`.
    pub async fn authenticate_client(
        &self,
        endpoint: Endpoint,
        presented: Option<&str>,
        headers: &ClientHeaders,
    ) -> Result<DeviceIdentity, GitaiError> {
        let result = self.authenticate_device(presented).await;
        if let Err(error) = &result {
            self.record_batch(endpoint, headers, error_outcome(error));
        }
        result
    }

    /// Runs an authenticated client request and counts it in
    /// `gitai.ingest.batches`.
    async fn client_request<T>(
        &self,
        endpoint: Endpoint,
        headers: &ClientHeaders,
        work: impl Future<Output = Result<T, GitaiError>>,
    ) -> Result<T, GitaiError> {
        let result = work.await;
        let outcome = match &result {
            Ok(_) => BatchResult::Ok,
            Err(error) => error_outcome(error),
        };
        self.record_batch(endpoint, headers, outcome);
        result
    }

    fn record_batch(&self, endpoint: Endpoint, headers: &ClientHeaders, result: BatchResult) {
        self.metrics.record(Metric::Batch {
            endpoint,
            result,
            client_version: client_version_label(headers),
        });
    }

    /// `POST /worker/metrics/upload`. Returns the events the client should
    /// stop sending; events of other repositories are dropped silently so the
    /// client stops retrying them too.
    pub async fn ingest_metrics(
        &self,
        identity: &DeviceIdentity,
        headers: &ClientHeaders,
        body: &[u8],
    ) -> Result<Vec<EventError>, GitaiError> {
        self.client_request(Endpoint::MetricsUpload, headers, async move {
            self.ingest_batch(identity, headers, body).await
        })
        .await
    }

    #[tracing::instrument(
        name = "gitai.ingest.batch",
        skip_all,
        fields(
            credential_id = %identity.credential_id,
            client_version = headers.client_version.as_deref().unwrap_or(UNKNOWN_CLIENT_VERSION),
            bytes = body.len(),
            events = Empty,
            accepted = Empty,
            dropped_repo = Empty,
            dropped_no_repo = Empty,
            invalid = Empty,
            redaction_hits = Empty,
            commits = Empty,
            sessions = Empty,
            token_buckets = Empty,
        ),
        err(level = "warn")
    )]
    async fn ingest_batch(
        &self,
        identity: &DeviceIdentity,
        headers: &ClientHeaders,
        body: &[u8],
    ) -> Result<Vec<EventError>, GitaiError> {
        let batch: MetricsBatch = serde_json::from_slice(body)
            .map_err(|_| GitaiError::BadRequest("body is not a metrics batch".to_owned()))?;
        let event_count = batch.events.len();
        let received_at = Utc::now();
        let plan = plan_batch(
            batch,
            super::ingest::Envelope::new(identity, headers, received_at),
        );

        let span = tracing::Span::current();
        span.record("events", event_count);
        span.record("accepted", plan.tally.with_result(EventResult::Accepted));
        span.record(
            "dropped_repo",
            plan.tally.with_result(EventResult::DroppedRepo),
        );
        span.record(
            "dropped_no_repo",
            plan.tally.with_result(EventResult::DroppedNoRepo),
        );
        span.record("invalid", plan.tally.with_result(EventResult::Invalid));
        span.record("redaction_hits", plan.redaction.total());
        span.record("commits", plan.commits.len());
        span.record("sessions", plan.sessions.len());
        span.record("token_buckets", plan.token_buckets.len());

        // S3 first: the table only ever points at objects that exist. The
        // batch id is a hash of who sent what, so a retried batch overwrites
        // its own objects instead of adding copies (within the same hour
        // partition; a retry that crosses one writes a second copy).
        let batch_id = batch_id(identity, body);
        self.store_objects(&plan, &batch_id).await?;
        self.index_plan(&plan).await?;

        // Counted once the batch is stored, so a failed attempt and its
        // retry count once.
        for (event, result, count) in plan.tally.iter() {
            self.metrics.record(Metric::Events {
                event,
                result,
                count,
            });
        }
        self.record_redaction(&plan.redaction);
        Ok(plan.errors)
    }

    fn record_redaction(&self, hits: &RedactionHits) {
        for (rule, count) in hits.iter() {
            self.metrics.record(Metric::RedactionHits { rule, count });
        }
    }

    async fn put(
        &self,
        bucket: Bucket,
        key: &str,
        body: Vec<u8>,
        content_type: &'static str,
    ) -> Result<(), GitaiError> {
        self.objects
            .put(bucket, key, body, content_type)
            .await
            .map_err(internal)
    }

    async fn store_objects(&self, plan: &IngestPlan, batch_id: &str) -> Result<(), GitaiError> {
        let received_at = plan.envelope.received_at;

        if !plan.raw_events.is_empty() {
            let lines = plan.raw_events.iter().map(|event| StoredLine {
                envelope: &plan.envelope,
                event: event.raw(),
            });
            let body = jsonl_zst(lines).map_err(internal)?;
            self.put(
                Bucket::Events,
                &layout::raw_key(received_at, batch_id),
                body,
                ZSTD_JSONL,
            )
            .await?;
        }

        for commit in &plan.commits {
            if let (Some(note), Some(key)) = (&commit.note, &commit.note_key) {
                self.put(Bucket::Events, key, note.clone().into_bytes(), NOTE_TEXT)
                    .await?;
            }
        }

        let mut commits_by_repository: BTreeMap<&str, Vec<&CommitRecord>> = BTreeMap::new();
        for commit in &plan.commits {
            commits_by_repository
                .entry(commit.repository.as_str())
                .or_default()
                .push(commit);
        }
        for (repository, commits) in commits_by_repository {
            let body = jsonl_zst(commits).map_err(internal)?;
            let key = layout::commits_key(repository, received_at, batch_id);
            self.put(Bucket::Events, &key, body, ZSTD_JSONL).await?;
        }

        if !plan.token_buckets.is_empty() {
            let body = jsonl_zst(&plan.token_buckets).map_err(internal)?;
            self.put(
                Bucket::Events,
                &layout::usage_key(received_at, batch_id),
                body,
                ZSTD_JSONL,
            )
            .await?;
        }

        let mut index_lines = Vec::with_capacity(plan.sessions.len());
        for chunk in &plan.sessions {
            let lines = chunk.events.iter().map(|event| StoredLine {
                envelope: &plan.envelope,
                event: event.raw(),
            });
            let body = jsonl_zst(lines).map_err(internal)?;
            let key = chunk.key();
            let bytes = body.len();
            self.put(Bucket::Sessions, &key, body, ZSTD_JSONL).await?;
            index_lines.push(session_index_line(plan, chunk, key, bytes));
        }
        if !index_lines.is_empty() {
            let body = jsonl(index_lines).map_err(internal)?;
            let key = layout::session_index_key(received_at, batch_id);
            self.put(Bucket::Sessions, &key, body, JSONL).await?;
        }
        Ok(())
    }

    async fn update_session(&self, update: SessionUpdate) -> Result<(), GitaiError> {
        let created = self.index.update_session(&update).await.map_err(internal)?;
        if created {
            self.metrics.record(Metric::SessionStarted {
                author: update
                    .author
                    .as_ref()
                    .map_or_else(String::new, |author| author.as_str().to_owned()),
                tool: update
                    .tool
                    .clone()
                    .unwrap_or_else(|| super::ingest::UNKNOWN_TOOL.to_owned()),
            });
        }
        Ok(())
    }

    async fn index_plan(&self, plan: &IngestPlan) -> Result<(), GitaiError> {
        for commit in &plan.commits {
            let new = self.index.put_commit(commit).await.map_err(internal)?;
            if new {
                self.record_commit_metrics(commit);
            }
            for session in &commit.sessions {
                self.update_session(SessionUpdate {
                    session_id: session.session_id.clone(),
                    external_session_id: session.external_session_id.clone(),
                    tool: session.tool.clone(),
                    model: session.model.clone(),
                    repository: Some(commit.repository.clone()),
                    author: Some(commit.author.clone()),
                    hostname: Some(commit.hostname.clone()),
                    commit_shas: vec![commit.sha.clone()],
                    ..SessionUpdate::default()
                })
                .await?;
            }
        }

        // Session fields first: they are idempotent (first writer wins,
        // min/max), so a retried batch reapplies them safely, and the update
        // that creates the entry is the one counted as a new session. The
        // counters then move in the same transaction as the chunk or token
        // bucket they come from, so they apply exactly once across retries.
        for chunk in &plan.sessions {
            self.update_session(SessionUpdate {
                session_id: chunk.session_id.clone(),
                external_session_id: chunk.external_session_id.clone(),
                tool: Some(chunk.tool.clone()),
                repository: Some(chunk.repository.clone()),
                author: Some(plan.envelope.email.clone()),
                hostname: Some(plan.envelope.hostname.clone()),
                transcript_prefix: Some(layout::transcript_prefix(&chunk.tool, &chunk.session_id)),
                first_seen: Some(chunk.first_ts),
                last_seen: Some(chunk.last_ts),
                ..SessionUpdate::default()
            })
            .await?;
            self.index
                .put_session_chunk(chunk, &chunk.key())
                .await
                .map_err(internal)?;
        }

        for bucket in &plan.token_buckets {
            self.update_session(SessionUpdate {
                session_id: bucket.session_id.clone(),
                external_session_id: bucket.external_session_id.clone(),
                tool: Some(bucket.tool.clone()),
                model: Some(bucket.model.clone()),
                repository: Some(bucket.repository.clone()),
                author: Some(bucket.author.clone()),
                hostname: Some(bucket.hostname.clone()),
                ..SessionUpdate::default()
            })
            .await?;
            let delta = self
                .index
                .record_token_bucket(bucket)
                .await
                .map_err(internal)?;
            if let Some(delta) = delta.filter(|delta| !delta.is_zero()) {
                self.record_token_metrics(bucket, &delta);
            }
        }
        Ok(())
    }

    fn record_commit_metrics(&self, commit: &CommitRecord) {
        let repo = commit.repository.clone();
        let author = commit.author.as_str().to_owned();
        self.metrics.record(Metric::Commit {
            repo: repo.clone(),
            author: author.clone(),
        });
        for (pair, count) in &commit.ai_lines_by_tool_model {
            let (tool, model) = pair
                .split_once("::")
                .unwrap_or((pair, super::ingest::UNKNOWN_TOOL));
            self.metrics.record(Metric::Lines {
                repo: repo.clone(),
                author: author.clone(),
                tool: tool.to_owned(),
                model: model.to_owned(),
                kind: LineKind::Ai,
                count: *count,
            });
        }
        if commit.human_lines > 0 {
            self.metrics.record(Metric::Lines {
                repo,
                author,
                tool: HUMAN_LABEL.to_owned(),
                model: HUMAN_LABEL.to_owned(),
                kind: LineKind::Human,
                count: commit.human_lines,
            });
        }
    }

    /// Counters only grow, so a bucket corrected downwards adds nothing.
    fn record_token_metrics(&self, bucket: &TokenBucket, delta: &TokenDelta) {
        let author = bucket.author.as_str();
        for (kind, change) in [
            (TokenKind::Input, delta.input),
            (TokenKind::Output, delta.output),
            (TokenKind::CacheRead, delta.cache_read),
            (TokenKind::CacheWrite, delta.cache_write),
        ] {
            if let Ok(count @ 1..) = u64::try_from(change) {
                self.metrics.record(Metric::Tokens {
                    author: author.to_owned(),
                    tool: bucket.tool.clone(),
                    model: bucket.model.clone(),
                    kind,
                    count,
                });
            }
        }
        if let Ok(micro_usd @ 1..) = u32::try_from(delta.cost_micro_usd) {
            self.metrics.record(Metric::Cost {
                author: author.to_owned(),
                tool: bucket.tool.clone(),
                model: bucket.model.clone(),
                usd: f64::from(micro_usd) / 1_000_000.0,
            });
        }
    }

    /// `POST /worker/logs/upload`: daemon logs are summarized as counts on a
    /// log event (their messages can carry anything) and not stored.
    pub async fn accept_logs(
        &self,
        identity: &DeviceIdentity,
        headers: &ClientHeaders,
        body: &[u8],
    ) -> Result<usize, GitaiError> {
        self.client_request(Endpoint::LogsUpload,headers,async move {
            let upload: LogsUpload = serde_json::from_slice(body)
                .map_err(|_| GitaiError::BadRequest("body is not a logs batch".to_owned()))?;
            let level_count = |level: &str| {
                upload
                    .events
                    .iter()
                    .filter(|event| event.get("level").and_then(Value::as_str) == Some(level))
                    .count()
            };
            tracing::info!(
                credential_id = %identity.credential_id,
                client_version = headers.client_version.as_deref().unwrap_or(UNKNOWN_CLIENT_VERSION),
                events = upload.events.len(),
                errors = level_count("error"),
                warnings = level_count("warn"),
                bytes = body.len(),
                "gitai daemon logs received"
            );
            Ok(upload.events.len())
        })
        .await
    }

    /// `POST /worker/notes/upload`. A note carries no repository, so only
    /// notes for commits already indexed from an accepted Committed event are
    /// stored; the rest are counted as failures (the client only logs them).
    pub async fn upload_notes(
        &self,
        _identity: &DeviceIdentity,
        headers: &ClientHeaders,
        body: &[u8],
    ) -> Result<NotesUploadOutcome, GitaiError> {
        self.client_request(Endpoint::NotesUpload, headers, async move {
            let upload: NotesUpload = serde_json::from_slice(body)
                .map_err(|_| GitaiError::BadRequest("body is not a notes upload".to_owned()))?;
            let shas: Vec<String> = upload
                .entries
                .iter()
                .filter_map(|entry| commit_sha(&entry.commit_sha))
                .collect();
            let known = self.index.known_commits(&shas).await.map_err(internal)?;

            let mut hits = RedactionHits::default();
            let mut stored = 0;
            for entry in &upload.entries {
                let Some(sha) = commit_sha(&entry.commit_sha).filter(|sha| known.contains(sha))
                else {
                    continue;
                };
                let note = redact_text(&entry.content, &mut hits).into_owned();
                self.put(
                    Bucket::Events,
                    &layout::note_key(&sha),
                    note.into_bytes(),
                    NOTE_TEXT,
                )
                .await?;
                stored += 1;
            }
            self.record_redaction(&hits);
            Ok(NotesUploadOutcome {
                success_count: stored,
                failure_count: upload.entries.len() - stored,
            })
        })
        .await
    }

    /// `GET /worker/notes/?commits=a,b`: the stored notes among them.
    pub async fn read_notes(
        &self,
        _identity: &DeviceIdentity,
        headers: &ClientHeaders,
        commits: &str,
    ) -> Result<BTreeMap<String, String>, GitaiError> {
        self.client_request(Endpoint::NotesRead, headers, async move {
            let shas: HashSet<String> = commits
                .split(',')
                .filter_map(commit_sha)
                .take(MAX_NOTES_PER_READ)
                .collect();
            let mut notes = BTreeMap::new();
            for sha in shas {
                let stored = self
                    .objects
                    .get(Bucket::Events, &layout::note_key(&sha))
                    .await
                    .map_err(internal)?;
                if let Some(note) = stored.and_then(|bytes| String::from_utf8(bytes).ok()) {
                    notes.insert(sha, note);
                }
            }
            Ok(notes)
        })
        .await
    }

    /// `POST /worker/cas/upload`. git-ai 1.7.7 never sends CAS objects, and a
    /// CAS object (a prompt) names no repository, so it cannot pass the
    /// repository filter: each is acknowledged and discarded.
    pub async fn accept_cas(
        &self,
        _identity: &DeviceIdentity,
        headers: &ClientHeaders,
        body: &[u8],
    ) -> Result<Vec<String>, GitaiError> {
        self.client_request(Endpoint::CasUpload, headers, async move {
            let upload: CasUpload = serde_json::from_slice(body)
                .map_err(|_| GitaiError::BadRequest("body is not a CAS upload".to_owned()))?;
            Ok(upload
                .objects
                .into_iter()
                .map(|object| object.hash)
                .collect())
        })
        .await
    }

    /// `GET /worker/cas/?hashes=`: nothing is stored, so every hash is missing.
    pub async fn read_cas(
        &self,
        _identity: &DeviceIdentity,
        headers: &ClientHeaders,
        hashes: &str,
    ) -> Result<Vec<String>, GitaiError> {
        self.client_request(Endpoint::CasRead, headers, async move {
            Ok(hashes
                .split(',')
                .filter(|hash| !hash.is_empty())
                .map(str::to_owned)
                .collect())
        })
        .await
    }

    /// `GET /worker/releases`: every channel offers the pinned release.
    pub async fn releases(
        &self,
        _identity: &DeviceIdentity,
        headers: &ClientHeaders,
    ) -> Result<BTreeMap<&'static str, ReleaseChannel>, GitaiError> {
        self.client_request(Endpoint::Releases, headers, async move {
            Ok(RELEASE_CHANNELS
                .into_iter()
                .map(|channel| {
                    let release = ReleaseChannel {
                        version: format!("v{PINNED_CLIENT_VERSION}"),
                        checksum: PINNED_SHA256SUMS_CHECKSUM,
                    };
                    (channel, release)
                })
                .collect())
        })
        .await
    }
}

/// Hex of the first 16 bytes of SHA-256(credential id, body): the same
/// upload from the same device always gets the same id.
fn batch_id(identity: &DeviceIdentity, body: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(identity.credential_id.to_string().as_bytes());
    hasher.update(b"\n");
    hasher.update(body);
    hex::encode(hasher.finalize().get(..16).unwrap_or_default())
}

/// How a failed client request is counted.
fn error_outcome(error: &GitaiError) -> BatchResult {
    match error {
        GitaiError::Unauthorized => BatchResult::Unauthorized,
        GitaiError::BadRequest(_) | GitaiError::NotFound => BatchResult::Invalid,
        GitaiError::Internal(_) => BatchResult::Error,
    }
}

/// Where `GET /worker/releases/{channel}/download/{file}` redirects: the
/// pinned GitHub release's asset. Unauthenticated, because the client sends
/// no credential on downloads.
pub fn release_download_url(channel: &str, file: &str) -> Result<String, GitaiError> {
    let file_ok = !file.is_empty()
        && !file.starts_with('.')
        && file
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !RELEASE_CHANNELS.contains(&channel) || !file_ok {
        return Err(GitaiError::NotFound);
    }
    Ok(format!(
        "{RELEASE_DOWNLOAD_BASE_URL}/v{PINNED_CLIENT_VERSION}/{file}"
    ))
}

/// A lowercase 40- or 64-character hex SHA.
fn commit_sha(raw: &str) -> Option<String> {
    let sha = raw.trim().to_lowercase();
    let valid = matches!(sha.len(), 40 | 64) && sha.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then_some(sha)
}

/// The `client_version` label: the version from `User-Agent` when it looks
/// like one, so a hostile header cannot grow the label set without bound.
fn client_version_label(headers: &ClientHeaders) -> String {
    headers
        .client_version
        .as_deref()
        .filter(|version| {
            !version.is_empty()
                && version.len() <= MAX_CLIENT_VERSION_LEN
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
        })
        .unwrap_or(UNKNOWN_CLIENT_VERSION)
        .to_owned()
}

#[derive(Serialize)]
struct SessionIndexLine<'a> {
    session_id: &'a str,
    external_session_id: Option<&'a str>,
    tool: &'a str,
    repository: &'a str,
    email: &'a Email,
    hostname: &'a Hostname,
    credential_id: CredentialId,
    received_at: DateTime<Utc>,
    first_ts: u64,
    last_ts: u64,
    event_count: usize,
    bytes: usize,
    key: String,
}

fn session_index_line<'a>(
    plan: &'a IngestPlan,
    chunk: &'a SessionChunk,
    key: String,
    bytes: usize,
) -> SessionIndexLine<'a> {
    SessionIndexLine {
        session_id: &chunk.session_id,
        external_session_id: chunk.external_session_id.as_deref(),
        tool: &chunk.tool,
        repository: &chunk.repository,
        email: &plan.envelope.email,
        hostname: &plan.envelope.hostname,
        credential_id: plan.envelope.credential_id,
        received_at: plan.envelope.received_at,
        first_ts: chunk.first_ts,
        last_ts: chunk.last_ts,
        event_count: chunk.events.len(),
        bytes,
        key,
    }
}
