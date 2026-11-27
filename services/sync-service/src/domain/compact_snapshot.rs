//! The most compact snapshot of a document that is still cheap to export.
//!
//! A Loro shallow snapshot keeps the history above its root, the latest
//! single-head critical version of the document. Exporting one checks the live
//! document out to that root and back, which costs time that grows with the
//! history kept above it, and the Durable Object runs nothing else meanwhile.
//! While a document's frontier has concurrent heads, Loro's search for the root
//! keeps every same-peer predecessor it passes, so in history where peers took
//! turns the root falls to where those peers started: the export then keeps
//! nearly all history, so it is no smaller than a full snapshot, and takes
//! seconds on long-edited documents. A full snapshot is cached and exports in
//! milliseconds, so this module walks the same root search with a budget first
//! and uses a full snapshot when the shallow one would keep more than that.
//! A full snapshot can be much larger than a shallow one when history below the
//! root overwrote a lot of content, so a full snapshot too large for readers
//! gives way to a shallow one that keeps more history, up to a larger budget.
use std::{cmp::Ordering, collections::BinaryHeap};

use loro::{Counter, ExportMode, Frontiers, ID, Lamport, LoroDoc, LoroEncodeError, PeerID};

#[cfg(test)]
mod test;

/// Most operations a shallow export may keep above its root while a full
/// snapshot would do instead. Exporting this many text edits costs tens of
/// milliseconds natively; the checkout's cost grows faster than linearly past
/// it (tens of thousands take seconds).
pub const MAX_SHALLOW_RETAINED_OPS: u32 = 1_000;

/// Largest full snapshot exported in place of a shallow one. Larger bodies
/// stop fitting readers: DSS takes snapshot uploads up to Axum's default 2 MiB
/// body limit, and `/state` answers 413 above 4 MB.
pub const MAX_FULL_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

/// Most operations a shallow export may keep above its root when the full
/// snapshot is larger than [`MAX_FULL_SNAPSHOT_BYTES`]. Exporting this many
/// text edits costs about a third of a second natively.
pub const MAX_SHALLOW_RETAINED_OPS_FOR_LARGE_DOCUMENTS: u32 = 4_000;

/// Which snapshot [`export`] wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactExport {
    /// A shallow snapshot that keeps `retained_ops` operations above its root.
    Shallow { retained_ops: u32 },
    /// A full snapshot: a shallow one would keep so much history that it would
    /// be slow to export, and usually about as large.
    Full,
}

impl CompactExport {
    fn as_str(self) -> &'static str {
        match self {
            Self::Shallow { .. } => "shallow",
            Self::Full => "full",
        }
    }
}

/// Export `doc` as a shallow snapshot when that is cheap, otherwise as a full
/// one. Both import to the same state and version; readers must not rely on
/// the result being shallow.
pub fn export(
    doc: &LoroDoc,
    document_id: &str,
) -> Result<(Vec<u8>, CompactExport), LoroEncodeError> {
    let span = tracing::info_span!(
        "document.compact_snapshot",
        document.id = document_id,
        snapshot.mode = tracing::field::Empty,
        snapshot.retained_ops = tracing::field::Empty,
        snapshot.bytes = tracing::field::Empty,
        loro.ops = history_len(doc),
        loro.heads = doc.oplog_frontiers().len(),
    );
    let _entered = span.enter();
    let exported = export_within(doc).inspect_err(|error| {
        tracing::error!(error = ?error, "failed to export compact snapshot");
    })?;
    let (snapshot, choice) = &exported;
    span.record("snapshot.mode", choice.as_str());
    if let CompactExport::Shallow { retained_ops } = choice {
        span.record("snapshot.retained_ops", retained_ops);
    }
    span.record("snapshot.bytes", snapshot.len());
    Ok(exported)
}

fn export_within(doc: &LoroDoc) -> Result<(Vec<u8>, CompactExport), LoroEncodeError> {
    let retained = retained_ops(doc, MAX_SHALLOW_RETAINED_OPS_FOR_LARGE_DOCUMENTS);
    if let Some(retained_ops) = retained.filter(|ops| *ops <= MAX_SHALLOW_RETAINED_OPS) {
        return Ok((shallow(doc)?, CompactExport::Shallow { retained_ops }));
    }
    let full = doc.export(ExportMode::Snapshot)?;
    match retained {
        Some(retained_ops) if full.len() > MAX_FULL_SNAPSHOT_BYTES => {
            Ok((shallow(doc)?, CompactExport::Shallow { retained_ops }))
        }
        _ => Ok((full, CompactExport::Full)),
    }
}

fn shallow(doc: &LoroDoc) -> Result<Vec<u8>, LoroEncodeError> {
    doc.export(ExportMode::shallow_snapshot_owned(doc.state_frontiers()))
}

/// Operations a shallow export of `doc` would keep, or `None` when that is
/// more than `budget` or unknown.
fn retained_ops(doc: &LoroDoc, budget: u32) -> Option<u32> {
    let state = doc.state_frontiers();
    let oplog = doc.oplog_frontiers();
    match retained_ops_above_root(doc, &state, &oplog, budget) {
        Ok(Search::Root { retained_ops }) => Some(retained_ops),
        // Loro then keeps every operation since the document's own start (or
        // its shallow root, if it has one).
        Ok(Search::NoRoot) => u32::try_from(history_len(doc))
            .ok()
            .filter(|ops| *ops <= budget),
        Ok(Search::OverBudget) | Err(WalkFailed) => None,
    }
}

/// Operations in the document's history, from its start or its shallow root.
fn history_len(doc: &LoroDoc) -> u64 {
    let since = doc.shallow_since_vv().to_vv();
    doc.oplog_vv()
        .iter()
        .map(|(peer, end)| {
            let start = since.get(peer).copied().unwrap_or(0);
            u64::try_from(end.saturating_sub(start)).unwrap_or(0)
        })
        .sum()
}

#[derive(Debug, PartialEq, Eq)]
enum Search {
    /// The root was found with `retained_ops` operations above it.
    Root { retained_ops: u32 },
    /// A chain of history ended before the search narrowed to one change, so
    /// there is no single-head root.
    NoRoot,
    /// The root is further down than the budget allows.
    OverBudget,
}

/// The history could not be read, or did not have the shape Loro guarantees.
#[derive(Debug)]
struct WalkFailed;

/// The ops of one change from its first op through `last`.
#[derive(Debug)]
struct ChangeRun {
    peer: PeerID,
    start: Counter,
    last: Counter,
    /// Lamport timestamp of the change's first op.
    lamport: Lamport,
    /// The change's explicit dependencies.
    deps: Frontiers,
}

impl ChangeRun {
    /// The run from the first op of the change holding `id` through `id`.
    /// `None` when the change is missing, e.g. below a shallow root.
    fn through(doc: &LoroDoc, id: ID) -> Result<Option<Self>, WalkFailed> {
        let Some(change) = doc.try_get_change(id).map_err(|_| WalkFailed)? else {
            return Ok(None);
        };
        if change.id.peer != id.peer || change.id.counter > id.counter {
            return Err(WalkFailed);
        }
        Ok(Some(Self {
            peer: id.peer,
            start: change.id.counter,
            last: id.counter,
            lamport: change.lamport,
            deps: change.deps,
        }))
    }

    fn len(&self) -> u32 {
        u32::try_from(i64::from(self.last) - i64::from(self.start) + 1).unwrap_or(u32::MAX)
    }

    fn last_id(&self) -> ID {
        ID::new(self.peer, self.last)
    }

    fn lamport_last(&self) -> u64 {
        u64::from(self.lamport) + u64::from(self.len()) - 1
    }

    fn contains(&self, id: ID) -> bool {
        id.peer == self.peer && self.start <= id.counter && id.counter <= self.last
    }
}

// Loro's ordering: the latest op first, then the higher peer; of two runs that
// end at the same op, the shorter one first.
impl Ord for ChangeRun {
    fn cmp(&self, other: &Self) -> Ordering {
        self.lamport_last()
            .cmp(&other.lamport_last())
            .then(self.peer.cmp(&other.peer))
            .then(other.len().cmp(&self.len()))
    }
}

impl PartialOrd for ChangeRun {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for ChangeRun {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}

impl Eq for ChangeRun {}

/// Count the operations above the root Loro picks for a shallow snapshot
/// from `state` that keeps history through `oplog`
/// (`latest_single_head_critical_version` in loro-internal's `dag.rs`). Like
/// Loro, it descends from both frontiers in a heap of change runs ordered by
/// their latest op and stops when the heap narrows to one run; every op it
/// passes on the way down is kept by the export. It mirrors Loro's walk,
/// including adding a change's same-peer predecessor even when another
/// pending run already descends from it, because that is what decides how
/// deep the real export goes. Stops once more than `budget` ops are passed.
fn retained_ops_above_root(
    doc: &LoroDoc,
    state: &Frontiers,
    oplog: &Frontiers,
    budget: u32,
) -> Result<Search, WalkFailed> {
    let mut queue = BinaryHeap::new();
    for id in state.iter().chain(oplog.iter()) {
        let Some(run) = ChangeRun::through(doc, id)? else {
            return Ok(Search::NoRoot);
        };
        queue.push(run);
    }
    let mut passed: u32 = 0;
    while let Some(mut run) = queue.pop() {
        while queue
            .peek()
            .is_some_and(|other| other.last_id() == run.last_id())
        {
            queue.pop();
        }
        let Some(other) = queue.peek() else {
            return Ok(Search::Root {
                retained_ops: passed,
            });
        };
        // Trim the run down to where the next run ends, or below the next
        // run's latest op, so the heap keeps descending in Lamport order.
        let trimmed_last = if run.contains(other.last_id()) {
            Some(other.last)
        } else if run.len() > 1 {
            let other_last = other.lamport_last();
            let keep = if other_last >= u64::from(run.lamport) {
                (other_last - u64::from(run.lamport) + 1).min(u64::from(run.len()) - 1)
            } else {
                1
            };
            let keep = i64::try_from(keep).map_err(|_| WalkFailed)?;
            Some(Counter::try_from(i64::from(run.start) + keep - 1).map_err(|_| WalkFailed)?)
        } else {
            None
        };
        if let Some(last) = trimmed_last {
            if last >= run.last || last < run.start {
                return Err(WalkFailed);
            }
            passed = passed.saturating_add(
                u32::try_from(i64::from(run.last) - i64::from(last)).map_err(|_| WalkFailed)?,
            );
            if passed > budget {
                return Ok(Search::OverBudget);
            }
            run.last = last;
            queue.push(run);
            continue;
        }
        // One op left: step below it to the change's dependencies.
        passed = passed.saturating_add(1);
        if passed > budget {
            return Ok(Search::OverBudget);
        }
        let mut deps = Vec::with_capacity(run.deps.len() + 1);
        for id in run.deps.iter() {
            let Some(dep) = ChangeRun::through(doc, id)? else {
                return Ok(Search::NoRoot);
            };
            deps.push(dep);
        }
        // Loro also adds the op before the change on the same peer, skipping
        // it only when it is missing or inside one of the explicit runs.
        if run.start > 0 {
            let previous = ID::new(run.peer, run.start - 1);
            if !deps.iter().any(|dep| dep.contains(previous))
                && let Some(dep) = ChangeRun::through(doc, previous)?
            {
                deps.push(dep);
            }
        }
        if deps.is_empty() {
            return Ok(Search::NoRoot);
        }
        queue.extend(deps);
    }
    // Both frontiers are empty: Loro finds no root and keeps all history.
    Ok(Search::NoRoot)
}
