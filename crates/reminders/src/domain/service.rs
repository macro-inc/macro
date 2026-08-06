//! Reminders service implementation.

pub mod dispatch;

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{
    CreateReminder, MAX_DESCRIPTION_LEN, NewReminder, Reminder, ReminderBatch, ReminderCursor,
    ReminderError, ReminderFilter, ReminderPage, ReminderPatch, ReminderSchedule, ReminderUpdate,
    ScheduleUpdate,
};
use crate::domain::ports::{Clock, RemindersRepo, RemindersService, SystemClock};

/// How many storage reads one list request may make while trying to fill a page.
///
/// Only reached when rows cannot be decoded; a normal page costs one read.
const MAX_LIST_BATCHES: usize = 5;

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
        let next_run_at = derive_next_run_at(&schedule, self.clock.now())?;

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
        } = patch;

        let description = description.map(validate_description).transpose()?;
        let schedule = schedule
            .map(|schedule| {
                let next_run_at = derive_next_run_at(&schedule, self.clock.now())?;
                Ok::<_, ReminderError>(ScheduleUpdate {
                    schedule,
                    next_run_at,
                })
            })
            .transpose()?;

        let update = ReminderUpdate {
            description,
            schedule,
            enabled,
        };

        self.repo
            .update_reminder(&user_id, id, &update)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?
            .ok_or(ReminderError::NotFound)
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
