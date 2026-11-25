//! Background query writes that a foreground write got ahead of.
//!
//! The webview persists a query response without anyone waiting for it, and
//! that response may have been fetched before a mutation the server has since
//! applied. The webview drops such a response itself when it has heard of the
//! mutation, but it hears only once the commit has settled, and another window
//! sharing this engine does not hear in time at all. Background writes also
//! let commands that queue after them go first (`access`), so any foreground
//! write may land before a response that was fetched before it. A background
//! write whose turn comes after a foreground write would put back the older
//! value of a field that write stored, so it is refused instead and the
//! webview fetches the query again. A write that holds other records, other
//! fields of them, or the values the foreground write stored lands.

use cache_core::normalize::RecordUpdates;
use cache_core::page_retention::PAGE_ORDER_FIELD;
use cache_core::value::{EntityKey, Record};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::SeqCst};

/// The refusal the webview recognizes; it fetches the query again. The webview
/// matches its first words, kept although the write that went ahead may be any
/// foreground write.
pub(super) const SUPERSEDED: &str =
    "graphql cache write superseded by a committed mutation; fetch the query again";

/// Most foreground changes remembered for background writes still waiting. A
/// write that waited longer than this many is refused whatever it holds.
const KEPT: usize = 256;

/// Shared by every handle of one engine, read without its lock.
#[derive(Default)]
pub(super) struct Commits {
    /// Foreground changes settled so far.
    settled: AtomicU64,
    /// Background writes that arrived and have not finished.
    waiting: AtomicUsize,
}

/// What foreground commands changed, kept under the engine lock while
/// background writes wait.
#[derive(Default)]
pub(super) struct CommitLog {
    entries: VecDeque<Entry>,
    /// The last change forgotten to keep the log at [`KEPT`].
    forgotten_through: u64,
}

struct Entry {
    seq: u64,
    change: Change,
}

/// What a foreground write stored, by record: the fields it stored with their
/// values, or `None` for a record whose fields it cannot name, which counts as
/// every field with any value.
pub(super) type Stored = BTreeMap<EntityKey<'static>, Option<Record>>;

enum Change {
    /// What a write stored, or `None` when it cannot name the records: it
    /// counts as every record.
    Stored(Option<Stored>),
    /// An operation torn down: a background write must not register it again.
    TornDown(String),
}

/// A background write from its arrival until it finishes.
pub(super) struct Arrival<'a> {
    commits: &'a Commits,
    /// Foreground changes settled before it arrived.
    after: u64,
}

impl Commits {
    /// Call before the write waits for the engine.
    pub(super) fn arrive(&self) -> Arrival<'_> {
        // Counted before reading `settled`, and a change counts itself before
        // reading `waiting`: one of the two sees the other, so a change this
        // write did not see before arriving is always logged.
        self.waiting.fetch_add(1, SeqCst);
        Arrival {
            commits: self,
            after: self.settled.load(SeqCst),
        }
    }

    /// Whether a background write waits, so a foreground write should name
    /// what it stores. One that arrives after this still finds the write, as
    /// every record when it went unnamed.
    pub(super) fn watched(&self) -> bool {
        self.waiting.load(SeqCst) > 0
    }

    /// Call under the engine lock once a foreground write has stored its
    /// records. `stored` names them, or `None` for every record; it runs only
    /// while a background write waits.
    pub(super) fn settle(&self, log: &mut CommitLog, stored: impl FnOnce() -> Option<Stored>) {
        self.log(log, || Change::Stored(stored()));
    }

    /// Call under the engine lock once operation `op_id` is torn down.
    pub(super) fn tear_down(&self, log: &mut CommitLog, op_id: &str) {
        self.log(log, || Change::TornDown(op_id.to_owned()));
    }

    fn log(&self, log: &mut CommitLog, change: impl FnOnce() -> Change) {
        let seq = self.settled.fetch_add(1, SeqCst) + 1;
        if self.waiting.load(SeqCst) == 0 {
            // Every later arrival sees this change already settled.
            log.entries.clear();
            return;
        }
        if log.entries.len() == KEPT
            && let Some(forgotten) = log.entries.pop_front()
        {
            log.forgotten_through = forgotten.seq;
        }
        log.entries.push_back(Entry {
            seq,
            change: change(),
        });
    }
}

impl Arrival<'_> {
    /// Whether a foreground write settled since this write arrived stored a
    /// field this write holds a different value for. Unknown `records` (a
    /// response that did not normalize) count as every record.
    pub(super) fn overtaken(&self, log: &CommitLog, records: Option<&RecordUpdates>) -> bool {
        self.after < log.forgotten_through
            || self.since(log).any(|change| match (change, records) {
                (Change::Stored(Some(stored)), Some(records)) => {
                    stored.iter().any(|(key, stored)| {
                        records
                            .get(key)
                            .is_some_and(|record| differs(stored.as_ref(), record))
                    })
                }
                (Change::Stored(_), _) => true,
                (Change::TornDown(_), _) => false,
            })
    }

    /// Whether operation `op_id` was torn down since this write arrived. A
    /// write [`Self::overtaken`] refuses may answer either way.
    pub(super) fn torn_down(&self, log: &CommitLog, op_id: &str) -> bool {
        self.since(log)
            .any(|change| matches!(change, Change::TornDown(torn) if torn == op_id))
    }

    fn since<'a>(&self, log: &'a CommitLog) -> impl Iterator<Item = &'a Change> {
        let after = self.after;
        log.entries
            .iter()
            .filter(move |entry| entry.seq > after)
            .map(|entry| &entry.change)
    }
}

/// Whether `record` would put back a value other than what a foreground write
/// stored. Fields it did not store do not count, nor the page order, which a
/// merge never takes from an incoming record.
fn differs(stored: Option<&Record>, record: &Record) -> bool {
    let Some(stored) = stored else {
        return true;
    };
    record.fields.iter().any(|(field, value)| {
        field != PAGE_ORDER_FIELD
            && stored
                .fields
                .get(field)
                .is_some_and(|stored| stored != value)
    })
}

impl Drop for Arrival<'_> {
    fn drop(&mut self) {
        self.commits.waiting.fetch_sub(1, SeqCst);
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn key(name: &str) -> EntityKey<'static> {
        EntityKey(name.to_owned().into())
    }

    /// Every field of each record.
    fn keys(names: &[&str]) -> Stored {
        names.iter().map(|name| (key(name), None)).collect()
    }

    fn records(names: &[&str]) -> RecordUpdates {
        names
            .iter()
            .map(|name| (key(name), Record::default()))
            .collect()
    }

    fn record(fields: &[(&str, &str)]) -> Record {
        Record {
            fields: fields
                .iter()
                .map(|(field, value)| {
                    (
                        (*field).to_owned(),
                        cache_core::value::CacheValue::String((*value).to_owned()),
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn only_a_later_commit_to_the_same_records_overtakes_a_write() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        commits.settle(&mut log, || Some(keys(&["Doc:1"])));
        let write = commits.arrive();
        let written = records(&["Doc:1", "Doc:2"]);
        assert!(
            !write.overtaken(&log, Some(&written)),
            "settled before it arrived"
        );
        commits.settle(&mut log, || Some(keys(&["Doc:3"])));
        assert!(!write.overtaken(&log, Some(&written)), "other records");
        assert!(write.overtaken(&log, None), "unknown records");
        commits.settle(&mut log, || Some(keys(&["Doc:2"])));
        assert!(write.overtaken(&log, Some(&written)));
    }

    #[test]
    fn only_a_different_value_for_a_stored_field_overtakes_a_write() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        let write = commits.arrive();
        commits.settle(&mut log, || {
            Some(Stored::from([(
                key("Doc:1"),
                Some(record(&[
                    ("id", "1"),
                    ("name", "Renamed"),
                    (PAGE_ORDER_FIELD, "1"),
                ])),
            )]))
        });
        let holding =
            |fields: &[(&str, &str)]| RecordUpdates::from([(key("Doc:1"), record(fields))]);
        assert!(
            !write.overtaken(&log, Some(&holding(&[("id", "1"), ("name", "Renamed")]))),
            "the values it stored"
        );
        assert!(
            !write.overtaken(&log, Some(&holding(&[("id", "1"), ("title", "Other")]))),
            "a field it did not store"
        );
        assert!(
            !write.overtaken(&log, Some(&holding(&[(PAGE_ORDER_FIELD, "2")]))),
            "the page order, which a merge never takes"
        );
        assert!(write.overtaken(&log, Some(&holding(&[("id", "1"), ("name", "Old")]))));
    }

    #[test]
    fn a_write_that_names_no_records_overtakes_every_write() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        let write = commits.arrive();
        assert!(commits.watched());
        commits.settle(&mut log, || None);
        assert!(write.overtaken(&log, Some(&records(&["Doc:1"]))));
        drop(write);
        assert!(!commits.watched());
    }

    #[test]
    fn a_teardown_since_arrival_is_seen_and_overtakes_nothing() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        commits.tear_down(&mut log, "op:before");
        let write = commits.arrive();
        commits.tear_down(&mut log, "op:1");
        assert!(write.torn_down(&log, "op:1"));
        assert!(!write.torn_down(&log, "op:2"));
        assert!(
            !write.torn_down(&log, "op:before"),
            "torn down before it arrived"
        );
        assert!(!write.overtaken(&log, Some(&records(&["Doc:1"]))));
    }

    #[test]
    fn a_write_older_than_the_log_is_overtaken() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        let write = commits.arrive();
        for _ in 0..=KEPT {
            commits.settle(&mut log, || Some(keys(&["Doc:other"])));
        }
        assert_eq!(log.entries.len(), KEPT);
        assert!(write.overtaken(&log, Some(&records(&["Doc:1"]))));
    }

    #[test]
    fn commits_with_nothing_waiting_are_not_kept() {
        let commits = Commits::default();
        let mut log = CommitLog::default();
        commits.settle(&mut log, || Some(keys(&["Doc:1"])));
        assert!(log.entries.is_empty());
        let write = commits.arrive();
        commits.settle(&mut log, || Some(keys(&["Doc:1"])));
        assert_eq!(log.entries.len(), 1);
        drop(write);
        commits.settle(&mut log, || Some(keys(&["Doc:1"])));
        assert!(log.entries.is_empty());
    }
}
