//! Folder delta rounds: the pages of changes between two delta tokens.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Mailbox, Message};

/// Where a folder's delta round stands. A skip token and a delta token both
/// carry one.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct DeltaCursor {
    /// The folder id.
    pub(crate) f: String,
    /// Changes up to this sequence number were already reported.
    pub(crate) s: u64,
    /// The sequence number the round reads up to.
    pub(crate) n: u64,
    /// The last entry of the previous page.
    pub(crate) a: Option<(u64, String)>,
    /// The mailbox's sync state generation when the token was made.
    pub(crate) e: u64,
    /// When the token was made, in emulator milliseconds.
    pub(crate) t: i64,
    /// The round's `$select`.
    pub(crate) q: Option<String>,
    /// The round's page size.
    pub(crate) p: usize,
}

pub(crate) enum DeltaEntry<'a> {
    Changed(&'a Message),
    Removed(String),
}

pub(crate) struct DeltaPage<'a> {
    pub(crate) entries: Vec<DeltaEntry<'a>>,
    pub(crate) cursor: DeltaCursor,
    /// Whether the round is over, so `cursor` is a delta token.
    pub(crate) done: bool,
}

impl Mailbox {
    /// The first cursor of a folder's delta round.
    pub(crate) fn delta_start(
        &self,
        folder: &str,
        select: Option<String>,
        page_size: usize,
        now_ms: i64,
    ) -> DeltaCursor {
        DeltaCursor {
            f: folder.to_string(),
            s: 0,
            n: self.seq,
            a: None,
            e: self.delta_epoch,
            t: now_ms,
            q: select,
            p: page_size,
        }
    }

    /// Whether Graph still holds the sync state a token names.
    pub(crate) fn delta_token_valid(&self, cursor: &DeltaCursor, now_ms: i64) -> bool {
        let fresh = self
            .delta_token_lifetime_ms
            .is_none_or(|lifetime| now_ms - cursor.t <= lifetime);
        cursor.e == self.delta_epoch && cursor.n <= self.seq && fresh
    }

    /// Drops the mailbox's sync state: every delta token now answers 410.
    pub(crate) fn expire_delta_tokens(&mut self) {
        self.delta_epoch += 1;
    }

    /// One page of a folder's changes. A cursor without a position starts a
    /// new round from its delta token, reading up to the present.
    pub(crate) fn folder_delta(&self, mut cursor: DeltaCursor, now_ms: i64) -> DeltaPage<'_> {
        if cursor.a.is_none() && cursor.n < self.seq && cursor.s == cursor.n {
            cursor.n = self.seq;
            cursor.t = now_ms;
        }
        let in_round = |seq: u64| seq > cursor.s && seq <= cursor.n;

        let mut entries: Vec<(u64, &str, Option<&Message>)> = self
            .messages
            .values()
            .filter(|message| message.folder_id == cursor.f && in_round(message.changed_seq))
            .map(|message| (message.changed_seq, message.id.as_str(), Some(message)))
            .collect();
        // A first sync lists what the folder holds; it has no removals.
        if cursor.s > 0 {
            let mut removals: BTreeMap<&str, u64> = BTreeMap::new();
            for (seq, folder, message) in &self.removed {
                let back = self.messages.get(message).is_some_and(|current| {
                    current.folder_id == cursor.f && current.changed_seq <= cursor.n
                });
                if folder == &cursor.f && in_round(*seq) && !back {
                    removals.insert(message.as_str(), *seq);
                }
            }
            entries.extend(removals.into_iter().map(|(id, seq)| (seq, id, None)));
        }
        entries.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));

        let after = cursor.a.clone();
        let mut remaining = entries
            .into_iter()
            .filter(|(seq, id, _)| {
                after
                    .as_ref()
                    .is_none_or(|(last_seq, last_id)| (*seq, *id) > (*last_seq, last_id.as_str()))
            })
            .peekable();

        let mut page = Vec::new();
        let mut last = None;
        while page.len() < cursor.p.max(1) {
            let Some((seq, id, message)) = remaining.next() else {
                break;
            };
            last = Some((seq, id.to_string()));
            page.push(match message {
                Some(message) => DeltaEntry::Changed(message),
                None => DeltaEntry::Removed(id.to_string()),
            });
        }

        let done = remaining.peek().is_none();
        if done {
            cursor.s = cursor.n;
            cursor.a = None;
        } else {
            cursor.a = last;
        }
        DeltaPage {
            entries: page,
            cursor,
            done,
        }
    }
}
