//! Messages between the review page and the server, over one WebSocket.
//!
//! Both directions are tagged unions, generated into TypeScript, so the page
//! handles them with an exhaustive `match`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use std::collections::{BTreeMap, HashMap};

use crate::model::{
    ActivityItem, Anchor, CodeAnswer, CodeQuery, Diagnostic, FileDiff, History, LanguageServerStatus, Layout, Message, MessageId, Presence,
    Region, ReviewMeta, Revision, ShowRequest, Snapshot, Symbol, Thread, ThreadId,
};

/// Everything the page needs to render a review. It's embedded in the HTML so
/// the page works offline, and sent again when the socket (re)connects from a
/// page without the current revision (otherwise it gets [`LiveState`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub review: ReviewMeta,
    pub snapshot: Snapshot,
    pub threads: Vec<Thread>,
    /// Tests and folds the agent marked.
    pub regions: Vec<Region>,
    /// Who the agent is, and how it grouped and labelled the files.
    pub layout: Layout,
    /// The commits in the review's range.
    pub history: History,
    pub chat: Vec<Message>,
    pub activity: Vec<ActivityItem>,
    pub presence: Presence,
    /// Activity up to this sequence number has been seen by the user.
    pub read_seq: u64,
    /// Language servers' diagnostics, by path (files in the diff and open for context).
    pub diagnostics: BTreeMap<String, Vec<Diagnostic>>,
    /// The language servers running for the review's files.
    pub language_servers: Vec<LanguageServerStatus>,
}

/// [`ReviewState`] without the snapshot: what a page that already has the
/// current revision needs when its socket (re)connects. A big review's
/// snapshot is megabytes, and the page already holds it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub review: ReviewMeta,
    pub threads: Vec<Thread>,
    pub regions: Vec<Region>,
    pub layout: Layout,
    pub history: History,
    pub chat: Vec<Message>,
    pub activity: Vec<ActivityItem>,
    pub presence: Presence,
    pub read_seq: u64,
    pub diagnostics: BTreeMap<String, Vec<Diagnostic>>,
    pub language_servers: Vec<LanguageServerStatus>,
}

impl ReviewState {
    pub fn new(snapshot: Snapshot, live: LiveState) -> Self {
        let LiveState { review, threads, regions, layout, history, chat, activity, presence, read_seq, diagnostics, language_servers } =
            live;
        Self { review, snapshot, threads, regions, layout, history, chat, activity, presence, read_seq, diagnostics, language_servers }
    }
}

/// A revision as changes to the one before it. An agent editing one file of
/// a big review would otherwise resend every file (megabytes) on each save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDelta {
    /// The revision this applies to.
    pub base: Revision,
    pub revision: Revision,
    /// Every file's path, in the new order. Paths not in `files` are the
    /// base's files, unchanged; base files missing here are gone.
    pub paths: Vec<String>,
    /// Files that are new or differ in any way from the base's.
    pub files: Vec<FileDiff>,
    /// The definitions in `files`, with `file` indexing the new order.
    pub symbols: Vec<Symbol>,
}

impl SnapshotDelta {
    /// What changed from `prev` to `next`.
    pub fn between(prev: &Snapshot, next: &Snapshot) -> Self {
        let before: HashMap<&str, &FileDiff> = prev.files.iter().map(|f| (f.path.as_str(), f)).collect();
        let changed: Vec<bool> = next.files.iter().map(|f| before.get(f.path.as_str()) != Some(&f)).collect();
        Self {
            base: prev.revision,
            revision: next.revision,
            paths: next.files.iter().map(|f| f.path.clone()).collect(),
            files: next.files.iter().zip(&changed).filter(|(_, c)| **c).map(|(f, _)| f.clone()).collect(),
            symbols: next.symbols.iter().filter(|s| changed.get(s.file as usize) == Some(&true)).cloned().collect(),
        }
    }

    /// The new snapshot, from `prev` (which must be the base revision).
    /// `None` when `prev` is some other revision, or doesn't have a file the
    /// delta counts on.
    ///
    /// The page applies deltas itself (`applyDelta` in `web/src/state/review.ts`).
    /// This is the reference implementation: the tests check deltas against it,
    /// and the page's tests check `applyDelta` on the same case.
    pub fn apply(&self, prev: &Snapshot) -> Option<Snapshot> {
        if prev.revision != self.base {
            return None;
        }
        let before: HashMap<&str, usize> = prev.files.iter().enumerate().map(|(i, f)| (f.path.as_str(), i)).collect();
        let fresh: HashMap<&str, &FileDiff> = self.files.iter().map(|f| (f.path.as_str(), f)).collect();
        let by_file = |symbols: &'_ [Symbol]| {
            let mut map: HashMap<u32, Vec<Symbol>> = HashMap::new();
            for s in symbols {
                map.entry(s.file).or_default().push(s.clone());
            }
            map
        };
        let (mut old_symbols, mut new_symbols) = (by_file(&prev.symbols), by_file(&self.symbols));
        let mut files = Vec::with_capacity(self.paths.len());
        let mut symbols = Vec::new();
        for (i, path) in self.paths.iter().enumerate() {
            let i = i as u32;
            if let Some(f) = fresh.get(path.as_str()) {
                files.push((*f).clone());
                symbols.extend(new_symbols.remove(&i).unwrap_or_default());
            } else {
                let old = *before.get(path.as_str())?;
                files.push(prev.files[old].clone());
                symbols.extend(old_symbols.remove(&(old as u32)).unwrap_or_default().into_iter().map(|s| Symbol { file: i, ..s }));
            }
        }
        Some(Snapshot { revision: self.revision, files, symbols })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMsg {
    /// Full state, sent on connect, and to a page that can't apply a `revision`.
    State {
        state: Box<ReviewState>,
    },
    /// Sent on connect instead of `State` when the page already has the
    /// current revision (the socket's URL says which one it has).
    Resume {
        state: Box<LiveState>,
    },
    /// A new revision of the diff, as changes to the one before.
    Revision {
        review: ReviewMeta,
        delta: Box<SnapshotDelta>,
    },
    /// The agent's region labels changed.
    Regions {
        regions: Vec<Region>,
    },
    /// The agent regrouped or relabelled the files.
    Layout {
        layout: Layout,
    },
    /// A thread was created or changed.
    Thread {
        thread: Thread,
    },
    Chat {
        message: Message,
    },
    Activity {
        item: ActivityItem,
    },
    Presence {
        presence: Presence,
    },
    /// The review's language servers started, stopped, or are busy with something new.
    #[serde(rename_all = "camelCase")]
    LanguageServers {
        servers: Vec<LanguageServerStatus>,
    },
    /// A file's diagnostics changed (an empty list clears them).
    Diagnostics {
        path: String,
        diagnostics: Vec<Diagnostic>,
    },
    /// The answer to a `ClientMsg::Code` question.
    #[serde(rename_all = "camelCase")]
    Code {
        request_id: u32,
        answer: CodeAnswer,
    },
    /// New commits landed in the review's range.
    History {
        history: History,
    },
    /// The agent wants to point the user at some code.
    Show {
        request: ShowRequest,
    },
    /// The server applied the page's message with this id (see [`ClientMsg`]).
    Ack {
        id: MessageId,
    },
    /// A request from the page failed.
    Error {
        message: String,
    },
    /// The review no longer exists (it was deleted): stop reconnecting.
    Gone {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientMsg {
    /// Start a thread on a selection. The page picks the ids, so sending the
    /// same message twice (e.g. after a reconnect) has no extra effect.
    #[serde(rename_all = "camelCase")]
    Comment { thread_id: ThreadId, message_id: MessageId, anchor: Anchor, body: String },
    #[serde(rename_all = "camelCase")]
    Reply { thread_id: ThreadId, message_id: MessageId, body: String },
    #[serde(rename_all = "camelCase")]
    Resolve { thread_id: ThreadId, resolved: bool },
    /// The user opened or closed a comment draft; open drafts hold feedback back.
    Drafting { drafting: bool },
    /// A message in the chat box.
    #[serde(rename_all = "camelCase")]
    Chat { message_id: MessageId, body: String },
    /// The user has seen activity up to `seq`.
    Read { seq: u64 },
    /// Ask a language server about a position in a file on the new side
    /// (line 1-based, column in UTF-16 code units). Answered with `ServerMsg::Code`.
    #[serde(rename_all = "camelCase")]
    Code { request_id: u32, query: CodeQuery, path: String, line: u32, col: u32 },
}

/// A review in the recent list on the home page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub review: ReviewMeta,
    /// Agent activity the user hasn't seen.
    pub unread: u32,
}

/// What the server embeds in each page it serves; the page renders from it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "page", rename_all = "camelCase")]
pub enum Boot {
    Home { reviews: Vec<ReviewSummary> },
    Review { state: Box<ReviewState> },
    NotFound { message: String },
}

impl ClientMsg {
    /// The id the server acknowledges once it has applied this message.
    pub fn ack_id(&self) -> Option<&MessageId> {
        match self {
            Self::Comment { message_id, .. } | Self::Reply { message_id, .. } | Self::Chat { message_id, .. } => Some(message_id),
            Self::Resolve { .. } | Self::Drafting { .. } | Self::Read { .. } | Self::Code { .. } => None,
        }
    }
}

/// Ids the page generates must look like ours: short, URL-safe.
pub fn valid_client_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{FileStatus, Side, SideText};

    fn file(path: &str, text: &str) -> FileDiff {
        FileDiff {
            path: path.into(),
            old_path: None,
            status: FileStatus::Modified,
            language: None,
            omitted: None,
            details: vec![],
            collapsed: None,
            labels: vec![],
            added: 1,
            removed: 0,
            old: None,
            new: Some(SideText { lines: vec![text.into()], syntax: vec![vec![]], novel: vec![vec![]] }),
            rows: vec![],
            since: vec![],
        }
    }

    fn symbol(name: &str, file: u32) -> Symbol {
        Symbol { name: name.into(), kind: "function".into(), file, side: Side::New, line: 1, start: 0, end: 1, lines: [1, 1] }
    }

    #[test]
    fn a_delta_carries_only_what_changed_and_rebuilds_the_next_snapshot() {
        let prev = Snapshot {
            revision: 3,
            files: vec![file("a.rs", "a"), file("b.rs", "b"), file("c.rs", "c")],
            symbols: vec![symbol("fa", 0), symbol("fb", 1), symbol("fc", 2), symbol("fc2", 2)],
        };
        // b changes, a goes, d arrives first, c moves.
        let next = Snapshot {
            revision: 4,
            files: vec![file("d.rs", "d"), file("b.rs", "b2"), file("c.rs", "c")],
            symbols: vec![symbol("fd", 0), symbol("fb2", 1), symbol("fc", 2), symbol("fc2", 2)],
        };
        let delta = SnapshotDelta::between(&prev, &next);
        assert_eq!((delta.base, delta.revision), (3, 4));
        assert_eq!(delta.paths, ["d.rs", "b.rs", "c.rs"]);
        assert_eq!(delta.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["d.rs", "b.rs"]);
        assert_eq!(delta.symbols.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["fd", "fb2"]);
        assert_eq!(delta.apply(&prev), Some(next));

        // Only onto the base revision.
        assert_eq!(delta.apply(&Snapshot { revision: 2, ..prev }), None);
    }
}
