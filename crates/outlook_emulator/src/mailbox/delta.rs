//! Folder delta rounds: the pages of changes between two delta tokens.

use std::cmp::Reverse;
use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{Mailbox, Message, Removed};
use crate::odata::Since;

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
    pub(crate) a: Option<Position>,
    /// The mailbox's sync state generation when the token was made.
    pub(crate) e: u64,
    /// When the token was made, in emulator milliseconds.
    pub(crate) t: i64,
    /// The round's `$select`.
    pub(crate) q: Option<String>,
    /// How many more entries the round may report, when its `$top` capped
    /// it.
    pub(crate) c: Option<usize>,
    /// Whether the rounds list newest first, for `$orderby=receivedDateTime
    /// desc`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) o: bool,
    /// The rounds' `$filter` on `receivedDateTime`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) r: Option<Since>,
}

/// Where an entry stands in its round, in the order the round lists them.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum Position {
    /// By the sequence number of its change, then id.
    Seq(u64, String),
    /// Newest first: by `receivedDateTime` descending, then id.
    NewestFirst(Reverse<DateTime<Utc>>, String),
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

/// The most messages a delta round with a `receivedDateTime` filter lists,
/// as Graph documents for message delta.
const FILTERED_ROUND_LIMIT: usize = 5_000;

impl Mailbox {
    /// The first cursor of a folder's delta round. A filtered round lists at
    /// most [`FILTERED_ROUND_LIMIT`] messages, or `$top` if that is smaller.
    pub(crate) fn delta_start(
        &self,
        folder: &str,
        select: Option<String>,
        cap: Option<usize>,
        newest_first: bool,
        received: Option<Since>,
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
            c: match received {
                Some(_) => {
                    Some(cap.map_or(FILTERED_ROUND_LIMIT, |cap| cap.min(FILTERED_ROUND_LIMIT)))
                }
                None => cap,
            },
            o: newest_first,
            r: received,
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
    ///
    /// A cursor with a `receivedDateTime` filter reports only the changed
    /// messages it admits, but every removal: Graph tracks a delta's removals
    /// for the whole folder. (Graph also reports read-state changes of mail
    /// the filter leaves out; the emulator does not.) Every round of a
    /// newest-first cursor lists by `receivedDateTime` descending, a removal
    /// by the time the message had when it left.
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
        let admitted =
            |received: DateTime<Utc>| cursor.r.is_none_or(|filter| filter.admits(received));
        let position = |seq: u64, received: DateTime<Utc>, id: &str| match cursor.o {
            true => Position::NewestFirst(Reverse(received), id.to_string()),
            false => Position::Seq(seq, id.to_string()),
        };

        let mut entries: Vec<(Position, &str, Option<&Message>)> = self
            .messages
            .values()
            .filter(|message| {
                message.folder_id == cursor.f
                    && in_round(message.changed_seq)
                    && admitted(message.received)
            })
            .map(|message| {
                let at = position(message.changed_seq, message.received, &message.id);
                (at, message.id.as_str(), Some(message))
            })
            .collect();
        // A first sync lists what the folder holds; it has no removals.
        if cursor.s > 0 {
            let mut removals: BTreeMap<&str, &Removed> = BTreeMap::new();
            for removed in &self.removed {
                let back = self
                    .messages
                    .get(&removed.message_id)
                    .is_some_and(|current| {
                        current.folder_id == cursor.f && current.changed_seq <= cursor.n
                    });
                let reported = removed.folder_id == cursor.f && in_round(removed.seq);
                if reported && !back {
                    removals.insert(removed.message_id.as_str(), removed);
                }
            }
            entries.extend(
                removals
                    .into_iter()
                    .map(|(id, removed)| (position(removed.seq, removed.received, id), id, None)),
            );
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));

        let after = cursor.a.clone();
        let remaining = entries
            .into_iter()
            .filter(|(at, _, _)| after.as_ref().is_none_or(|last| at > last));

        let mut page = Vec::new();
        let mut last = None;
        let limit = cursor.c.map_or(page_size, |cap| cap.min(page_size));
        for (at, id, message) in remaining.take(limit) {
            last = Some(at);
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
