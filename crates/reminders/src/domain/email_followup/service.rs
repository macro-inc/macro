//! Orchestration shared by the email API, generic reminder edits and dispatch.

use super::*;
use crate::domain::ports::{Clock, SystemClock};
use chrono::{DateTime, Utc};
use email::domain::followup::EmailFollowupMailbox;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Email-specialized reminder lifecycle over the existing reminders repository.
#[derive(Clone)]
pub struct EmailFollowupService<R, E, C = SystemClock> {
    /// Shared reminder persistence.
    pub(crate) repo: R,
    /// Email-owned authorization and inbox operations.
    pub(crate) mailbox: E,
    pub(crate) clock: C,
}

impl<R, E> EmailFollowupService<R, E> {
    /// Compose email behavior without importing its outbound adapter.
    pub fn new(repo: R, mailbox: E) -> Self {
        Self {
            repo,
            mailbox,
            clock: SystemClock,
        }
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> ReminderError {
    ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
}

fn conflict() -> ReminderError {
    ReminderError::BadRequest("This email reminder changed. Reopen it before editing.".into())
}

impl<R: EmailFollowupRepo, E: EmailFollowupMailbox, C: Clock> EmailFollowupService<R, E, C> {
    /// Read after reconciling reply/access facts; never expose another user's thread.
    pub async fn get(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
    ) -> Result<Option<EmailFollowup>, ReminderError> {
        let _guard = self.repo.lock_followup(&user, thread).await?;
        let facts = self
            .mailbox
            .followup_thread(user.clone(), thread)
            .await
            .map_err(internal)?
            .ok_or(ReminderError::EntityAccessDenied)?;
        let Some(mut record) = self.repo.thread_followup(&user, thread).await? else {
            return Ok(None);
        };
        if facts.link_id != record.followup.link_id {
            return Err(ReminderError::EntityAccessDenied);
        }
        self.reconcile_locked(&mut record).await?;
        Ok(Some(record.followup))
    }

    /// Persist an idempotent command, then finish its email effect under the lock.
    pub async fn execute(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
        command: EmailFollowupCommand,
    ) -> Result<EmailFollowup, ReminderError> {
        let _guard = self.repo.lock_followup(&user, thread).await?;
        self.execute_locked(user, thread, command).await
    }

    pub(crate) async fn execute_locked(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
        command: EmailFollowupCommand,
    ) -> Result<EmailFollowup, ReminderError> {
        let facts = self
            .mailbox
            .followup_thread(user.clone(), thread)
            .await
            .map_err(internal)?;
        if let Some((reminder_id, previous)) = self
            .repo
            .previous_operation(&user, command.operation_id())
            .await?
        {
            if previous != command {
                return Err(conflict());
            }
            let mut record = self
                .repo
                .reminder_followup(&user, reminder_id)
                .await?
                .ok_or(ReminderError::NotFound)?;
            if record.followup.thread_id != thread {
                return Err(conflict());
            }
            self.reconcile_locked(&mut record).await?;
            return Ok(record.followup);
        }
        let current = self.repo.thread_followup(&user, thread).await?;
        let mut record = match &command {
            EmailFollowupCommand::Set {
                operation_id,
                expected_revision,
                remind_at,
                condition,
            } => {
                let facts = facts
                    .as_ref()
                    .filter(|facts| !facts.unavailable)
                    .ok_or(ReminderError::EntityAccessDenied)?;
                let now = self.clock.now();
                // PostgreSQL timestamps retain microseconds, including seconds-only edits.
                let remind_at = DateTime::from_timestamp_micros(remind_at.timestamp_micros())
                    .unwrap_or(*remind_at);
                if remind_at <= now {
                    return Err(ReminderError::BadRequest(
                        "remindAt must be in the future".into(),
                    ));
                }
                if let Some(mut current) = current.filter(|record| record.followup.state.active()) {
                    if *expected_revision != Some(current.followup.revision) {
                        return Err(conflict());
                    }
                    if current.followup.state != FollowupState::Pending {
                        return Err(conflict());
                    }
                    current.followup.condition = *condition;
                    current.followup.remind_at = remind_at;
                    current.followup.revision = *operation_id;
                    // Editing the time doesn't redefine what counts as a reply.
                    current
                } else {
                    if expected_revision.is_some() {
                        return Err(conflict());
                    }
                    FollowupRecord {
                        followup: EmailFollowup {
                            reminder_id: Uuid::now_v7(),
                            thread_id: thread,
                            link_id: facts.link_id,
                            condition: *condition,
                            remind_at,
                            revision: *operation_id,
                            state: FollowupState::Archiving,
                        },
                        user_id: user,
                        baseline: facts.baseline(now),
                        original_inbox_visible: facts.inbox_visible,
                        restore_inbox_visible: true,
                        cancel_on_restore: false,
                    }
                }
            }
            EmailFollowupCommand::Remove {
                operation_id,
                expected_revision,
                undo,
            } => {
                let mut current = current.ok_or(ReminderError::NotFound)?;
                if current.followup.revision != *expected_revision {
                    return Err(conflict());
                }
                current.followup.revision = *operation_id;
                current.followup.state = if current.followup.state.active()
                    && facts.as_ref().is_some_and(|facts| {
                        !facts.unavailable && facts.link_id == current.followup.link_id
                    }) {
                    FollowupState::Returning
                } else {
                    FollowupState::Removed
                };
                current.cancel_on_restore = false;
                current.restore_inbox_visible = !undo || current.original_inbox_visible;
                current
            }
        };
        let description = facts.as_ref().map(|facts| {
            facts
                .subject
                .chars()
                .take(super::super::models::MAX_DESCRIPTION_LEN)
                .collect::<String>()
        });
        self.repo
            .save_followup(&record, Some(&command), description.as_deref())
            .await?;
        if let Err(error) = self.reconcile_locked(&mut record).await {
            if record.followup.state == FollowupState::Archiving {
                record.followup.state = FollowupState::Returning;
                record.restore_inbox_visible = record.original_inbox_visible;
                self.repo.save_followup(&record, None, None).await?;
                if let Err(restore_error) = self.reconcile_locked(&mut record).await {
                    tracing::error!(error = ?restore_error, reminder_id = %record.followup.reminder_id, "email reminder rollback will retry");
                }
            }
            return Err(error);
        }
        Ok(record.followup)
    }

    /// Retire this exact owned reminder. Historical rows never mutate mail or
    /// another follow-up; the caller retains the dispatch lock through retraction.
    pub(crate) async fn retire_locked(
        &self,
        mut record: FollowupRecord,
    ) -> Result<(), ReminderError> {
        record.followup.revision = Uuid::now_v7();
        record.cancel_on_restore = false;
        record.restore_inbox_visible = true;
        record.followup.state = if record.followup.state.active() {
            FollowupState::Returning
        } else {
            FollowupState::Removed
        };
        self.repo.save_followup(&record, None, None).await?;
        self.reconcile_locked(&mut record).await
    }

    /// Resume stored intent and cancel replied/inaccessible workflows. The caller
    /// holds the user/thread lock until all changes have been persisted.
    pub(crate) async fn reconcile_locked(
        &self,
        record: &mut FollowupRecord,
    ) -> Result<(), ReminderError> {
        if !record.followup.state.active() && record.followup.state != FollowupState::Returned {
            return Ok(());
        }
        let facts = self
            .mailbox
            .followup_thread(record.user_id.clone(), record.followup.thread_id)
            .await
            .map_err(internal)?;
        let Some(facts) =
            facts.filter(|facts| !facts.unavailable && facts.link_id == record.followup.link_id)
        else {
            record.followup.state = FollowupState::Cancelled;
            return self.repo.save_followup(record, None, None).await;
        };
        if matches!(
            record.followup.state,
            FollowupState::Archiving | FollowupState::Pending
        ) && record.followup.condition == EmailReminderCondition::IfNoReply
            && facts.has_reply(&record.baseline)
        {
            // A reply can arrive between the facts read and archive. Persist the
            // restoration before touching mail, so a crash cannot strand that reply.
            record.followup.state = FollowupState::Returning;
            record.restore_inbox_visible = true;
            record.cancel_on_restore = true;
            self.repo.save_followup(record, None, None).await?;
        }
        let (visible, next) = match record.followup.state {
            FollowupState::Archiving => (false, FollowupState::Pending),
            FollowupState::Returning => (
                record.restore_inbox_visible,
                if record.cancel_on_restore {
                    FollowupState::Cancelled
                } else {
                    FollowupState::Removed
                },
            ),
            _ => return Ok(()),
        };
        self.mailbox
            .set_followup_inbox(
                record.user_id.clone(),
                record.followup.thread_id,
                record.followup.link_id,
                visible,
                visible.then(|| self.clock.now()),
            )
            .await
            .map_err(internal)?;
        record.followup.state = next;
        self.repo.save_followup(record, None, None).await
    }

    /// Durable reply cancellation and crash recovery, bounded in page size.
    pub async fn reconcile(&self) -> Result<(), ReminderError> {
        let mut after = None;
        loop {
            let records = self.repo.reconciliation_page(after, 100).await?;
            if records.is_empty() {
                return Ok(());
            }
            for record in records {
                after = Some(record.followup.reminder_id);
                let _guard = self
                    .repo
                    .lock_followup(&record.user_id, record.followup.thread_id)
                    .await?;
                let Some(mut current) = self
                    .repo
                    .reminder_followup(&record.user_id, record.followup.reminder_id)
                    .await?
                else {
                    continue;
                };
                if let Err(error) = self.reconcile_locked(&mut current).await {
                    tracing::error!(error = ?error, reminder_id = %current.followup.reminder_id, "email follow-up reconciliation will retry");
                }
            }
        }
    }

    /// Return an eligible conversation before the existing persistent alert is sent.
    /// Must run under the user/thread lock, retained through notification delivery.
    pub(crate) async fn return_due_locked(
        &self,
        record: &mut FollowupRecord,
        scheduled_for: DateTime<Utc>,
    ) -> Result<bool, ReminderError> {
        self.reconcile_locked(record).await?;
        if record.followup.remind_at != scheduled_for {
            return Ok(false);
        }
        if record.followup.state == FollowupState::Returned {
            return Ok(true);
        }
        if record.followup.state != FollowupState::Pending {
            return Ok(false);
        }
        // Reconciliation immediately above checked stable reply facts, trash,
        // deletion and delegated access. Email repeats its access check on write.
        self.mailbox
            .set_followup_inbox(
                record.user_id.clone(),
                record.followup.thread_id,
                record.followup.link_id,
                true,
                Some(self.clock.now()),
            )
            .await
            .map_err(internal)?;
        record.followup.state = FollowupState::Returned;
        self.repo.save_followup(record, None, None).await?;
        Ok(true)
    }
}
