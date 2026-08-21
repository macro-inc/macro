//! Reminders service implementation.

pub mod dispatch;

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{
    CreateReminder, MAX_DESCRIPTION_LEN, MAX_RECURRING_LATENESS, MIN_RECURRING_INTERVAL,
    NewReminder, Reminder, ReminderBatch, ReminderCron, ReminderCursor, ReminderError,
    ReminderFilter, ReminderForSoup, ReminderPage, ReminderPatch, ReminderSchedule, ReminderUpdate,
    ScheduleUpdate, SoupReminderQuery,
};
use crate::domain::ports::{Clock, RemindersRepo, RemindersService, SystemClock};

/// How many storage reads one list request may make while trying to fill a page.
///
/// Only reached when rows cannot be decoded; a normal page costs one read.
const MAX_LIST_BATCHES: usize = 5;

/// How many consecutive gaps the minimum-interval check measures.
///
/// Enough to cover a schedule that clusters several firings and then waits —
/// the shape a single-gap check reads differently depending on the hour the
/// request arrives — without walking a cron that fires yearly out to its
/// hundredth occurrence.
const INTERVAL_SAMPLE_FIRINGS: usize = 8;

/// Concrete reminders service backed by a [RemindersRepo].
#[derive(Debug, Clone)]
pub struct RemindersServiceImpl<R, C = SystemClock> {
    repo: R,
    clock: C,
}

impl<R> RemindersServiceImpl<R, SystemClock>
where
    R: RemindersRepo,
{
    /// Create a reminders service backed by the provided repository, reading
    /// the current time from the system clock.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            clock: SystemClock,
        }
    }
}

impl<R, C> RemindersServiceImpl<R, C>
where
    R: RemindersRepo,
    C: Clock,
{
    /// Create a reminders service with an explicit clock.
    pub fn with_clock(repo: R, clock: C) -> Self {
        Self { repo, clock }
    }
}

/// Trim and bounds-check a description.
///
/// The limit counts characters rather than bytes, so a description of emoji is
/// measured the same way a client would count it.
fn validate_description(description: String) -> Result<String, ReminderError> {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        return Err(ReminderError::BadRequest(
            "description must not be empty".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ReminderError::BadRequest(format!(
            "description must be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    Ok(trimmed.to_string())
}

/// Derive the first firing, rejecting schedules that will never fire.
fn derive_next_run_at(
    schedule: &ReminderSchedule,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, ReminderError> {
    schedule.next_run_after(now).ok_or_else(|| match schedule {
        ReminderSchedule::Once { .. } => {
            ReminderError::BadRequest("remindAt must be in the future".to_string())
        }
        ReminderSchedule::Recurring { .. } => {
            ReminderError::BadRequest("cron has no upcoming firing".to_string())
        }
    })
}

/// Reject a cron that fires more often than [`MIN_RECURRING_INTERVAL`].
///
/// Measured between the next two firings rather than parsed out of the
/// expression, so it holds for every way of writing a too-frequent schedule
/// instead of the handful someone thought to pattern-match. A cron with fewer
/// than two firings left cannot be too frequent, so it passes.
fn validate_recurring_interval(
    cron: &ReminderCron,
    timezone: Tz,
    now: DateTime<Utc>,
) -> Result<(), ReminderError> {
    // Several gaps, not just the next one. A cron's firings need not be evenly
    // spaced — `0 0,4 9 * * *` fires at 09:00 and 09:04 daily — so measuring
    // only the first gap after `now` makes acceptance depend on when the
    // request happened to arrive: rejected at 08:59, accepted at 09:02, for the
    // same schedule.
    let mut previous = match cron.next_run_after(now, timezone) {
        Some(first) => first,
        // Nothing left to fire, so nothing can fire too often.
        None => return Ok(()),
    };

    for _ in 0..INTERVAL_SAMPLE_FIRINGS {
        let Some(next) = cron.next_run_after(previous, timezone) else {
            return Ok(());
        };
        if next - previous < MIN_RECURRING_INTERVAL {
            return Err(ReminderError::BadRequest(format!(
                "a recurring reminder must fire at most once every {} minutes",
                MIN_RECURRING_INTERVAL.num_minutes()
            )));
        }
        previous = next;
    }

    Ok(())
}

/// Check the schedule will fire, then store it at minute granularity.
///
/// Order matters. Flooring first would drag a request inside the current minute
/// back into the past and reject it, but "remind me in thirty seconds" is a
/// legitimate ask — it just fires on the next sweep rather than in thirty
/// seconds, which is what minute granularity means.
fn normalize_schedule(
    schedule: ReminderSchedule,
    now: DateTime<Utc>,
) -> Result<(ReminderSchedule, DateTime<Utc>), ReminderError> {
    let derived = derive_next_run_at(&schedule, now)?;
    let schedule = schedule.floored_to_minute();
    let next_run_at = match &schedule {
        // Same instant the schedule now carries, so the two cannot disagree.
        ReminderSchedule::Once { remind_at } => *remind_at,
        // A cron's seconds are the owner's, so its firing is left as derived.
        ReminderSchedule::Recurring { cron, timezone } => {
            validate_recurring_interval(cron, *timezone, now)?;
            derived
        }
    };
    Ok((schedule, next_run_at))
}

/// The entity a reminder attaches to, taken from the access receipt.
///
/// The receipt is the only source. A caller cannot name an entity it has not
/// proven access to, because there is nowhere else to put the id — which is
/// the point of taking a receipt rather than an entity: the type makes the
/// access check unskippable instead of merely expected.
fn resolve_entity(
    user_id: &MacroUserIdStr<'_>,
    entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
) -> Result<Option<Entity<'static>>, ReminderError> {
    let Some(receipt) = entity_receipt else {
        return Ok(None);
    };

    // The receipt proves access for whoever it was minted for; it must be this
    // caller, or one user could attach a reminder using another's receipt.
    let receipt_user = receipt
        .get_authenticated_user()
        .map_err(|_| ReminderError::EntityAccessDenied)?;
    if receipt_user.as_ref() != user_id.as_ref() {
        return Err(ReminderError::EntityAccessDenied);
    }

    let entity = receipt.entity();
    Ok(Some(
        entity
            .entity_type
            .with_entity_string(entity.entity_id.clone()),
    ))
}

/// The owner and reminder id a receipt was minted for.
///
/// Both come off the receipt so a caller cannot address one reminder while
/// holding proof for another. The repo stays user-scoped on top of this: the
/// receipt says who proved what, the `WHERE user_id` says what the query may
/// touch.
fn receipt_owner_and_id(
    receipt: &EntityAccessReceipt<OwnerAccessLevel>,
) -> Result<(MacroUserIdStr<'static>, Uuid), ReminderError> {
    let user_id = receipt
        .get_authenticated_user()
        .map_err(|_| ReminderError::NotFound)?
        .clone();
    let id = receipt
        .entity()
        .entity_id
        .parse::<Uuid>()
        .map_err(|_| ReminderError::NotFound)?;
    Ok((user_id, id))
}

impl<R, C> RemindersServiceImpl<R, C>
where
    R: RemindersRepo,
    C: Clock,
{
    /// Pull a revived recurring reminder's firing back into the future.
    ///
    /// A reminder that spent three months disabled still carries the firing it
    /// had when it went quiet, so switching it back on would leave the row
    /// reading "next run: March". Dispatch would sort that out on its own — a
    /// firing that stale is rolled forward rather than delivered — but not
    /// before the owner had seen a date from the past presented as upcoming.
    ///
    /// Deliberately narrow. It runs only when the patch is what revived the
    /// reminder, and only on a firing older than [`MAX_RECURRING_LATENESS`],
    /// which is far older than one merely waiting its turn in the queue. A
    /// broader rule would eventually move a firing that was seconds away from
    /// being delivered, and the delivery already in flight would find the time
    /// changed under it and drop the notification.
    async fn refresh_revived_recurring(
        &self,
        user_id: &MacroUserIdStr<'_>,
        reminder: Reminder,
        patch_revived: bool,
    ) -> Result<Reminder, ReminderError> {
        if !patch_revived || !reminder.enabled || reminder.completed_at.is_some() {
            return Ok(reminder);
        }

        let ReminderSchedule::Recurring { cron, timezone } = &reminder.schedule else {
            return Ok(reminder);
        };

        let now = self.clock.now();
        if now - reminder.next_run_at <= MAX_RECURRING_LATENESS {
            return Ok(reminder);
        }

        let Some(next_run_at) = cron.next_run_after(now, *timezone) else {
            return Ok(reminder);
        };

        let update = ReminderUpdate {
            schedule: Some(ScheduleUpdate {
                schedule: reminder.schedule.clone(),
                next_run_at,
            }),
            ..Default::default()
        };

        // A failure here leaves a stale `next_run_at`, which dispatch corrects
        // on its own. Not worth failing the owner's edit over.
        match self
            .repo
            .update_reminder(user_id, reminder.id, &update)
            .await
        {
            Ok(Some(refreshed)) => Ok(refreshed),
            Ok(None) => Ok(reminder),
            Err(e) => {
                tracing::error!(
                    error = ?e,
                    reminder_id = %reminder.id,
                    "failed to refresh a revived recurring reminder's next firing",
                );
                Ok(reminder)
            }
        }
    }
}

impl<R, C> RemindersService for RemindersServiceImpl<R, C>
where
    R: RemindersRepo,
    C: Clock,
{
    // `user_id` is the auth-provider composite id (it embeds the user's email)
    // and `request`/`patch` carry the user-authored description, so neither is
    // recorded as a span field.
    #[tracing::instrument(err, skip(self, user_id, request, entity_receipt))]
    async fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateReminder,
        entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> Result<Reminder, ReminderError> {
        let CreateReminder {
            description,
            schedule,
        } = request;

        let description = validate_description(description)?;
        let entity = resolve_entity(user_id, entity_receipt)?;
        let (schedule, next_run_at) = normalize_schedule(schedule, self.clock.now())?;

        let new = NewReminder {
            description,
            entity,
            schedule,
            next_run_at,
        };

        Ok(self
            .repo
            .create_reminder(user_id, &new)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?)
    }

    #[tracing::instrument(err, skip(self, receipt))]
    async fn get_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Reminder, ReminderError> {
        let (user_id, id) = receipt_owner_and_id(&receipt)?;
        self.repo
            .get_reminder(&user_id, id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?
            .ok_or(ReminderError::NotFound)
    }

    #[tracing::instrument(err, skip(self, user_id))]
    async fn list_reminders(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: ReminderFilter,
    ) -> Result<ReminderPage, ReminderError> {
        let page_size = filter.page_size() as usize;
        // One extra row answers "is there another page?" without a count query.
        let probe_limit = i64::from(filter.page_size()) + 1;

        let mut reminders: Vec<Reminder> = Vec::new();
        let mut cursor = filter.cursor;
        let mut next_cursor = None;

        // Undecodable rows are skipped, which would otherwise hand the client a
        // short — possibly empty — page even though readable rows remain. Read
        // again from where the last batch stopped so a page is either full or
        // final, and clients can treat "no cursor" as the only end condition.
        // Bounded so a long run of bad rows degrades into a short page rather
        // than an unbounded scan.
        for _ in 0..MAX_LIST_BATCHES {
            let probe = ReminderFilter {
                cursor,
                ..filter.clone()
            };
            let batch = self
                .repo
                .list_reminders(user_id, &probe, probe_limit)
                .await
                .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

            // `examined`, not the decoded count: a batch whose extra row could
            // not be decoded still proves more rows exist.
            let has_more = batch.examined() > page_size;
            let ReminderBatch {
                reminders: decoded,
                last_examined,
                ..
            } = batch;

            let exhausted = !has_more;
            reminders.extend(decoded);

            if reminders.len() > page_size {
                // The probe row is a reminder we are about to drop, so resume
                // from the last row we actually return.
                reminders.truncate(page_size);
                next_cursor = reminders.last().map(ReminderCursor::after);
                break;
            }

            if exhausted {
                // Nothing further matches the filter at all.
                next_cursor = None;
                break;
            }

            // More rows exist. Resume past everything read, including rows that
            // could not be decoded, so they cannot stall pagination.
            cursor = last_examined;
            next_cursor = last_examined;

            if reminders.len() == page_size {
                break;
            }
        }

        Ok(ReminderPage {
            reminders,
            next_cursor,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_reminders_for_soup(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, ReminderError> {
        // No re-probing on undecodable rows: Soup merges many item types and
        // owns its own pagination, so a short slice is not a short page.
        self.repo
            .list_reminders_for_soup(user_id, query)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())
            .map_err(ReminderError::from)
    }

    #[tracing::instrument(err, skip(self, receipt, patch))]
    async fn update_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        patch: ReminderPatch,
    ) -> Result<Reminder, ReminderError> {
        let (user_id, id) = receipt_owner_and_id(&receipt)?;
        if patch.is_empty() {
            return Err(ReminderError::BadRequest("no fields to update".to_string()));
        }

        let ReminderPatch {
            description,
            schedule,
            enabled,
            completed,
        } = patch;

        let description = description.map(validate_description).transpose()?;
        let schedule = schedule
            .map(|schedule| {
                let (schedule, next_run_at) = normalize_schedule(schedule, self.clock.now())?;
                Ok::<_, ReminderError>(ScheduleUpdate {
                    schedule,
                    next_run_at,
                })
            })
            .transpose()?;

        // Whether this patch is what brought the reminder back into service. An
        // explicit schedule is not a revival: the owner named a firing, and
        // recomputing one over the top of it would discard what they chose.
        //
        // `enabled` is the only thing that can freeze a series. Completion no
        // longer stops a recurring reminder coming due — it settles one firing,
        // not the arrangement — so its `next_run_at` keeps advancing while
        // completed and cannot go stale that way.
        let patch_revived = schedule.is_none() && enabled == Some(true);

        let update = ReminderUpdate {
            description,
            schedule,
            enabled,
            completed,
        };

        let updated = self
            .repo
            .update_reminder(&user_id, id, &update)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?
            .ok_or(ReminderError::NotFound)?;

        self.refresh_revived_recurring(&user_id, updated, patch_revived)
            .await
    }

    #[tracing::instrument(err, skip(self, receipt))]
    async fn delete_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ReminderError> {
        let (user_id, id) = receipt_owner_and_id(&receipt)?;
        let deleted = self
            .repo
            .delete_reminder(&user_id, id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if deleted {
            Ok(())
        } else {
            Err(ReminderError::NotFound)
        }
    }
}

/// No-op [`RemindersService`] for binaries that need to satisfy the bound but
/// never surface reminders — the AI-facing services, whose tool surfaces
/// force-filter reminders out anyway. `list_reminders_for_soup` returns empty;
/// every other method panics. Swap for [`RemindersServiceImpl`] if you actually
/// need reminders.
#[derive(Clone, Debug)]
pub struct NoOpRemindersService;

impl RemindersService for NoOpRemindersService {
    async fn create_reminder(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _request: CreateReminder,
        _entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("NoOpRemindersService.create_reminder")
    }

    async fn get_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("NoOpRemindersService.get_reminder")
    }

    async fn list_reminders(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _filter: ReminderFilter,
    ) -> Result<ReminderPage, ReminderError> {
        unimplemented!("NoOpRemindersService.list_reminders")
    }

    async fn list_reminders_for_soup(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, ReminderError> {
        Ok(Vec::new())
    }

    async fn update_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _patch: ReminderPatch,
    ) -> Result<Reminder, ReminderError> {
        unimplemented!("NoOpRemindersService.update_reminder")
    }

    async fn delete_reminder(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ReminderError> {
        unimplemented!("NoOpRemindersService.delete_reminder")
    }
}
