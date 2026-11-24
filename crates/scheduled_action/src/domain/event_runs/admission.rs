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

/// What became of one candidate routine for an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CandidateOutcome {
    Admitted,
    /// Its filters don't take the event (another selector), or the event
    /// predates its activation.
    FilteredOut,
    /// Its filters would take the event but for the inboxes they pick.
    OutsideInboxes,
    /// Disabled, not for its owner, not theirs to see, or already admitted.
    Skipped,
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, D: InboxDelegates>
    EventAdmissionService<R, A, D>
{
    /// Admit `event` to one candidate if it is eligible now.
    async fn admit_candidate(
        &self,
        configuration: EventActionConfiguration,
        event: &EventReference,
        audience: &mut Audience<'_>,
    ) -> Result<CandidateOutcome, Report> {
        let pending = PendingEventRun {
            action_id: configuration.action_id,
            revision: configuration.revision,
            event: event.clone(),
            admitted_at: Utc::now(),
        };
        match configuration.check_pending(&pending) {
            Ok(()) => {}
            // The pending run is this configuration's own, so only its
            // filters can supersede it.
            Err(CancellationReason::Superseded) => {
                return Ok(
                    if configuration
                        .filters
                        .turn_away_only_for_inbox(event, configuration.activated_at)
                    {
                        CandidateOutcome::OutsideInboxes
                    } else {
                        CandidateOutcome::FilteredOut
                    },
                );
            }
            Err(_) => return Ok(CandidateOutcome::Skipped),
        }
        let Owner::User(owner) = &configuration.owner else {
            return Ok(CandidateOutcome::Skipped);
        };
        if !audience.includes(owner, self.delegates.as_ref()).await? {
            return Ok(CandidateOutcome::Skipped);
        }
        let Some(access) = self.access.authorize(owner, event).await? else {
            return Ok(CandidateOutcome::Skipped);
        };
        if AuthorizedEventRun::prepare(pending, &configuration, access).is_err() {
            return Ok(CandidateOutcome::Skipped);
        }
        let admitted = self
            .repository
            .admit(
                configuration.action_id,
                configuration.revision,
                &configuration.filters.run_event(event),
            )
            .await?;
        Ok(if admitted == AdmissionResult::Admitted {
            CandidateOutcome::Admitted
        } else {
            CandidateOutcome::Skipped
        })
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, D: InboxDelegates> EventIngestion
    for EventAdmissionService<R, A, D>
{
    // Counts only: an event's routines and owners are never span fields.
    // `filtered_out` counts every routine its filters turned away, and
    // `outside_inboxes` those of them only their picked inboxes did. A failure
    // marks the span as an error without its report, which can carry payloads
    // or database values (the Kafka consumer withholds it for the same reason).
    #[tracing::instrument(
        name = "routine.admit_event",
        skip_all,
        fields(
            candidates = tracing::field::Empty,
            filtered_out = tracing::field::Empty,
            outside_inboxes = tracing::field::Empty,
            inserted = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        )
    )]
    async fn ingest(&self, incoming: &IncomingEvent) -> Result<EventIngestionResult, Report> {
        let admitted = self.admit(incoming).await;
        if admitted.is_err() {
            tracing::Span::current().record("otel.status_code", "ERROR");
        }
        admitted
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, D: InboxDelegates>
    EventAdmissionService<R, A, D>
{
    /// Admit `incoming` to every routine it is for, recording the counts on
    /// the current `routine.admit_event` span.
    async fn admit(&self, incoming: &IncomingEvent) -> Result<EventIngestionResult, Report> {
        let event = match incoming.normalize() {
            Ok(event) => event,
            Err(reason) => return Ok(EventIngestionResult::Rejected(reason)),
        };
        let mut audience = Audience::new(incoming);
        let mut after = None;
        let mut inserted = 0;
        let mut candidates_seen = 0_usize;
        let mut filtered_out = 0_usize;
        let mut outside_inboxes = 0_usize;
        loop {
            let candidates = self
                .repository
                .candidate_actions(&event, after, self.page_size)
                .await?;
            let Some(next_after) = candidates.next_after else {
                if !candidates.configurations.is_empty() {
                    return Err(rootcause::report!("event candidate page has no cursor"));
                }
                let span = tracing::Span::current();
                span.record("candidates", candidates_seen);
                span.record("filtered_out", filtered_out + outside_inboxes);
                span.record("outside_inboxes", outside_inboxes);
                span.record("inserted", inserted);
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
                candidates_seen += 1;
                match self
                    .admit_candidate(configuration, &event, &mut audience)
                    .await?
                {
                    CandidateOutcome::Admitted => inserted += 1,
                    CandidateOutcome::FilteredOut => filtered_out += 1,
                    CandidateOutcome::OutsideInboxes => outside_inboxes += 1,
                    CandidateOutcome::Skipped => {}
                }
            }
            after = Some(next_after);
        }
    }
}
