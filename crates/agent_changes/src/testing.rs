//! In-memory implementations of the changes ports, for tests here and in the
//! crates that plug extractors into this one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSession;
use chrono::{DateTime, Utc};

use crate::domain::error::ExtractError;
use crate::domain::model::{
    AgentSessionId, AttemptOutcome, CaptureAttempt, Changeset, ExtractedChangeset, SessionChanges,
};
use crate::domain::ports::{ChangesetBlobStore, ChangesetExtractor, ChangesetRepo, PatchBlobKey};

/// An extractor that answers with whatever it was last told to, and counts
/// how often it was asked.
#[derive(Clone, Default)]
pub struct ScriptedExtractor {
    state: Arc<Mutex<ScriptedState>>,
}

#[derive(Default)]
struct ScriptedState {
    answer: Option<Result<ExtractedChangeset, String>>,
    not_ready: Option<String>,
    calls: usize,
}

impl ScriptedExtractor {
    /// Answer every extraction with `changeset`.
    #[must_use]
    pub fn returning(changeset: ExtractedChangeset) -> Self {
        let this = Self::default();
        this.set(changeset);
        this
    }

    /// An extractor whose linked PR is unavailable.
    #[must_use]
    pub fn not_ready(reason: &str) -> Self {
        let this = Self::default();
        this.state.lock().expect("scripted state").not_ready = Some(reason.to_owned());
        this
    }

    /// An extractor that fails with `message`.
    #[must_use]
    pub fn failing(message: &str) -> Self {
        let this = Self::default();
        this.state.lock().expect("scripted state").answer = Some(Err(message.to_owned()));
        this
    }

    /// Change what later extractions answer.
    pub fn set(&self, changeset: ExtractedChangeset) {
        self.state.lock().expect("scripted state").answer = Some(Ok(changeset));
    }

    /// How many extractions were asked for.
    #[must_use]
    pub fn calls(&self) -> usize {
        self.state.lock().expect("scripted state").calls
    }
}

impl ChangesetExtractor for ScriptedExtractor {
    async fn extract(&self, _session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        let mut state = self.state.lock().expect("scripted state");
        state.calls += 1;
        if let Some(reason) = &state.not_ready {
            return Err(ExtractError::NotReady(reason.clone()));
        }
        match state.answer.clone() {
            Some(Ok(changeset)) => Ok(changeset),
            Some(Err(message)) => Err(ExtractError::Failed(rootcause::report!("{message}"))),
            None => Err(ExtractError::Failed(rootcause::report!(
                "the scripted extractor was given no answer"
            ))),
        }
    }
}

#[derive(Default)]
struct MemoryRow {
    changeset: Option<Changeset>,
    patch_key: Option<PatchBlobKey>,
    attempt: Option<CaptureAttempt>,
}

/// An in-memory [`ChangesetRepo`]. Cheap to clone - clones share one store.
#[derive(Clone, Default)]
pub struct MemoryChangesetRepo {
    rows: Arc<Mutex<HashMap<AgentSessionId, MemoryRow>>>,
}

impl MemoryChangesetRepo {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl ChangesetRepo for MemoryChangesetRepo {
    async fn begin_attempt(
        &self,
        session: AgentSessionId,
        started_at: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        let mut rows = self.rows.lock().expect("rows");
        rows.entry(session).or_default().attempt = Some(CaptureAttempt {
            started_at,
            finished_at: None,
            outcome: None,
            error: None,
        });
        Ok(())
    }

    async fn record_changeset(
        &self,
        changeset: &Changeset,
        patch_key: Option<&PatchBlobKey>,
        finished_at: DateTime<Utc>,
    ) -> Result<Option<PatchBlobKey>, rootcause::Report> {
        let mut rows = self.rows.lock().expect("rows");
        let row = rows.entry(changeset.session).or_default();
        let superseded = row.patch_key.take();
        row.changeset = Some(changeset.clone());
        row.patch_key = patch_key.cloned();
        if let Some(attempt) = row.attempt.as_mut() {
            attempt.finished_at = Some(finished_at);
            attempt.outcome = Some(AttemptOutcome::Captured);
            attempt.error = None;
        }
        Ok(superseded)
    }

    async fn record_failure(
        &self,
        session: AgentSessionId,
        outcome: AttemptOutcome,
        error: Option<&str>,
        finished_at: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        let mut rows = self.rows.lock().expect("rows");
        let row = rows.entry(session).or_default();
        if let Some(attempt) = row.attempt.as_mut() {
            attempt.finished_at = Some(finished_at);
            attempt.outcome = Some(outcome);
            attempt.error = error.map(str::to_owned);
        }
        Ok(())
    }

    async fn get(&self, session: AgentSessionId) -> Result<SessionChanges, rootcause::Report> {
        let rows = self.rows.lock().expect("rows");
        Ok(rows
            .get(&session)
            .map(|row| SessionChanges {
                changeset: row.changeset.clone(),
                attempt: row.attempt.clone(),
            })
            .unwrap_or_default())
    }

    async fn patch_key(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<PatchBlobKey>, rootcause::Report> {
        let rows = self.rows.lock().expect("rows");
        Ok(rows.get(&session).and_then(|row| row.patch_key.clone()))
    }
}

/// An in-memory [`ChangesetBlobStore`]. Cheap to clone - clones share one
/// store.
#[derive(Clone, Default)]
pub struct MemoryBlobStore {
    blobs: Arc<Mutex<HashMap<String, String>>>,
}

impl MemoryBlobStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every stored key, sorted.
    #[must_use]
    pub fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.blobs.lock().expect("blobs").keys().cloned().collect();
        keys.sort();
        keys
    }
}

impl ChangesetBlobStore for MemoryBlobStore {
    async fn put_patch(&self, key: &PatchBlobKey, patch: &str) -> Result<(), rootcause::Report> {
        self.blobs
            .lock()
            .expect("blobs")
            .insert(key.as_str().to_owned(), patch.to_owned());
        Ok(())
    }

    async fn get_patch(&self, key: &PatchBlobKey) -> Result<Option<String>, rootcause::Report> {
        Ok(self.blobs.lock().expect("blobs").get(key.as_str()).cloned())
    }

    async fn delete_patch(&self, key: &PatchBlobKey) -> Result<(), rootcause::Report> {
        self.blobs.lock().expect("blobs").remove(key.as_str());
        Ok(())
    }
}
