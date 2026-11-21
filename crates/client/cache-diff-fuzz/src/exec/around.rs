//! Work around a hydrate: staging it ahead of the op before it (as the
//! browser host does), and reads from other threads while it runs.

use super::Exec;
#[cfg(staged_hydrate)]
use super::HydrateRequest;
use crate::host::engine::EngineHandle;
#[cfg(staged_hydrate)]
use crate::sequence::Op;
use serde_json::{Value, json};
use std::time::Instant;

impl Exec<'_> {
    /// Stages the hydrate at `index` before the op ahead of it runs, as the
    /// browser host's `prepareHydrate` and `stageHydrate` would, so that op
    /// (a write, a clear, an account switch, an authority change, another
    /// hydrate) lands between the stage and the commit. The commit must then
    /// answer as the hydrate would have, issued after that op: the other
    /// side runs the case as it is.
    #[cfg(staged_hydrate)]
    pub(super) async fn stage_ahead(&mut self, index: usize, op: &Op) {
        let Op::Hydrate {
            doc,
            variables,
            data,
            identity,
            contacts,
            ..
        } = op
        else {
            return;
        };
        let current = std::mem::replace(&mut self.identity, identity.clone());
        let staged = self.stage(doc, variables, data, *contacts).await;
        self.identity = current;
        match staged {
            Ok(staged) => {
                self.count(match (staged.error.is_some(), staged.staged()) {
                    (true, _) => "stage.failed",
                    (false, true) => "stage.staged",
                    (false, false) => "stage.whole",
                });
                self.staged.push((index, staged));
            }
            // Counted by the step that refused, so a storage error at the
            // snapshot shows apart from an authority or fence the op ahead
            // had not set up yet. The hydrate runs whole at its turn either way.
            Err(step) => self.count(step),
        }
    }

    #[cfg(staged_hydrate)]
    async fn stage(
        &self,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
        data: &Value,
        contacts: bool,
    ) -> Result<crate::host::engine::fuzz_hooks::FuzzStagedHydrate, &'static str> {
        let handle = self
            .stamped()
            .await
            .map_err(|_| "stage.refused.authority")?;
        let scope = match contacts {
            true => Some(self.scope(true).await.map_err(|_| "stage.refused.fence")?),
            false => None,
        };
        let query = self.doc(doc).map_err(|_| "stage.refused.document")?;
        handle
            .fuzz_stage_hydrate(HydrateRequest {
                query: &query,
                operation_name: Some(doc),
                variables,
                data,
                identity: Some(&self.identity),
                scope: scope.as_ref(),
            })
            .await
            .map_err(|_| "stage.refused.snapshot")
    }

    /// Whether the hydrate at `index` runs with reads issued while it runs.
    pub(super) fn split_due(&self, index: usize) -> bool {
        self.concurrent_reads > 0.0
            && ((crate::rng::mix(index as u64, "split") % 1_000) as f64)
                < self.concurrent_reads * 1_000.0
    }

    /// What reads around a hydrate compare: the hydrated query itself and a
    /// people-and-documents search.
    pub(super) async fn split_reads(
        &self,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
    ) -> Result<Vec<Value>, String> {
        let reads = split_reads(
            self.handle().clone(),
            self.doc(doc)?,
            doc.to_owned(),
            variables.clone(),
        )
        .await;
        Ok(reads.into_iter().map(|(_, read)| read).collect())
    }

    /// The same reads, issued from other threads a few milliseconds apart
    /// while the hydrate runs on this one.
    pub(super) fn spawn_split_reads(
        &self,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
    ) -> Vec<tokio::task::JoinHandle<Vec<(Instant, Value)>>> {
        let Ok(query) = self.doc(doc) else {
            return Vec::new();
        };
        [0, 1, 2, 5]
            .into_iter()
            .map(|delay| {
                let (handle, query, doc, variables) = (
                    self.handle().clone(),
                    query.clone(),
                    doc.to_owned(),
                    variables.clone(),
                );
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    split_reads(handle, query, doc, variables).await
                })
            })
            .collect()
    }

    /// Every read issued before the hydrate returned (at `returned`) must
    /// answer as the state before it or after it, never anything between,
    /// and every read issued after it returned as the state after it:
    /// otherwise the seed fails. Timers don't make reads overlap, so stats
    /// count the reads issued while it ran (`split.issued-during`).
    pub(super) async fn check_split(
        &mut self,
        index: usize,
        doc: &str,
        variables: &serde_json::Map<String, Value>,
        before: Vec<Value>,
        during: Vec<tokio::task::JoinHandle<Vec<(Instant, Value)>>>,
        returned: Instant,
    ) -> Result<(), String> {
        let mut answers = Vec::new();
        for read in during {
            answers.push(read.await.map_err(|error| error.to_string())?);
        }
        let after = self.split_reads(doc, variables).await?;
        self.count("split");
        for reads in answers {
            for (at, (issued, read)) in reads.iter().enumerate() {
                let late = *issued >= returned;
                self.count(match late {
                    true => "split.issued-after",
                    false => "split.issued-during",
                });
                match (read == &before[at], read == &after[at]) {
                    (true, false) if !late => self.count("split.read-before"),
                    (false, true) => self.count("split.read-after"),
                    (true, true) => self.count("split.read-unchanged"),
                    (true, false) => {
                        return Err(format!(
                            "op {index}: a read issued after the hydrate returned answered as before it: {}",
                            serde_json::to_string(read).unwrap_or_default()
                        ));
                    }
                    (false, false) => {
                        return Err(format!(
                            "op {index}: a read during the hydrate answered neither as before nor as after it: {}",
                            serde_json::to_string(read).unwrap_or_default()
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

/// The reads [`Exec::split_reads`] describes, each as the instant it was
/// issued and its answer or its error.
async fn split_reads(
    handle: EngineHandle,
    query: String,
    doc: String,
    variables: serde_json::Map<String, Value>,
) -> Vec<(Instant, Value)> {
    let read_at = Instant::now();
    let read = handle
        .read(None, query, Some(doc), variables, vec![])
        .await
        .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()));
    let search_at = Instant::now();
    let search = match serde_json::from_value(crate::probe::searches()[0].clone()) {
        Ok(request) => handle
            .search(request)
            .await
            .and_then(|page| serde_json::to_value(page).map_err(|error| error.to_string())),
        Err(error) => Err(error.to_string()),
    };
    [(read_at, read), (search_at, search)]
        .into_iter()
        .map(|(at, outcome)| {
            (
                at,
                outcome.unwrap_or_else(|error| json!({ "error": error })),
            )
        })
        .collect()
}
