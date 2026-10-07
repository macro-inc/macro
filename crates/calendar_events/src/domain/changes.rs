//! The per-email-link calendar change log: watermarks, delta pages, and the
//! policy that turns raw log rows into a bounded, gap-free page.
//!
//! Every calendar write transaction appends its changes to the log of the
//! email link the changed rows sync through, under a per-link sequence. A
//! client remembers the last sequence it applied for each visible link and
//! asks for everything after it; visibility is resolved at read time from the
//! links the viewer owns or is delegated.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
};

use chrono::{DateTime, Utc};
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    ActorInboxes, CalendarEvent, CalendarOccurrence, OccurrenceException, VisibleCalendar,
};

#[cfg(test)]
mod test;

/// Most distinct events one delta page hydrates.
pub const MAX_DELTA_EVENTS: usize = 500;
/// Most occurrences one delta page carries. A page always carries at least
/// one event so a single very long series still makes progress.
pub const MAX_DELTA_OCCURRENCES: usize = 5000;
/// Most log rows read for one link per page.
pub const MAX_DELTA_ROWS_PER_LINK: usize = 2000;
/// How long log rows are kept. A client whose watermark is older must reset.
pub const CHANGE_LOG_RETENTION: chrono::Duration = chrono::Duration::days(30);
/// Most log rows one retention batch removes.
pub const CHANGE_LOG_PRUNE_BATCH: usize = 10_000;

/// One logged change to an event or a calendar.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CalendarChangeOp {
    /// The event was created or rewritten.
    UpsertEvent(Uuid),
    /// The event no longer exists.
    DeleteEvent(Uuid),
    /// The calendar was created, restored, or changed a visible field.
    UpsertCalendar(Uuid),
    /// The calendar was removed.
    DeleteCalendar(Uuid),
}

/// One row of a link's change log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalendarChange {
    /// Position in the link's log, starting at 1.
    pub seq: i64,
    /// What changed.
    pub op: CalendarChangeOp,
}

/// How far a client has applied one link's log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalendarLinkWatermark {
    /// Email link identifier.
    pub link_id: Uuid,
    /// Last applied sequence; 0 before anything was logged.
    pub seq: i64,
}

/// A client's position in every visible link's log.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarWatermark(BTreeMap<Uuid, i64>);

impl CalendarWatermark {
    /// Build a watermark from per-link positions. A link listed twice keeps
    /// its lowest position, so nothing between the two is skipped.
    pub fn from_links(links: impl IntoIterator<Item = CalendarLinkWatermark>) -> Self {
        let mut positions = BTreeMap::new();
        for link in links {
            positions
                .entry(link.link_id)
                .and_modify(|seq: &mut i64| *seq = (*seq).min(link.seq))
                .or_insert(link.seq);
        }
        Self(positions)
    }

    /// Whether no link is tracked.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The position for `link_id`, when tracked.
    pub fn seq(&self, link_id: Uuid) -> Option<i64> {
        self.0.get(&link_id).copied()
    }

    /// Per-link positions ordered by link.
    pub fn links(&self) -> impl Iterator<Item = CalendarLinkWatermark> + '_ {
        self.0
            .iter()
            .map(|(&link_id, &seq)| CalendarLinkWatermark { link_id, seq })
    }
}

/// One visible link's log, read in a single snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarLinkLog {
    /// Email link identifier.
    pub link_id: Uuid,
    /// Last sequence written for the link; 0 when nothing was ever logged.
    pub counter: i64,
    /// Lowest position a client may resume from. Rows at or below it were
    /// pruned, so a client behind it has lost changes.
    pub floor: i64,
    /// Rows after the requested position in sequence order, at most the
    /// requested limit. Empty when the link was not requested.
    pub changes: Vec<CalendarChange>,
}

/// One instance of a changed event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventOccurrence {
    /// The materialized instance.
    pub occurrence: CalendarOccurrence,
    /// The instance's exception content, empty when it has none.
    pub exception: OccurrenceException,
}

/// A changed event with its complete current set of visible occurrences.
/// Clients replace everything they hold for the event with this.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventChange {
    /// The series event.
    pub event: CalendarEvent,
    /// Email link the event syncs through.
    pub link_id: Uuid,
    /// Every non-cancelled materialized occurrence, ordered by start.
    pub occurrences: Vec<EventOccurrence>,
}

/// The changed events a page could afford to load.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventChangeLoad {
    /// Considered events that are still visible with a visible occurrence.
    pub events: Vec<CalendarEventChange>,
    /// How many requested ids, from the front, were considered. A considered
    /// id missing from `events` is gone; later ids were not read.
    pub considered: usize,
}

/// One bounded page of changes after a watermark.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarChangesPage {
    /// Events created or changed, with their full occurrence sets.
    pub events: Vec<CalendarEventChange>,
    /// Events that no longer exist or no longer have a visible occurrence.
    pub deleted_event_ids: Vec<Uuid>,
    /// Calendars created or changed.
    pub calendars: Vec<VisibleCalendar>,
    /// Calendars that were removed.
    pub deleted_calendar_ids: Vec<Uuid>,
    /// The position after this page, one entry per currently visible link.
    /// A link missing here is no longer visible.
    pub new_watermark: CalendarWatermark,
    /// Whether more changes follow `new_watermark`.
    pub has_more: bool,
    /// Whether the client must drop everything it holds and refetch: its
    /// watermark is older than retention, or a link became visible that it
    /// never tracked.
    pub reset_required: bool,
}

/// Persistence reads behind the change log.
pub trait CalendarChangeRepository: Send + Sync + 'static {
    /// Every link the viewer can see with its current counter.
    fn current_watermark(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<CalendarWatermark, Report>> + Send;

    /// Every link the viewer can see with its counter, floor, and up to
    /// `limit` rows after the position `since` holds for it, read in one
    /// snapshot. Links `since` does not track carry no rows.
    fn link_logs(
        &self,
        viewer: &str,
        since: &CalendarWatermark,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<CalendarLinkLog>, Report>> + Send;

    /// The current state of the longest prefix of `event_ids` whose
    /// materialized occurrences total at most `max_occurrences`, and always
    /// at least the first id. Within that prefix, events the viewer cannot
    /// see, that were deleted or cancelled, or that lost every visible
    /// occurrence are left out.
    fn load_event_changes(
        &self,
        viewer: &str,
        event_ids: &[Uuid],
        max_occurrences: usize,
    ) -> impl Future<Output = Result<EventChangeLoad, Report>> + Send;

    /// The calendars among `calendar_ids` that are still visible.
    fn list_calendars_by_ids(
        &self,
        viewer: &str,
        calendar_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<VisibleCalendar>, Report>> + Send;

    /// Addresses of every connected inbox the viewer owns.
    fn owned_inbox_emails(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;
}

/// Persistence port for change-log retention.
pub trait CalendarChangeLogPruner: Send + Sync + 'static {
    /// Remove up to `batch` log rows created before `cutoff`, oldest first,
    /// and the counters of links that no longer exist. Returns the number of
    /// log rows removed.
    fn prune_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> impl Future<Output = Result<usize, Report>> + Send;
}

/// Inbound service port for reading the change log.
pub trait CalendarChangeQueryService: Send + Sync + 'static {
    /// The viewer's current position in every visible link's log.
    fn current_watermark(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<CalendarWatermark, Report>> + Send;

    /// One bounded page of changes after `since`. An empty `since` returns
    /// only the current watermark.
    fn changes_since(
        &self,
        viewer: &str,
        since: CalendarWatermark,
    ) -> impl Future<Output = Result<CalendarChangesPage, Report>> + Send;

    /// The current state of one event with its complete set of visible
    /// occurrences, or `None` when the viewer cannot see it or it has no
    /// visible occurrence left.
    fn event_change(
        &self,
        viewer: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarEventChange>, Report>> + Send;
}

/// Change-log reads with the delta policy applied.
pub struct CalendarChangeService<R> {
    repository: R,
}

impl<R: CalendarChangeRepository> CalendarChangeService<R> {
    /// Construct the service.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// The viewer's current position in every visible link's log.
    #[tracing::instrument(skip(self, viewer), err)]
    pub async fn current_watermark(&self, viewer: &str) -> Result<CalendarWatermark, Report> {
        self.repository.current_watermark(viewer).await
    }

    /// One bounded page of changes after `since`.
    #[tracing::instrument(skip(self, viewer, since), err)]
    pub async fn changes_since(
        &self,
        viewer: &str,
        since: CalendarWatermark,
    ) -> Result<CalendarChangesPage, Report> {
        if since.is_empty() {
            return Ok(CalendarChangesPage {
                new_watermark: self.repository.current_watermark(viewer).await?,
                ..CalendarChangesPage::default()
            });
        }
        let logs = self
            .repository
            .link_logs(viewer, &since, MAX_DELTA_ROWS_PER_LINK + 1)
            .await?;
        if requires_reset(&logs, &since) {
            return Ok(CalendarChangesPage {
                new_watermark: counters(&logs),
                reset_required: true,
                ..CalendarChangesPage::default()
            });
        }

        let walk = walk_logs(&logs, &since, MAX_DELTA_EVENTS);
        let upserted: Vec<Uuid> = walk.upserted_events().collect();
        let load = if upserted.is_empty() {
            EventChangeLoad::default()
        } else {
            self.repository
                .load_event_changes(viewer, &upserted, MAX_DELTA_OCCURRENCES)
                .await?
        };
        // Events past the loaded prefix wait for the next page: walking again
        // with a smaller budget stops each link right before the first of them.
        let walk = match upserted.get(load.considered) {
            Some(&unread) => walk_logs(&logs, &since, walk.event_position(unread)),
            None => walk,
        };
        let mut hydrated: HashMap<Uuid, CalendarEventChange> = load
            .events
            .into_iter()
            .map(|change| (change.event.id, change))
            .collect();

        let upserted_calendars: Vec<Uuid> = walk.upserted_calendars().collect();
        let calendars = if upserted_calendars.is_empty() {
            Vec::new()
        } else {
            self.repository
                .list_calendars_by_ids(viewer, &upserted_calendars)
                .await?
        };
        let listed_calendars: HashSet<Uuid> =
            calendars.iter().map(|calendar| calendar.id).collect();

        let mut page = CalendarChangesPage {
            calendars,
            new_watermark: walk.watermark,
            has_more: walk.truncated,
            ..CalendarChangesPage::default()
        };
        for op in walk.ops {
            match op {
                CalendarChangeOp::UpsertEvent(id) => match hydrated.remove(&id) {
                    Some(change) => page.events.push(change),
                    None => page.deleted_event_ids.push(id),
                },
                CalendarChangeOp::DeleteEvent(id) => page.deleted_event_ids.push(id),
                CalendarChangeOp::UpsertCalendar(id) if !listed_calendars.contains(&id) => {
                    page.deleted_calendar_ids.push(id)
                }
                CalendarChangeOp::UpsertCalendar(_) => {}
                CalendarChangeOp::DeleteCalendar(id) => page.deleted_calendar_ids.push(id),
            }
        }
        if let Some(viewer) =
            ActorInboxes::from_owned(self.repository.owned_inbox_emails(viewer).await?)
        {
            for change in &mut page.events {
                mark_viewer_attendees(&viewer, change);
            }
        }
        Ok(page)
    }

    /// The current state of one event with its complete set of visible
    /// occurrences.
    #[tracing::instrument(skip(self, viewer), err)]
    pub async fn event_change(
        &self,
        viewer: &str,
        event_id: Uuid,
    ) -> Result<Option<CalendarEventChange>, Report> {
        let Some(mut change) = self
            .repository
            .load_event_changes(viewer, &[event_id], MAX_DELTA_OCCURRENCES)
            .await?
            .events
            .pop()
        else {
            return Ok(None);
        };
        if let Some(viewer) =
            ActorInboxes::from_owned(self.repository.owned_inbox_emails(viewer).await?)
        {
            mark_viewer_attendees(&viewer, &mut change);
        }
        Ok(Some(change))
    }
}

fn mark_viewer_attendees(viewer: &ActorInboxes, change: &mut CalendarEventChange) {
    viewer.mark_attendees(&mut change.event.attendees);
    for instance in &mut change.occurrences {
        if let Some(attendees) = &mut instance.exception.attendees {
            viewer.mark_attendees(attendees);
        }
    }
}

impl<R: CalendarChangeRepository> CalendarChangeQueryService for CalendarChangeService<R> {
    fn current_watermark(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<CalendarWatermark, Report>> + Send {
        CalendarChangeService::current_watermark(self, viewer)
    }

    fn changes_since(
        &self,
        viewer: &str,
        since: CalendarWatermark,
    ) -> impl Future<Output = Result<CalendarChangesPage, Report>> + Send {
        CalendarChangeService::changes_since(self, viewer, since)
    }

    fn event_change(
        &self,
        viewer: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarEventChange>, Report>> + Send {
        CalendarChangeService::event_change(self, viewer, event_id)
    }
}

/// A client must reset when it fell behind retention on any link, or when a
/// link became visible that it never tracked: that link's data predates its
/// log, so replaying the log cannot reproduce it.
fn requires_reset(logs: &[CalendarLinkLog], since: &CalendarWatermark) -> bool {
    logs.iter().any(|log| match since.seq(log.link_id) {
        None => true,
        Some(seq) => seq < log.floor,
    })
}

fn counters(logs: &[CalendarLinkLog]) -> CalendarWatermark {
    CalendarWatermark::from_links(logs.iter().map(|log| CalendarLinkWatermark {
        link_id: log.link_id,
        seq: log.counter,
    }))
}

/// The coalesced changes a page covers and where it stops.
#[derive(Debug, PartialEq, Eq)]
struct LogWalk {
    /// The latest change per target, in first-seen order.
    ops: Vec<CalendarChangeOp>,
    watermark: CalendarWatermark,
    truncated: bool,
}

impl LogWalk {
    fn upserted_events(&self) -> impl Iterator<Item = Uuid> + '_ {
        self.ops.iter().filter_map(|op| match op {
            CalendarChangeOp::UpsertEvent(id) => Some(*id),
            _ => None,
        })
    }

    /// How many distinct events the walk covers before `event_id`.
    fn event_position(&self, event_id: Uuid) -> usize {
        self.ops
            .iter()
            .filter(|op| matches!(target(**op), Target::Event(_)))
            .take_while(|op| target(**op) != Target::Event(event_id))
            .count()
    }

    fn upserted_calendars(&self) -> impl Iterator<Item = Uuid> + '_ {
        self.ops.iter().filter_map(|op| match op {
            CalendarChangeOp::UpsertCalendar(id) => Some(*id),
            _ => None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Target {
    Event(Uuid),
    Calendar(Uuid),
}

fn target(op: CalendarChangeOp) -> Target {
    match op {
        CalendarChangeOp::UpsertEvent(id) | CalendarChangeOp::DeleteEvent(id) => Target::Event(id),
        CalendarChangeOp::UpsertCalendar(id) | CalendarChangeOp::DeleteCalendar(id) => {
            Target::Calendar(id)
        }
    }
}

/// Walk each link's rows in sequence order, links in id order, until
/// `max_events` distinct events are covered. A link stops on a sequence
/// boundary: its watermark advances only past rows the page covers, so a
/// truncated page resumes exactly where it stopped.
fn walk_logs(logs: &[CalendarLinkLog], since: &CalendarWatermark, max_events: usize) -> LogWalk {
    let mut sorted: Vec<&CalendarLinkLog> = logs.iter().collect();
    sorted.sort_by_key(|log| log.link_id);
    let mut order: Vec<Target> = Vec::new();
    let mut latest: HashMap<Target, CalendarChangeOp> = HashMap::new();
    let mut events = 0;
    let mut truncated = false;
    let mut watermark = Vec::with_capacity(sorted.len());
    for log in sorted {
        let start = since.seq(log.link_id).unwrap_or(log.counter);
        let mut position = start;
        let mut stopped = log.changes.len() > MAX_DELTA_ROWS_PER_LINK;
        for change in log.changes.iter().take(MAX_DELTA_ROWS_PER_LINK) {
            let key = target(change.op);
            let new_event = matches!(key, Target::Event(_)) && !latest.contains_key(&key);
            if new_event && events == max_events {
                stopped = true;
                break;
            }
            if new_event {
                events += 1;
            }
            if latest.insert(key, change.op).is_none() {
                order.push(key);
            }
            position = change.seq;
        }
        truncated |= stopped;
        watermark.push(CalendarLinkWatermark {
            link_id: log.link_id,
            seq: if stopped { position } else { log.counter },
        });
    }
    LogWalk {
        ops: order.into_iter().map(|key| latest[&key]).collect(),
        watermark: CalendarWatermark::from_links(watermark),
        truncated,
    }
}

/// Removes change-log rows older than [`CHANGE_LOG_RETENTION`].
pub struct CalendarChangeLogRetention<R> {
    repository: R,
}

impl<R: CalendarChangeLogPruner> CalendarChangeLogRetention<R> {
    /// Construct the retention job from its persistence port.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Prune everything older than retention as of `now`, in batches.
    /// Returns the number of rows removed.
    #[tracing::instrument(skip(self), err)]
    pub async fn run_once(&self, now: DateTime<Utc>) -> Result<usize, Report> {
        let cutoff = now - CHANGE_LOG_RETENTION;
        let mut removed = 0;
        loop {
            let batch = self
                .repository
                .prune_change_log(cutoff, CHANGE_LOG_PRUNE_BATCH)
                .await?;
            removed += batch;
            if batch < CHANGE_LOG_PRUNE_BATCH {
                return Ok(removed);
            }
        }
    }
}
