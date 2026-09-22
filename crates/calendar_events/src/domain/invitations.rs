//! Authorized lookup of email scheduling identities; never creates calendar data.
use super::models::{CalendarEvent, CalendarOccurrence, EventStatus};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

/// Identity derived from an already-authorized saved invitation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InvitationIdentity {
    /// Stable snapshot component key.
    pub id: String,
    /// iCalendar UID, not a provider event ID.
    pub uid: String,
    /// Prefer this inbox only if the viewer independently owns it.
    pub preferred_link_id: Uuid,
    /// Original occurrence key, never the moved start.
    pub occurrence_key: Option<String>,
    /// An instance with an unresolved original timezone must never select a different occurrence.
    pub unresolved_instance: bool,
    /// The newest authorized scheduling message cancels this target.
    pub cancelled: bool,
    /// Revisions from other independently authorized inboxes, reconciled only after account selection.
    pub related_revisions: Vec<InvitationRevision>,
    /// Independent master revisions that may cancel the entire series.
    pub series_revisions: Vec<InvitationRevision>,
    /// Organizer consistency check before exposing actions.
    pub organizer_email: Option<String>,
    /// Snapshot last-modified time, when supplied by the scheduler.
    pub last_modified: Option<chrono::DateTime<chrono::Utc>>,
    /// Snapshot scheduling revision.
    pub sequence: u32,
}
/// An email-authorized scheduling revision from a particular inbox.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InvitationRevision {
    /// Independently authorized message inbox.
    pub link_id: Uuid,
    /// Scheduler revision.
    pub sequence: u32,
    /// Scheduler last-modified or stamp.
    pub last_modified: Option<chrono::DateTime<chrono::Utc>>,
    /// Cancellation of this scheduling target.
    pub cancelled: bool,
}
impl InvitationIdentity {
    fn series_revision(&self, link_id: Option<Uuid>) -> Option<&InvitationRevision> {
        self.series_revisions
            .iter()
            .filter(|revision| {
                link_id.is_none_or(|link| {
                    revision.link_id == link || revision.link_id == self.preferred_link_id
                })
            })
            .max_by_key(|revision| {
                (
                    revision.sequence,
                    revision.last_modified,
                    revision.cancelled,
                )
            })
    }

    fn is_cancelled(&self, link_id: Option<Uuid>) -> bool {
        self.effective_revision(link_id).cancelled
            || self
                .series_revision(link_id)
                .is_some_and(|revision| revision.cancelled)
    }

    fn effective_revision(&self, link_id: Option<Uuid>) -> InvitationRevision {
        self.related_revisions
            .iter()
            .filter(|revision| link_id.is_none_or(|link| revision.link_id == link))
            .cloned()
            .chain(std::iter::once(InvitationRevision {
                link_id: self.preferred_link_id,
                sequence: self.sequence,
                last_modified: self.last_modified,
                cancelled: self.cancelled,
            }))
            .max_by_key(|revision| {
                (
                    revision.sequence,
                    revision.last_modified,
                    revision.cancelled,
                )
            })
            .expect("includes snapshot revision")
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
#[derive(Clone, Debug, Serialize, Deserialize)]
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
    responses_enabled: bool,
}

impl<R> CalendarInvitationResolver<R> {
    /// Configure responses using the calendar owner's sync/mutation gate.
    pub fn new(repository: R, responses_enabled: bool) -> Self {
        Self {
            repository,
            responses_enabled,
        }
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
                    if identity.is_cancelled(None) {
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
            .map(|(identity, mut copies)| {
                if identity.unresolved_instance {
                    return if identity.is_cancelled(None) {
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
                    return if identity.is_cancelled(None) {
                        InvitationResolution::Cancelled
                    } else {
                        InvitationResolution::Ambiguous
                    };
                }
                let Some(mut copy) = copies.pop() else {
                    return if identity.is_cancelled(None) {
                        InvitationResolution::Cancelled
                    } else if availability.syncing {
                        InvitationResolution::StillSyncing
                    } else {
                        InvitationResolution::NoMatch
                    };
                };
                if copy.series_cancelled
                    || identity
                        .series_revision(Some(copy.link_id))
                        .is_some_and(|revision| {
                            revision.cancelled && revision.sequence >= copy.series_sequence
                        })
                {
                    return InvitationResolution::Cancelled;
                }
                for attendee in &mut copy.event.attendees {
                    attendee.is_self = attendee.email.eq_ignore_ascii_case(&copy.email);
                }
                let revision = identity.effective_revision(Some(copy.link_id));
                let organizer_matches = identity
                    .organizer_email
                    .as_ref()
                    .zip(copy.event.organizer_email.as_ref())
                    .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
                let series_stale =
                    identity
                        .series_revision(Some(copy.link_id))
                        .is_some_and(|revision| {
                            revision.sequence > copy.series_sequence
                                || (revision.sequence == copy.series_sequence
                                    && revision
                                        .last_modified
                                        .is_some_and(|modified| modified > copy.series_updated_at))
                        });
                let (target_sequence, target_updated_at) = if identity.occurrence_key.is_none() {
                    (copy.series_sequence, copy.series_updated_at)
                } else {
                    (copy.event.sequence, copy.event.updated_at)
                };
                let is_stale = series_stale
                    || (revision.cancelled
                        && revision.sequence >= target_sequence
                        && copy.event.status != EventStatus::Cancelled
                        && !copy.occurrence.is_cancelled)
                    || revision.sequence > target_sequence
                    || (revision.sequence == target_sequence
                        && revision
                            .last_modified
                            .is_some_and(|modified| modified > target_updated_at));
                let can_join = organizer_matches
                    && !is_stale
                    && copy.event.status != EventStatus::Cancelled
                    && !copy.occurrence.is_cancelled;
                let can_respond = self.responses_enabled
                    && organizer_matches
                    && !is_stale
                    && !copy.event.is_read_only
                    && copy.event.status != EventStatus::Cancelled
                    && !copy.occurrence.is_cancelled
                    && copy.event.attendees.iter().any(|a| a.is_self);
                InvitationResolution::Resolved {
                    event: Box::new(copy.event),
                    occurrence: copy.occurrence,
                    responding_email: copy.email,
                    can_respond,
                    can_join,
                    is_stale,
                }
            })
            .collect())
    }
}
