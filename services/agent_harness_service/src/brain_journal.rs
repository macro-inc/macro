//! Per-agent journal read and observation contracts for the local signed reader.

use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod inbound;
#[cfg(feature = "local-signed-brain-read")]
mod local;
mod pg;
mod signed;
mod signed_inbound;
#[cfg(test)]
mod test;

#[cfg(feature = "local-signed-brain-read")]
pub use local::run_local_signed_brain_read;

const MAX_OBSERVATIONS_PER_AGENT: usize = 100;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct Scope {
    team: Uuid,
    agent: MacroUserIdStr<'static>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Source {
    Document { id: Uuid },
}

/// A trusted producer supplies stable source identity and explicit completed-work
/// evidence. There is no HTTP write or attempt access in this proof.
#[derive(Clone, Debug, PartialEq, Eq)]
struct CompletedWork {
    source_event: Uuid,
    source: Source,
    completed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalEntry {
    id: Uuid,
    source: Source,
    completed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct JournalView {
    completed: Vec<JournalEntry>,
}

#[derive(Debug, PartialEq, Eq)]
enum Observed {
    Recorded,
    Replay,
}

#[derive(Debug, PartialEq, Eq)]
enum ObserveError {
    ChangedReplay,
    InvalidEvidence,
    Capacity,
}

#[derive(Debug, PartialEq, Eq)]
enum ReadError {
    Unavailable,
    AuthorityFailed,
}

trait Authority: Send + Sync {
    fn can_read(
        &self,
        viewer: &MacroUserIdStr<'static>,
        scope: &Scope,
    ) -> impl Future<Output = Result<bool, ReadError>> + Send;

    fn visible_documents(
        &self,
        viewer: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<HashSet<Uuid>, ReadError>> + Send;
}

#[derive(Default)]
struct Journal {
    observations: Mutex<HashMap<Scope, HashMap<Uuid, CompletedWork>>>,
}

impl Journal {
    fn observe(&self, scope: Scope, work: CompletedWork) -> Result<Observed, ObserveError> {
        let Source::Document { id } = work.source;
        if scope.team.is_nil() || work.source_event.is_nil() || id.is_nil() {
            return Err(ObserveError::InvalidEvidence);
        }

        let mut observations = self.observations.lock().expect("proof journal lock");
        let entries = observations.entry(scope).or_default();

        if let Some(recorded) = entries.get(&work.source_event) {
            return if *recorded == work {
                Ok(Observed::Replay)
            } else {
                Err(ObserveError::ChangedReplay)
            };
        }
        if entries.len() >= MAX_OBSERVATIONS_PER_AGENT {
            return Err(ObserveError::Capacity);
        }

        entries.insert(work.source_event, work);
        Ok(Observed::Recorded)
    }

    async fn read(
        &self,
        authority: &impl Authority,
        viewer: &MacroUserIdStr<'static>,
        scope: &Scope,
    ) -> Result<JournalView, ReadError> {
        if !authority.can_read(viewer, scope).await? {
            return Err(ReadError::Unavailable);
        }

        let mut work: Vec<_> = self
            .observations
            .lock()
            .expect("proof journal lock")
            .get(scope)
            .into_iter()
            .flat_map(|entries| entries.values().cloned())
            .collect();
        if work.is_empty() {
            return Ok(JournalView {
                completed: Vec::new(),
            });
        }

        let ids: Vec<_> = work
            .iter()
            .map(|entry| match entry.source {
                Source::Document { id } => id,
            })
            .collect();
        let visible = authority.visible_documents(viewer, &ids).await?;
        if !authority.can_read(viewer, scope).await? {
            return Err(ReadError::Unavailable);
        }

        work.sort_unstable_by_key(|entry| (entry.completed_at, entry.source_event));
        let completed = work
            .into_iter()
            .filter(|entry| match entry.source {
                Source::Document { id } => visible.contains(&id),
            })
            .map(|entry| JournalEntry {
                id: entry.source_event,
                source: entry.source,
                completed_at: entry.completed_at,
            })
            .collect();
        Ok(JournalView { completed })
    }
}
