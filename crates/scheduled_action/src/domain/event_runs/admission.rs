//! Normalize once, then durably admit each eligible user-owned action.

use std::sync::Arc;

use super::*;

#[cfg(test)]
mod test;

/// Keyset paging bounds memory without truncating an event's fan-out. A failed
/// page or access lookup leaves intake unacknowledged; redelivery deduplicates
/// any earlier inserts.
pub struct EventAdmissionService<R, A, D> {
    repository: Arc<R>,
    access: Arc<A>,
    delegates: Arc<D>,
    page_size: PageSize,
}

impl<R, A, D> EventAdmissionService<R, A, D> {
    pub fn new(repository: Arc<R>, access: Arc<A>, delegates: Arc<D>, page_size: PageSize) -> Self {
        Self {
            repository,
            access,
            delegates,
            page_size,
        }
    }
}

/// Who an event is for. A received email is also for whoever its inbox is
/// delegated to, read once per event and only when a candidate's owner isn't
/// the inbox's.
struct Audience<'a> {
    incoming: &'a IncomingEvent,
    delegates: Option<Vec<MacroUserIdStr<'static>>>,
}

impl<'a> Audience<'a> {
    fn new(incoming: &'a IncomingEvent) -> Self {
        Self {
            incoming,
            delegates: None,
        }
    }

    async fn includes(
        &mut self,
        owner: &MacroUserIdStr<'static>,
        port: &impl InboxDelegates,
    ) -> Result<bool, Report> {
        if self.incoming.is_for_owner(owner) {
            return Ok(true);
        }
        let Some((inbox_owner, link_id)) = self.incoming.received_inbox() else {
            return Ok(false);
        };
        if self.delegates.is_none() {
            self.delegates = Some(port.delegates(inbox_owner, link_id).await?);
        }
        Ok(self
            .delegates
            .as_ref()
            .is_some_and(|delegates| delegates.contains(owner)))
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, D: InboxDelegates>
    EventAdmissionService<R, A, D>
{
    /// Admit `event` to one candidate if it is eligible now. False when it is
    /// not: disabled, changed, filtered out, not for the owner, or not the
    /// owner's to see.
    async fn admit_candidate(
        &self,
        configuration: EventActionConfiguration,
        event: &EventReference,
        audience: &mut Audience<'_>,
    ) -> Result<bool, Report> {
        let pending = PendingEventRun {
            action_id: configuration.action_id,
            revision: configuration.revision,
            event: event.clone(),
            admitted_at: Utc::now(),
        };
        if configuration.check_pending(&pending).is_err() {
            return Ok(false);
        }
        let Owner::User(owner) = &configuration.owner else {
            return Ok(false);
        };
        if !audience.includes(owner, self.delegates.as_ref()).await? {
            return Ok(false);
        }
        let Some(access) = self.access.authorize(owner, event).await? else {
            return Ok(false);
        };
        if AuthorizedEventRun::prepare(pending, &configuration, access).is_err() {
            return Ok(false);
        }
        Ok(self
            .repository
            .admit(
                configuration.action_id,
                configuration.revision,
                &configuration.filters.run_event(event),
            )
            .await?
            == AdmissionResult::Admitted)
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, D: InboxDelegates> EventIngestion
    for EventAdmissionService<R, A, D>
{
    async fn ingest(&self, incoming: &IncomingEvent) -> Result<EventIngestionResult, Report> {
        let event = match incoming.normalize() {
            Ok(event) => event,
            Err(reason) => return Ok(EventIngestionResult::Rejected(reason)),
        };
        let mut audience = Audience::new(incoming);
        let mut after = None;
        let mut inserted = 0;
        loop {
            let candidates = self
                .repository
                .candidate_actions(&event, after, self.page_size)
                .await?;
            let Some(next_after) = candidates.next_after else {
                if !candidates.configurations.is_empty() {
                    return Err(rootcause::report!("event candidate page has no cursor"));
                }
                return Ok(EventIngestionResult::Admitted { inserted });
            };
            if after.is_some_and(|id| next_after <= id) {
                return Err(rootcause::report!("event candidate cursor did not advance"));
            }
            for configuration in candidates.configurations {
                // Enforce forward progress even for a broken repository adapter.
                if after.is_some_and(|id| configuration.action_id <= id)
                    || configuration.action_id > next_after
                {
                    return Err(rootcause::report!("event candidate page is not ordered"));
                }
                after = Some(configuration.action_id);
                if self
                    .admit_candidate(configuration, &event, &mut audience)
                    .await?
                {
                    inserted += 1;
                }
            }
            after = Some(next_after);
        }
    }
}
