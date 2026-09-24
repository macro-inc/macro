//! Asking to join a calendar event shared with a channel.
//!
//! A channel member who sees a meeting only through the channel share asks
//! the owner of the shared row to add them as a guest. The request lives in
//! Macro until the owner answers it through the mutation service, which
//! writes the guest to the provider.

#[cfg(test)]
mod test;

use uuid::Uuid;

use super::{
    models::{CalendarEventCopyAccess, CalendarJoinRequest},
    ports::{
        CalendarJoinRequestError, CalendarJoinRequestNotifier, CalendarJoinRequestService,
        CalendarRepository,
    },
};

/// Join-request use cases with persistence and delivery behind ports.
pub struct CalendarJoinRequestServiceImpl<R, N> {
    repository: R,
    notifier: N,
}

impl<R, N> CalendarJoinRequestServiceImpl<R, N>
where
    R: CalendarRepository,
    N: CalendarJoinRequestNotifier,
{
    /// Construct the service from its ports.
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }
}

/// The address a requester without a connected inbox is invited at: their
/// Macro account address, which the user id carries.
fn account_email(requester_id: &str) -> &str {
    requester_id.strip_prefix("macro|").unwrap_or(requester_id)
}

impl<R, N> CalendarJoinRequestService for CalendarJoinRequestServiceImpl<R, N>
where
    R: CalendarRepository,
    N: CalendarJoinRequestNotifier,
{
    #[tracing::instrument(skip(self, requester_id), err)]
    async fn request_to_join(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<CalendarJoinRequest, CalendarJoinRequestError> {
        let target = self
            .repository
            .get_join_target(requester_id, event_id)
            .await
            .map_err(CalendarJoinRequestError::Internal)?
            .ok_or(CalendarJoinRequestError::NotFound)?;
        if target.access == CalendarEventCopyAccess::OwnCopy {
            return Err(CalendarJoinRequestError::AlreadyOnCalendar);
        }
        // Accepting writes the guest through the owner's copy, which Google
        // refuses when a guest owner may not invite others.
        if !target.owner_can_invite() {
            return Err(CalendarJoinRequestError::OrganizerOnly);
        }
        // Invite the inbox whose calendar Macro syncs, so the invitation
        // lands where the mention can resolve it.
        let email = target
            .requester_inbox_email
            .as_deref()
            .unwrap_or_else(|| account_email(requester_id));
        let (request, opened) = self
            .repository
            .open_join_request(target.event_id, requester_id, email)
            .await
            .map_err(CalendarJoinRequestError::Internal)?;
        if opened {
            self.notifier
                .notify_join_request(&target.owner_id, &request, &target.title)
                .await;
        }
        Ok(request)
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn list_join_requests(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<Vec<CalendarJoinRequest>, CalendarJoinRequestError> {
        // Only someone who can edit the event, its owner or a delegate, sees
        // who asked to join it.
        self.repository
            .get_event_mutation_target(requester_id, event_id, None)
            .await
            .map_err(CalendarJoinRequestError::Internal)?
            .ok_or(CalendarJoinRequestError::NotFound)?;
        self.repository
            .list_pending_join_requests(event_id)
            .await
            .map_err(CalendarJoinRequestError::Internal)
    }
}
