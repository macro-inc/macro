//! `calendarView/delta` rounds: the pages of changes to the default
//! calendar's view between two delta tokens.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{Calendars, Event, Occurrence, occurrence_id};

/// Where a delta round stands. A skip token and a delta token both carry one.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CalendarCursor {
    /// The view's window.
    pub(crate) from: DateTime<Utc>,
    pub(crate) to: DateTime<Utc>,
    /// Changes up to this sequence number were already reported.
    pub(crate) s: u64,
    /// The sequence number the round reads up to.
    pub(crate) n: u64,
    /// The last entry of the previous page: its group's sequence number
    /// and event, and its place in the group.
    pub(crate) a: Option<(u64, String, usize)>,
    /// The sync state generation when the token was made.
    pub(crate) e: u64,
    /// The round's page size.
    pub(crate) p: usize,
}

/// One entry of a delta page.
pub(crate) enum CalendarEntry<'a> {
    /// A single event or a series master, in full.
    Event(&'a Event),
    /// An occurrence of a series: in full when it is an exception, and
    /// otherwise only what tells it apart.
    Occurrence(Occurrence<'a>),
    Removed(String),
}

pub(crate) struct CalendarPage<'a> {
    pub(crate) entries: Vec<CalendarEntry<'a>>,
    pub(crate) cursor: CalendarCursor,
    /// Whether the round is over, so `cursor` is a delta token.
    pub(crate) done: bool,
}

impl Calendars {
    /// The first cursor of a view's delta round.
    pub(crate) fn delta_start(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        page_size: usize,
    ) -> CalendarCursor {
        CalendarCursor {
            from,
            to,
            s: 0,
            n: self.seq,
            a: None,
            e: self.epoch,
            p: page_size,
        }
    }

    /// Whether Graph still holds the sync state a token names.
    pub(crate) fn delta_token_valid(&self, cursor: &CalendarCursor) -> bool {
        cursor.e == self.epoch && cursor.n <= self.seq
    }

    /// One page of the default calendar's changes. A cursor at the start of
    /// a round reads from its delta token up to the present.
    pub(crate) fn view_delta(&self, mut cursor: CalendarCursor) -> CalendarPage<'_> {
        if cursor.a.is_none() && cursor.s == cursor.n {
            cursor.n = self.seq;
        }
        let (from, to) = (cursor.from, cursor.to);
        let in_round = |seq: u64| seq > cursor.s && seq <= cursor.n;
        let first_round = cursor.s == 0;
        // Only what an earlier round could have listed is reported removed:
        // a tombstone for an id the client never saw tells it nothing.
        let listed_before = |event: &Event| !first_round && event.created_seq <= cursor.s;
        let default = self.default_calendar().map(|calendar| calendar.id.as_str());

        let mut groups: Vec<(u64, String, Vec<CalendarEntry<'_>>)> = Vec::new();
        for event in self.events.values() {
            if Some(event.calendar_id.as_str()) != default {
                continue;
            }
            // A deleted occurrence is a change of its own: a later change to
            // its series, even in the middle of a round, does not hide it.
            if listed_before(event) {
                let deleted = event.cancelled.iter().filter(|(_, seq)| in_round(**seq));
                groups.extend(deleted.map(|(date, seq)| {
                    let id = occurrence_id(&event.id, *date);
                    (*seq, id.clone(), vec![CalendarEntry::Removed(id)])
                }));
            }
            if !in_round(event.changed_seq) {
                continue;
            }
            let mut entries = Vec::new();
            if event.is_series() {
                let occurrences = event.occurrences(from, to);
                if occurrences.is_empty() {
                    if listed_before(event) {
                        entries.push(CalendarEntry::Removed(event.id.clone()));
                    }
                } else {
                    entries.push(CalendarEntry::Event(event));
                    entries.extend(occurrences.into_iter().map(CalendarEntry::Occurrence));
                }
            } else if event.overlaps(from, to) {
                entries.push(CalendarEntry::Event(event));
            } else if listed_before(event) {
                entries.push(CalendarEntry::Removed(event.id.clone()));
            }
            groups.push((event.changed_seq, event.id.clone(), entries));
        }
        for removed in &self.removed {
            let event = &removed.event;
            let wanted = Some(event.calendar_id.as_str()) == default
                && in_round(removed.seq)
                && listed_before(event);
            if !wanted {
                continue;
            }
            let mut entries = vec![CalendarEntry::Removed(event.id.clone())];
            entries.extend(
                event
                    .occurrences(from, to)
                    .into_iter()
                    .map(|occurrence| CalendarEntry::Removed(occurrence.id())),
            );
            groups.push((removed.seq, event.id.clone(), entries));
        }
        groups.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));

        let after = cursor.a.clone();
        let mut remaining = groups
            .into_iter()
            .flat_map(|(seq, id, entries)| {
                let keyed = entries.into_iter().enumerate();
                keyed.map(move |(index, entry)| ((seq, id.clone(), index), entry))
            })
            .filter(|(key, _)| after.as_ref().is_none_or(|after| key > after))
            .peekable();
        let mut entries = Vec::new();
        let mut last = None;
        while entries.len() < cursor.p.max(1) {
            let Some(((seq, id, index), entry)) = remaining.next() else {
                break;
            };
            last = Some((seq, id, index));
            entries.push(entry);
        }

        let done = remaining.peek().is_none();
        if done {
            cursor.s = cursor.n;
            cursor.a = None;
        } else {
            cursor.a = last;
        }
        CalendarPage {
            entries,
            cursor,
            done,
        }
    }
}
