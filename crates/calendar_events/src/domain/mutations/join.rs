//! Answering a channel member's request to join a shared event.
use super::*;
use crate::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    pub(super) async fn answer_join_request(
        &self,
        requester_id: &str,
        request_id: Uuid,
        accept: bool,
    ) -> Result<CalendarJoinRequest, CalendarMutationError> {
        let request = self
            .repository
            .get_join_request(request_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)?;
        // Only someone who can change the shared event answers for it;
        // anyone else learns nothing about the request.
        let target = self
            .resolve_mutation_target(requester_id, request.event_id, None)
            .await?;
        if request.status != CalendarJoinRequestStatus::Pending {
            return Ok(request);
        }
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        if accept {
            // The guest's invite path: it keeps every guest Google holds,
            // enforces the organizer's policy, and sends the invitation.
            self.invite_guests(
                requester_id,
                request.event_id,
                None,
                vec![CalendarAttendeeInput {
                    email: request.requester_email.clone(),
                    is_optional: false,
                    response_status: None,
                }],
                CalendarUpdateScope::All,
            )
            .await?;
        }
        let status = if accept {
            CalendarJoinRequestStatus::Accepted
        } else {
            CalendarJoinRequestStatus::Declined
        };
        if let Some(resolved) = self
            .repository
            .resolve_join_request(request_id, status)
            .await
            .map_err(internal)?
        {
            return Ok(resolved);
        }
        // Another acceptance landed first; report where it left the request.
        self.repository
            .get_join_request(request_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)
    }
}

/// The span outcome of answering a join request.
pub(super) fn answer_outcome(
    accept: bool,
    result: &Result<CalendarJoinRequest, CalendarMutationError>,
) -> &'static str {
    match result {
        Ok(request) => match (accept, request.status) {
            (true, CalendarJoinRequestStatus::Accepted) => "accepted",
            (false, CalendarJoinRequestStatus::Declined) => "declined",
            _ => "already_answered",
        },
        Err(CalendarMutationError::GuestsCannotInvite) => "guests_cannot_invite",
        Err(CalendarMutationError::GuestListHidden) => "guest_list_hidden",
        Err(CalendarMutationError::NotFound) => "not_found",
        Err(CalendarMutationError::ReadOnly) => "read_only",
        Err(_) => "failed",
    }
}
