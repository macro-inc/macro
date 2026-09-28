//! Authorized lookup of email scheduling identities; never creates calendar data.
use super::models::{CalendarEvent, CalendarOccurrence, EventStatus};
use rootcause::Report;
use serde::Serialize;
use std::future::Future;
use uuid::Uuid;

/// Identity derived from an already-authorized saved invitation.
#[derive(Clone, Debug)]
pub struct InvitationIdentity {
    /// iCalendar UID, not a provider event ID.
    pub uid: String,
    /// Prefer the copy synced from the inbox the email arrived in.
    pub preferred_link_id: Uuid,
    /// Original occurrence key, never the moved start.
    pub occurrence_key: Option<String>,
    /// An instance with an unresolved original timezone must never select a different occurrence.
    pub unresolved_instance: bool,
    /// Newest saved scheduling revision of this target.
    pub revision: InvitationRevision,
    /// Newest saved revision of the series master, for an instance. It may cancel the series.
    pub series_revision: Option<InvitationRevision>,
    /// Organizer consistency check before exposing actions.
    pub organizer_email: Option<String>,
}
/// A saved scheduling revision.
#[derive(Clone, Debug)]
pub struct InvitationRevision {
    /// Scheduler revision.
    pub sequence: u32,
    /// Scheduler last-modified or stamp.
    pub last_modified: Option<chrono::DateTime<chrono::Utc>>,
    /// Cancellation of this scheduling target.
    pub cancelled: bool,
}
impl InvitationRevision {
    /// An undated cancellation cannot safely lose to a request at the same sequence.
    /// Otherwise use scheduler timestamps, with cancellation winning exact ties.
    pub fn ordering_key(&self) -> (u32, bool, Option<chrono::DateTime<chrono::Utc>>, bool) {
        (
            self.sequence,
            self.cancelled && self.last_modified.is_none(),
            self.last_modified,
            self.cancelled,
        )
    }

    /// Whether the email is ahead of a synced copy at this revision.
    fn is_newer_than(&self, sequence: u32, updated_at: chrono::DateTime<chrono::Utc>) -> bool {
        self.sequence > sequence
            || (self.sequence == sequence
                && self
                    .last_modified
                    .is_some_and(|modified| modified > updated_at))
    }
}
impl InvitationIdentity {
    fn is_cancelled(&self) -> bool {
        self.revision.cancelled
            || self
                .series_revision
                .as_ref()
                .is_some_and(|revision| revision.cancelled)
    }
}

/// Facts from an independently authorized owned calendar copy.
pub struct InvitationCandidate {
    /// Connected inbox of this copy.
    pub link_id: Uuid,
    /// Authorized responding identity.
    pub email: String,
    /// Current event including occurrence overrides.
    pub event: CalendarEvent,
    /// Master revision before occurrence overrides are applied.
    pub series_sequence: u32,
    /// Freshness of the master before exception timestamps are applied.
    pub series_updated_at: chrono::DateTime<chrono::Utc>,
    /// Master cancellation applies even when an exception has a different status.
    pub series_cancelled: bool,
    /// Exact original occurrence, including cancellation.
    pub occurrence: CalendarOccurrence,
}
/// Calendar-owned access and identity lookup boundary.
pub trait CalendarInvitationRepository: Send + Sync {
    /// Whether an independently owned connected account is available or still syncing.
    fn invitation_availability(
        &self,
        viewer: &str,
    ) -> impl Future<Output = Result<InvitationAvailability, Report>> + Send;
    /// Batch query only the viewer's owned calendar copies.
    fn invitation_candidates(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> impl Future<Output = Result<Vec<Vec<InvitationCandidate>>, Report>> + Send;
}
/// Calendar connection/sync facts for explaining lookup misses.
pub struct InvitationAvailability {
    /// At least one active owned calendar account.
    pub connected: bool,
    /// At least one active account still syncing.
    pub syncing: bool,
}
/// Refreshable result, distinct from the immutable email contents.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum InvitationResolution {
    /// Viewer has no active owned Google-backed calendar.
    Disconnected,
    /// An active calendar is still ingesting this event.
    StillSyncing,
    /// A saved scheduling cancellation precedes removal from the synced projection.
    Cancelled,
    /// Original occurrence identity cannot safely be interpreted.
    Unavailable,
    /// No independently authorized matching copy has synced.
    NoMatch,
    /// More than one owned account could respond; never guess.
    Ambiguous,
    /// Current authorized event and explicit capabilities.
    Resolved {
        /// Current occurrence-specific content.
        event: Box<CalendarEvent>,
        /// Original occurrence identity and current time.
        occurrence: CalendarOccurrence,
        /// Connected address that would respond.
        responding_email: String,
        /// Whether a response is currently allowed.
        can_respond: bool,
        /// Whether the conference link belongs to the reconciled scheduling target.
        can_join: bool,
        /// Whether the provider projection trails the email revision.
        is_stale: bool,
    },
}
/// Maximum number of identities resolved by a single service call.
pub const MAX_INVITATION_BATCH: usize = 100;

/// Calendar-owned service boundary for email-authorized invitation identities.
pub trait CalendarInvitationService: Send + Sync + 'static {
    /// Independently authorize calendar access and return one result per identity, in order.
    fn resolve(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> impl Future<Output = Result<Vec<InvitationResolution>, Report>> + Send;
}

/// Calendar-domain authorization, ambiguity, and response capability policy.
pub struct CalendarInvitationResolver<R> {
    repository: R,
}

impl<R> CalendarInvitationResolver<R> {
    /// Resolve against the viewer's synced calendar copies.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

impl<R: CalendarInvitationRepository + 'static> CalendarInvitationService
    for CalendarInvitationResolver<R>
{
    /// Resolve a bounded batch. Missing data is deliberately not permanent.
    async fn resolve(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> Result<Vec<InvitationResolution>, Report> {
        if items.len() > MAX_INVITATION_BATCH {
            return Err(rootcause::report!(
                "at most 100 invitation identities per request"
            ));
        }
        let availability = self.repository.invitation_availability(viewer).await?;
        if !availability.connected {
            return Ok(items
                .iter()
                .map(|identity| {
                    if identity.is_cancelled() {
                        InvitationResolution::Cancelled
                    } else {
                        InvitationResolution::Disconnected
                    }
                })
                .collect());
        }
        let candidates = self.repository.invitation_candidates(viewer, items).await?;
        Ok(items
            .iter()
            .zip(candidates)
            .map(|(identity, copies)| decide(identity, copies, availability.syncing))
            .collect())
    }
}

/// Match one identity to at most one synced copy and derive its capabilities.
fn decide(
    identity: &InvitationIdentity,
    mut copies: Vec<InvitationCandidate>,
    syncing: bool,
) -> InvitationResolution {
    let cancelled = identity.is_cancelled();
    if identity.unresolved_instance {
        return if cancelled {
            InvitationResolution::Cancelled
        } else {
            InvitationResolution::Unavailable
        };
    }
    if copies
        .iter()
        .any(|copy| copy.link_id == identity.preferred_link_id)
    {
        copies.retain(|copy| copy.link_id == identity.preferred_link_id);
    }
    if copies.len() > 1 {
        return if cancelled {
            InvitationResolution::Cancelled
        } else {
            InvitationResolution::Ambiguous
        };
    }
    let Some(mut copy) = copies.pop() else {
        return if cancelled {
            InvitationResolution::Cancelled
        } else if syncing {
            InvitationResolution::StillSyncing
        } else {
            InvitationResolution::NoMatch
        };
    };
    let series = identity.series_revision.as_ref();
    if copy.series_cancelled
        || series
            .is_some_and(|revision| revision.cancelled && revision.sequence >= copy.series_sequence)
    {
        return InvitationResolution::Cancelled;
    }
    for attendee in &mut copy.event.attendees {
        attendee.is_self = attendee.email.eq_ignore_ascii_case(&copy.email);
    }
    let revision = &identity.revision;
    let (target_sequence, target_updated_at) = if identity.occurrence_key.is_none() {
        (copy.series_sequence, copy.series_updated_at)
    } else {
        (copy.event.sequence, copy.event.updated_at)
    };
    let copy_live = copy.event.status != EventStatus::Cancelled && !copy.occurrence.is_cancelled;
    let is_stale = series.is_some_and(|revision| {
        revision.is_newer_than(copy.series_sequence, copy.series_updated_at)
    }) || (revision.cancelled && revision.sequence >= target_sequence && copy_live)
        || revision.is_newer_than(target_sequence, target_updated_at);
    let organizer_matches = identity
        .organizer_email
        .as_ref()
        .zip(copy.event.organizer_email.as_ref())
        .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
    let actionable = organizer_matches && !is_stale && copy_live;
    let can_respond =
        actionable && !copy.event.is_read_only && copy.event.attendees.iter().any(|a| a.is_self);
    InvitationResolution::Resolved {
        event: Box::new(copy.event),
        occurrence: copy.occurrence,
        responding_email: copy.email,
        can_respond,
        can_join: actionable,
        is_stale,
    }
}

#[cfg(test)]
mod test;
