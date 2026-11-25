//! Background query writes that a mutation commit got ahead of.
//!
//! The webview persists a query response without anyone waiting for it, and
//! that response may have been fetched before a mutation the server has since
//! applied. The webview drops such a response itself when it has heard of the
//! mutation, but it hears only once the commit has settled, and another window
//! sharing this engine does not hear in time at all. A background write whose
//! turn comes after a commit that changed one of its records would put the
//! older record back, so the write is refused instead and the webview fetches
//! the query again. A write for other records lands.

use cache_core::normalize::RecordUpdates;
use cache_core::value::EntityKey;
use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::SeqCst};

/// The refusal the webview recognizes; it fetches the query again.
pub(super) const SUPERSEDED: &str =
    "graphql cache write superseded by a committed mutation; fetch the query again";

/// Most commits remembered for background writes still waiting. A write that
/// waited longer than this many commits is refused whatever it holds.
const KEPT: usize = 256;

/// Shared by every handle of one engine, read without its lock.
#[derive(Default)]
pub(super) struct Commits {
    /// Commits settled so far.
    settled: AtomicU64,
    /// Background writes that arrived and have not finished.
    waiting: AtomicUsize,
}

/// What commits changed, kept under the engine lock while background writes
/// wait.
#[derive(Default)]
pub(super) struct CommitLog {
    entries: VecDeque<Commit>,
    /// The last commit forgotten to keep the log at [`KEPT`].
    forgotten_through: u64,
}

struct Commit {
    seq: u64,
    changed: BTreeSet<EntityKey<'static>>,
}

/// A background write from its arrival until it finishes.
pub(super) struct Arrival<'a> {
    commits: &'a Commits,
    /// Commits settled before it arrived.
    after: u64,
}

impl Commits {
    /// Call before the write waits for the engine.
    pub(super) fn arrive(&self) -> Arrival<'_> {
        // Counted before reading `settled`, and a commit counts itself before
        // reading `waiting`: one of the two sees the other, so a commit this
        // write did not see before arriving is always logged.
        self.waiting.fetch_add(1, SeqCst);
        Arrival {
            commits: self,
            after: self.settled.load(SeqCst),
        }
    }

    /// Call under the engine lock once a commit has stored its records.
    /// `stored` names them; it runs only while a background write waits.
    pub(super) fn settle(
        &self,
        log: &mut CommitLog,
        stored: impl FnOnce() -> BTreeSet<EntityKey<'static>>,
    ) {
        let seq = self.settled.fetch_add(1, SeqCst) + 1;
        if self.waiting.load(SeqCst) == 0 {
            // Every later arrival sees this commit already settled.
            log.entries.clear();
            return;
        }
        if log.entries.len() == KEPT
            && let Some(forgotten) = log.entries.pop_front()
        {
            log.forgotten_through = forgotten.seq;
        }
        log.entries.push_back(Commit {
            seq,
            changed: stored(),
        });
    }
}

impl Arrival<'_> {
    /// Whether a commit settled since this write arrived changed a record it
    /// writes. Unknown `records` (a response that did not normalize) count as
    /// every record.
    pub(super) fn overtaken(&self, log: &CommitLog, records: Option<&RecordUpdates>) -> bool {
        if self.after < log.forgotten_through {
            return true;
        }
        log.entries
            .iter()
            .filter(|commit| commit.seq > self.after)
            .any(|commit| {
                records.is_none_or(|records| {
                    commit.changed.iter().any(|key| records.contains_key(key))
                })
            })
    }
}

impl Drop for Arrival<'_> {
    fn drop(&mut self) {
        self.commits.waiting.fetch_sub(1, SeqCst);
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn keys(names: &[&str]) -> BTreeSet<EntityKey<'static>> {
        names
            .iter()
            .map(|name| EntityKey((*name).to_owned().into()))
            .collect()
    }

    fn records(names: &[&str]) -> RecordUpdates {
        keys(names)
            .into_iter()
            .map(|key| (key, Default::default()))
            .collect()
    }

    #[test]
    fn only_a_later_commit_to_the_same_records_overtakes_a_write() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        commits.settle(&mut log, || keys(&["Doc:1"]));
        let write = commits.arrive();
        let written = records(&["Doc:1", "Doc:2"]);
        assert!(
            !write.overtaken(&log, Some(&written)),
            "settled before it arrived"
        );
        commits.settle(&mut log, || keys(&["Doc:3"]));
        assert!(!write.overtaken(&log, Some(&written)), "other records");
        assert!(write.overtaken(&log, None), "unknown records");
        commits.settle(&mut log, || keys(&["Doc:2"]));
        assert!(write.overtaken(&log, Some(&written)));
    }

    #[test]
    fn a_write_older_than_the_log_is_overtaken() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        let write = commits.arrive();
        for _ in 0..=KEPT {
            commits.settle(&mut log, || keys(&["Doc:other"]));
        }
        assert_eq!(log.entries.len(), KEPT);
        assert!(write.overtaken(&log, Some(&records(&["Doc:1"]))));
    }

    #[test]
    fn commits_with_nothing_waiting_are_not_kept() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        commits.settle(&mut log, || keys(&["Doc:1"]));
        assert!(log.entries.is_empty());
        let write = commits.arrive();
        commits.settle(&mut log, || keys(&["Doc:1"]));
        assert_eq!(log.entries.len(), 1);
        drop(write);
        commits.settle(&mut log, || keys(&["Doc:1"]));
        assert!(log.entries.is_empty());
    }
}
