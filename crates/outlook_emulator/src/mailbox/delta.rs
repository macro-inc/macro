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
    /// How many more entries the round may report, when its `$top` capped
    /// it.
    pub(crate) c: Option<usize>,
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
        cap: Option<usize>,
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
            c: cap,
        }
    }

    /// Whether Graph still holds the sync state a token names.
    pub(crate) fn delta_token_valid(&self, cursor: &DeltaCursor, now_ms: i64) -> bool {
        let fresh = self
            .delta_token_lifetime_ms
            .is_none_or(|lifetime| now_ms - cursor.t <= lifetime);
        cursor.e == self.delta_epoch && cursor.n <= self.seq && fresh
    }

    /// Drops the mailbox's sync state: every delta token, a folder's or the
    /// calendar view's, now answers 410.
    pub(crate) fn expire_delta_tokens(&mut self) {
        self.delta_epoch += 1;
        self.calendar.expire_delta_tokens();
    }

    /// One page of a folder's changes, of up to `page_size` entries. A cursor
    /// without a position starts a new round from its delta token, reading up
    /// to the present.
    ///
    /// As Graph does, the round ends on the first page that comes back short,
    /// so a round whose entries fill its last page ends with an empty one. A
    /// round capped by `$top` ends at the cap, and its delta token does not
    /// report what the cap left out.
    pub(crate) fn folder_delta(
        &self,
        mut cursor: DeltaCursor,
        page_size: usize,
        now_ms: i64,
    ) -> DeltaPage<'_> {
        let page_size = page_size.max(1);
        if cursor.a.is_none() && cursor.n < self.seq && cursor.s == cursor.n {
            cursor.c = None;
        }
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
        let remaining = entries.into_iter().filter(|(seq, id, _)| {
            after
                .as_ref()
                .is_none_or(|(last_seq, last_id)| (*seq, *id) > (*last_seq, last_id.as_str()))
        });

        let mut page = Vec::new();
        let mut last = None;
        let limit = cursor.c.map_or(page_size, |cap| cap.min(page_size));
        for (seq, id, message) in remaining.take(limit) {
            last = Some((seq, id.to_string()));
            page.push(match message {
                Some(message) => DeltaEntry::Changed(message),
                None => DeltaEntry::Removed(id.to_string()),
            });
        }

        let done = page.len() < page_size;
        if done {
            cursor.s = cursor.n;
            cursor.a = None;
            cursor.c = None;
        } else {
            cursor.a = last;
            cursor.c = cursor.c.map(|cap| cap - page.len());
        }
        DeltaPage {
            entries: page,
            cursor,
            done,
        }
    }
}
