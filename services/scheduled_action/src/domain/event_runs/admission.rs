//! Normalize once, then durably admit each eligible user-owned action.

use std::sync::Arc;

use super::*;

#[cfg(test)]
mod test;

/// Keyset paging bounds memory without truncating an event's fan-out. A failed
/// page or access lookup leaves intake unacknowledged; redelivery deduplicates
/// any earlier inserts.
pub struct EventAdmissionService<R, A> {
    repository: Arc<R>,
    access: Arc<A>,
    page_size: PageSize,
}

impl<R, A> EventAdmissionService<R, A> {
    pub fn new(repository: Arc<R>, access: Arc<A>, page_size: PageSize) -> Self {
        Self {
            repository,
            access,
            page_size,
        }
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess> EventIngestion for EventAdmissionService<R, A> {
    async fn ingest(&self, incoming: &IncomingEvent) -> Result<EventIngestionResult, Report> {
        let event = match incoming.normalize() {
            Ok(event) => event,
            Err(reason) => return Ok(EventIngestionResult::Rejected(reason)),
        };
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
                let pending = PendingEventRun {
                    action_id: configuration.action_id,
                    revision: configuration.revision,
                    event: event.clone(),
                    admitted_at: Utc::now(),
                };
                if configuration.check_pending(&pending).is_err() {
                    continue;
                }
                let Owner::User(owner) = &configuration.owner else {
                    continue;
                };
                let Some(access) = self.access.authorize(owner, &event).await? else {
                    continue;
                };
                if AuthorizedEventRun::prepare(pending, &configuration, access).is_err() {
                    continue;
                }
                if self
                    .repository
                    .admit(configuration.action_id, configuration.revision, &event)
                    .await?
                    == AdmissionResult::Admitted
                {
                    inserted += 1;
                }
            }
            after = Some(next_after);
        }
    }
}
