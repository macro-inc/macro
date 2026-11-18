//! Asking to join a calendar event shared with a channel.
//!
//! A channel member who sees a meeting only through the channel share asks
//! the person who shared it to add them as a guest. The request lives in
//! Macro until the sharer answers it through the mutation service, which
//! adds the guest with the same invite operation a guest uses, so Google
//! sends the invitation. Whether the sharer could do that is read from the
//! capability model on their copy, exactly as the invite path checks it.

use chrono::{DateTime, Utc};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    ics::CalendarEventExportAccess,
    models::{CalendarMentionPreview, CalendarMentionRequestItem},
    mutations::invite::copy_capabilities,
    ports::{
        CalendarJoinRequestError, CalendarJoinRequestNotifier, CalendarJoinRequestService,
        CalendarRefreshNotifier, CalendarRepository,
    },
};

/// Lifecycle of a request to be added as a guest of a shared event.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum CalendarJoinRequestStatus {
    /// Waiting on the person who shared the event.
    Pending,
    /// The sharer added the requester as a guest.
    Accepted,
    /// The sharer turned the request down.
    Declined,
}

impl CalendarJoinRequestStatus {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Declined => "declined",
        }
    }

    /// Parse the database representation, which a check constraint bounds.
    pub fn from_db(value: &str) -> Self {
        match value {
            "accepted" => Self::Accepted,
            "declined" => Self::Declined,
            _ => Self::Pending,
        }
    }
}

/// A channel member's request to be added as a guest of an event they see
/// only through a channel share.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CalendarJoinRequest {
    /// Request identifier.
    pub id: Uuid,
    /// The sharer's event entity that was shared with the channel.
    pub event_id: Uuid,
    /// Macro user asking to join.
    pub requester_id: String,
    /// Address the sharer invites when accepting.
    pub requester_email: String,
    /// Where the request stands.
    pub status: CalendarJoinRequestStatus,
    /// When the request was made.
    pub created_at: DateTime<Utc>,
}

/// Whether a requester may ask to join an event, and who would answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JoinEligibility {
    /// The event is unknown, cancelled, or not visible to the requester.
    NotVisible,
    /// The meeting is already on one of the requester's calendars.
    OwnCopy,
    /// The sharer's copy does not let them add guests: they are a guest the
    /// organizer does not let invite, the organizer hides the guest list, or
    /// their calendar is read-only.
    SharerCannotInvite,
    /// The sharer can add the requester.
    Eligible {
        /// Owner of the shared event, who answers the request.
        sharer_id: String,
        /// Inbox of the sharer's copy. Each inbox holds its own copy of a
        /// meeting, so this one inbox's owner and delegates read the
        /// requests, however many of its calendars hold the event.
        sharer_link_id: Uuid,
        /// Event title, for the sharer's notification.
        title: String,
    },
}

/// Resolve whether the requester could ask to join `event_id`. The sharer's
/// rights come from [`copy_capabilities`] on their canonical copy, the check
/// the invite path runs before writing to the provider, so a request that
/// can be made is one the sharer can accept.
pub async fn join_eligibility<R: CalendarRepository>(
    repository: &R,
    requester_id: &str,
    event_id: Uuid,
) -> Result<JoinEligibility, Report> {
    let Some(shared) = repository.event_export(requester_id, event_id).await? else {
        return Ok(JoinEligibility::NotVisible);
    };
    if shared.access == CalendarEventExportAccess::OwnCopy {
        return Ok(JoinEligibility::OwnCopy);
    }
    let Some(target) = repository
        .get_event_mutation_target(&shared.owner_id, event_id, None)
        .await?
    else {
        return Ok(JoinEligibility::SharerCannotInvite);
    };
    let stored = repository.get_event_attendees(event_id).await?;
    if !copy_capabilities(&target, &stored).invite_guests {
        return Ok(JoinEligibility::SharerCannotInvite);
    }
    Ok(JoinEligibility::Eligible {
        sharer_id: shared.owner_id,
        sharer_link_id: target.email_link_id,
        title: shared.title,
    })
}

/// Fill in the ask-to-join state of every channel-shared preview: whether
/// the requester may ask, and their request if they already did.
pub async fn annotate_join_state<R: CalendarRepository>(
    repository: &R,
    requester_id: &str,
    items: &[CalendarMentionRequestItem],
    previews: &mut [CalendarMentionPreview],
) -> Result<(), Report> {
    let shared =
        items
            .iter()
            .zip(previews.iter_mut())
            .filter_map(|(item, preview)| match preview {
                CalendarMentionPreview::Accessible(event) if event.viewer_event_id.is_none() => {
                    Some((item.event_id, event))
                }
                _ => None,
            });
    for (event_id, event) in shared {
        event.join_request_status = repository
            .find_join_request(event_id, requester_id)
            .await?
            .map(|request| request.status);
        // A declined requester may not ask again.
        event.can_request_to_join = event.join_request_status
            != Some(CalendarJoinRequestStatus::Declined)
            && matches!(
                join_eligibility(repository, requester_id, event_id).await?,
                JoinEligibility::Eligible { .. }
            );
    }
    Ok(())
}

/// Join-request use cases with persistence and delivery behind ports.
pub struct CalendarJoinRequestServiceImpl<R, N, F> {
    repository: R,
    notifier: N,
    refresh: F,
}

impl<R, N, F> CalendarJoinRequestServiceImpl<R, N, F>
where
    R: CalendarRepository,
    N: CalendarJoinRequestNotifier,
    F: CalendarRefreshNotifier,
{
    /// Construct the service from its ports.
    pub fn new(repository: R, notifier: N, refresh: F) -> Self {
        Self {
            repository,
            notifier,
            refresh,
        }
    }

    async fn open_request(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<(CalendarJoinRequest, bool), CalendarJoinRequestError> {
        let eligibility = join_eligibility(&self.repository, requester_id, event_id)
            .await
            .map_err(CalendarJoinRequestError::Internal)?;
        let (sharer_id, sharer_link_id, title) = match eligibility {
            JoinEligibility::NotVisible => return Err(CalendarJoinRequestError::NotFound),
            JoinEligibility::OwnCopy => {
                return Err(CalendarJoinRequestError::AlreadyOnCalendar);
            }
            JoinEligibility::SharerCannotInvite => {
                return Err(CalendarJoinRequestError::SharerCannotInvite);
            }
            JoinEligibility::Eligible {
                sharer_id,
                sharer_link_id,
                title,
            } => (sharer_id, sharer_link_id, title),
        };
        // Invite the inbox whose calendar Macro syncs, the one an added copy
        // would land on, so the mention resolves to the invitation.
        let email = self
            .repository
            .get_creation_target(requester_id, None, None)
            .await
            .map_err(CalendarJoinRequestError::Internal)?
            .map(|target| target.token_identity.email_address)
            .unwrap_or_else(|| account_email(requester_id).to_string());
        let (request, opened) = self
            .repository
            .open_join_request(event_id, requester_id, &email)
            .await
            .map_err(CalendarJoinRequestError::Internal)?;
        // A declined request stands: the requester cannot ask again, so the
        // sharer is never asked twice.
        if request.status == CalendarJoinRequestStatus::Declined {
            return Err(CalendarJoinRequestError::Declined);
        }
        if opened {
            // The request is stored, so a refetch finds it. The signal names
            // the sharer's inbox, so it goes to that inbox's viewers and
            // never to the requester, who reads no list.
            self.refresh
                .calendar_changed(&sharer_id, sharer_link_id, false)
                .await;
            self.notifier
                .notify_join_request(&sharer_id, &request, &title)
                .await;
        }
        Ok((request, opened))
    }
}

/// The address a requester without a connected calendar is invited at: their
/// Macro account address, which the user id carries.
fn account_email(requester_id: &str) -> &str {
    requester_id.strip_prefix("macro|").unwrap_or(requester_id)
}

impl<R, N, F> CalendarJoinRequestService for CalendarJoinRequestServiceImpl<R, N, F>
where
    R: CalendarRepository,
    N: CalendarJoinRequestNotifier,
    F: CalendarRefreshNotifier,
{
    #[tracing::instrument(
        name = "calendar.request_to_join",
        skip(self, requester_id),
        fields(
            event_id = %event_id,
            request_id = tracing::field::Empty,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    async fn request_to_join(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<CalendarJoinRequest, CalendarJoinRequestError> {
        let result = self.open_request(requester_id, event_id).await;
        let span = tracing::Span::current();
        let outcome = match &result {
            Ok((request, true)) => {
                span.record("request_id", tracing::field::display(request.id));
                "requested"
            }
            Ok((request, false)) => {
                span.record("request_id", tracing::field::display(request.id));
                "unchanged"
            }
            Err(CalendarJoinRequestError::NotFound) => "not_found",
            Err(CalendarJoinRequestError::AlreadyOnCalendar) => "already_on_calendar",
            Err(CalendarJoinRequestError::SharerCannotInvite) => "sharer_cannot_invite",
            Err(CalendarJoinRequestError::Declined) => "declined",
            Err(CalendarJoinRequestError::Internal(_)) => "failed",
        };
        span.record("outcome", outcome);
        result.map(|(request, _)| request)
    }

    #[tracing::instrument(skip(self, requester_id), fields(event_id = %event_id), err)]
    async fn list_join_requests(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<Vec<CalendarJoinRequest>, CalendarJoinRequestError> {
        // Only someone who can change the event, its owner or a delegate,
        // sees who asked to join it.
        self.repository
            .get_event_mutation_target(requester_id, event_id, None)
            .await
            .map_err(CalendarJoinRequestError::Internal)?
            .filter(|target| !target.is_read_only)
            .ok_or(CalendarJoinRequestError::NotFound)?;
        self.repository
            .list_pending_join_requests(event_id)
            .await
            .map_err(CalendarJoinRequestError::Internal)
    }
}
