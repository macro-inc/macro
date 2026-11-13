//! In-memory fakes of the ports, for domain and HTTP tests.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};

use crate::domain::ingest::{CommitRecord, SessionChunk, TokenBucket, TokenCounts, TokenDelta};
use crate::domain::metrics::Metric;
use crate::domain::models::{CredentialHash, CredentialId, CredentialInfo, SharedKey};
use crate::domain::ports::{
    Bucket, IndexStore, IngestMetrics, ObjectStore, SessionUpdate, StoredCredential,
};
use crate::domain::service::GitaiService;

pub(crate) const SHARED_KEY: &str = "test-shared-key";

type ObjectMap = BTreeMap<(Bucket, String), Vec<u8>>;

/// Objects by bucket and key.
#[derive(Clone, Default)]
pub(crate) struct MemoryObjects {
    pub(crate) objects: Arc<Mutex<ObjectMap>>,
    /// When set, every put fails.
    pub(crate) failing: Arc<Mutex<bool>>,
}

/// A put failed on purpose.
#[derive(Debug, thiserror::Error)]
#[error("injected storage failure")]
pub(crate) struct InjectedFailure;

impl MemoryObjects {
    pub(crate) fn keys(&self, bucket: Bucket) -> Vec<String> {
        self.objects
            .lock()
            .unwrap()
            .keys()
            .filter(|(b, _)| *b == bucket)
            .map(|(_, key)| key.clone())
            .collect()
    }

    pub(crate) fn object(&self, bucket: Bucket, key: &str) -> Vec<u8> {
        self.objects.lock().unwrap()[&(bucket, key.to_owned())].clone()
    }

    /// A `.jsonl.zst` object's lines as JSON.
    pub(crate) fn jsonl_zst(&self, bucket: Bucket, key: &str) -> Vec<serde_json::Value> {
        let compressed = self.object(bucket, key);
        let mut decoder = ruzstd::decoding::StreamingDecoder::new(compressed.as_slice()).unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut decoder, &mut text).unwrap();
        text.lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// Every stored byte, decompressed where needed, as one string.
    pub(crate) fn all_text(&self) -> String {
        let keys: Vec<(Bucket, String)> = self.objects.lock().unwrap().keys().cloned().collect();
        keys.into_iter()
            .map(|(bucket, key)| {
                if key.ends_with(".zst") {
                    self.jsonl_zst(bucket, &key)
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    String::from_utf8(self.object(bucket, &key)).unwrap()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl ObjectStore for MemoryObjects {
    type Err = InjectedFailure;

    async fn put(
        &self,
        bucket: Bucket,
        key: &str,
        body: Vec<u8>,
        _content_type: &'static str,
    ) -> Result<(), Self::Err> {
        if *self.failing.lock().unwrap() {
            return Err(InjectedFailure);
        }
        self.objects
            .lock()
            .unwrap()
            .insert((bucket, key.to_owned()), body);
        Ok(())
    }

    async fn get(&self, bucket: Bucket, key: &str) -> Result<Option<Vec<u8>>, Self::Err> {
        Ok(self
            .objects
            .lock()
            .unwrap()
            .get(&(bucket, key.to_owned()))
            .cloned())
    }
}

/// A session entry as the fake keeps it.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MemorySession {
    pub(crate) external_session_id: Option<String>,
    pub(crate) tool: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) transcript_prefix: Option<String>,
    pub(crate) first_seen: Option<u64>,
    pub(crate) last_seen: Option<u64>,
    pub(crate) event_count: u64,
    pub(crate) tokens: TokenDelta,
    pub(crate) commit_shas: HashSet<String>,
}

#[derive(Default)]
pub(crate) struct MemoryIndexState {
    pub(crate) credentials: HashMap<CredentialHash, CredentialInfo>,
    pub(crate) touches: u32,
    pub(crate) commits: HashMap<String, CommitRecord>,
    pub(crate) chunks: HashMap<String, BTreeMap<String, String>>,
    pub(crate) buckets: HashMap<String, (u64, TokenCounts)>,
    pub(crate) sessions: HashMap<String, MemorySession>,
    /// Session updates made so far, counting failed ones.
    pub(crate) session_updates: u32,
    /// The session update (1-based, in call order) that fails.
    pub(crate) fail_session_update: Option<u32>,
}

/// The index in maps, with the adapter's semantics (conditional writes,
/// first-writer-wins fields, min/max ranges).
#[derive(Clone, Default)]
pub(crate) struct MemoryIndex {
    pub(crate) state: Arc<Mutex<MemoryIndexState>>,
}

impl IndexStore for MemoryIndex {
    type Err = InjectedFailure;

    async fn insert_credential(&self, credential: &StoredCredential) -> Result<(), Self::Err> {
        self.state
            .lock()
            .unwrap()
            .credentials
            .insert(credential.hash.clone(), credential.info.clone());
        Ok(())
    }

    async fn credential_by_hash(
        &self,
        hash: &CredentialHash,
    ) -> Result<Option<CredentialInfo>, Self::Err> {
        Ok(self.state.lock().unwrap().credentials.get(hash).cloned())
    }

    async fn list_credentials(&self) -> Result<Vec<CredentialInfo>, Self::Err> {
        let mut credentials: Vec<CredentialInfo> = self
            .state
            .lock()
            .unwrap()
            .credentials
            .values()
            .cloned()
            .collect();
        credentials.sort_by_key(|info| info.id);
        Ok(credentials)
    }

    async fn revoke_credential(
        &self,
        id: CredentialId,
        at: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        let Some(info) = state.credentials.values_mut().find(|info| info.id == id) else {
            return Ok(false);
        };
        info.revoked_at.get_or_insert(at);
        Ok(true)
    }

    async fn touch_credential(
        &self,
        hash: &CredentialHash,
        at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.touches += 1;
        if let Some(info) = state.credentials.get_mut(hash) {
            info.last_used_at = Some(at);
        }
        Ok(())
    }

    async fn put_commit(&self, commit: &CommitRecord) -> Result<bool, Self::Err> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .commits
            .insert(commit.sha.clone(), commit.clone())
            .is_none())
    }

    async fn known_commits(&self, shas: &[String]) -> Result<HashSet<String>, Self::Err> {
        let state = self.state.lock().unwrap();
        Ok(shas
            .iter()
            .filter(|sha| state.commits.contains_key(*sha))
            .cloned()
            .collect())
    }

    async fn put_session_chunk(
        &self,
        chunk: &SessionChunk,
        s3_key: &str,
    ) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        let chunks = state.chunks.entry(chunk.session_id.clone()).or_default();
        let sort_key = format!("{:010}#{}", chunk.first_ts, chunk.chunk_id);
        let new = chunks.insert(sort_key, s3_key.to_owned()).is_none();
        if new {
            let session = state.sessions.entry(chunk.session_id.clone()).or_default();
            session.event_count += u64::try_from(chunk.events.len()).unwrap();
        }
        Ok(new)
    }

    async fn record_token_bucket(
        &self,
        bucket: &TokenBucket,
    ) -> Result<Option<TokenDelta>, Self::Err> {
        let mut state = self.state.lock().unwrap();
        let key = format!(
            "{}#{}#{}#{}",
            bucket.session_id, bucket.model, bucket.speed, bucket.bucket_ts
        );
        let previous = state.buckets.get(&key).copied();
        if previous.is_some_and(|(seq, _)| seq >= bucket.emitted_seq) {
            return Ok(None);
        }
        state
            .buckets
            .insert(key, (bucket.emitted_seq, bucket.counts));
        let previous = previous.map(|(_, counts)| counts).unwrap_or_default();
        let delta = bucket.counts.delta_since(&previous);
        let session = state.sessions.entry(bucket.session_id.clone()).or_default();
        session.tokens.input += delta.input;
        session.tokens.output += delta.output;
        session.tokens.cache_read += delta.cache_read;
        session.tokens.cache_write += delta.cache_write;
        session.tokens.cost_micro_usd += delta.cost_micro_usd;
        Ok(Some(delta))
    }

    async fn update_session(&self, update: &SessionUpdate) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.session_updates += 1;
        if state.fail_session_update == Some(state.session_updates) {
            return Err(InjectedFailure);
        }
        let created = !state.sessions.contains_key(&update.session_id);
        let session = state.sessions.entry(update.session_id.clone()).or_default();
        if session.external_session_id.is_none() {
            session.external_session_id = update.external_session_id.clone();
        }
        if session.tool.is_none() {
            session.tool = update.tool.clone();
        }
        if session.author.is_none() {
            session.author = update.author.as_ref().map(|a| a.as_str().to_owned());
        }
        if session.transcript_prefix.is_none() {
            session.transcript_prefix = update.transcript_prefix.clone();
        }
        if let Some(model) = update.model.as_ref().filter(|m| m.as_str() != "unknown") {
            session.model = Some(model.clone());
        }
        if let Some(first) = update.first_seen {
            session.first_seen = Some(session.first_seen.map_or(first, |f| f.min(first)));
        }
        if let Some(last) = update.last_seen {
            session.last_seen = Some(session.last_seen.map_or(last, |l| l.max(last)));
        }
        session
            .commit_shas
            .extend(update.commit_shas.iter().cloned());
        Ok(created)
    }
}

/// Records every metric.
#[derive(Clone, Default)]
pub(crate) struct RecordedMetrics {
    pub(crate) metrics: Arc<Mutex<Vec<Metric>>>,
}

impl RecordedMetrics {
    pub(crate) fn all(&self) -> Vec<Metric> {
        self.metrics.lock().unwrap().clone()
    }
}

impl IngestMetrics for RecordedMetrics {
    fn record(&self, metric: Metric) {
        self.metrics.lock().unwrap().push(metric);
    }
}

pub(crate) type TestService = GitaiService<MemoryObjects, MemoryIndex, RecordedMetrics>;

/// A service on fresh fakes, and handles to inspect them.
pub(crate) fn service() -> (TestService, MemoryObjects, MemoryIndex, RecordedMetrics) {
    let objects = MemoryObjects::default();
    let index = MemoryIndex::default();
    let metrics = RecordedMetrics::default();
    let service = GitaiService::new(
        objects.clone(),
        index.clone(),
        metrics.clone(),
        SharedKey::new(SHARED_KEY).unwrap(),
    );
    (service, objects, index, metrics)
}

/// A recorded request fixture from `tests/fixtures/client-1.7.7`.
pub(crate) fn fixture(name: &str) -> serde_json::Value {
    let path = format!(
        "{}/tests/fixtures/client-1.7.7/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A fixture's request body as bytes.
pub(crate) fn fixture_body(name: &str) -> Vec<u8> {
    serde_json::to_vec(&fixture(name)["body"]).unwrap()
}
