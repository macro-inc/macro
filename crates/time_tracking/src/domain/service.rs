//! The time tracking service: who may log, see, change and delete time on a
//! task, and how a person's one timer starts, stops and switches tasks.
//!
//! - Logging time and starting a timer take edit access to the task.
//! - Seeing a task's entries takes view access.
//! - Changing or deleting an entry takes view access and authorship.
//! - A person can always read, stop or discard their own timer.
//! - Every write is refused while the rollout is off for the caller.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::{
    models::{AccessError, EditAccessLevel, EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use tracing::{Level, field::Empty};
use uuid::Uuid;

use crate::domain::{
    events::{TimeEntryChange, TimeEntryEventPublisher, TimeEntryMacroEvent},
    models::{
        DEFAULT_PAGE_LIMIT, EntrySpan, EntryValues, LoggedTime, MAX_PAGE_LIMIT, NewEntryRow,
        NewTimeEntry, RunningTimer, StartTimer, StartedTimer, StopTimer, StoppedTimer,
        TaskTimeTotal, TimeEntry, TimeEntryChanges, TimeEntryCursor, TimeEntryPage,
        TimeEntryPageRequest, TimeEntrySource, TimeTrackingError, TimerEnding, TimerState,
        finish_timer, may_change_entry, timer_start,
    },
    ports::{
        Clock, DeleteEntryOutcome, InsertEntryOutcome, RepositoryError, StartTimerOutcome,
        StopTimerOutcome, SystemClock, TimeTrackingRepository, TimeTrackingRollout,
        UpdateEntryOutcome,
    },
};

/// View access to a task document.
pub type TaskViewReceipt = EntityAccessReceipt<ViewAccessLevel>;

/// Edit access to a task document.
pub type TaskEditReceipt = EntityAccessReceipt<EditAccessLevel>;

/// How many times a start or an edit re-reads what it changes when another
/// device changed it in between.
const WRITE_ATTEMPTS: u8 = 3;

/// The time tracking use cases, called by the HTTP adapter.
pub trait TimeTrackingService: Send + Sync + 'static {
    /// A page of the task's entries, newest day first, with its Time logged.
    fn list_entries(
        &self,
        receipt: &TaskViewReceipt,
        page: TimeEntryPageRequest,
    ) -> impl Future<Output = Result<TimeEntryPage, TimeTrackingError>> + Send;

    /// Log typed time on the task. Replaying the same id returns the stored entry.
    fn log_entry(
        &self,
        receipt: &TaskEditReceipt,
        entry: NewTimeEntry,
    ) -> impl Future<Output = Result<LoggedTime, TimeTrackingError>> + Send;

    /// Change the caller's own entry.
    fn update_entry(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entry_id: Uuid,
        changes: TimeEntryChanges,
    ) -> impl Future<Output = Result<LoggedTime, TimeTrackingError>> + Send;

    /// Delete the caller's own entry.
    fn delete_entry(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entry_id: Uuid,
    ) -> impl Future<Output = Result<TaskTimeTotal, TimeTrackingError>> + Send;

    /// The caller's running timer and the server's clock.
    fn timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<TimerState, TimeTrackingError>> + Send;

    /// Start timing the task, stopping and saving the caller's running timer
    /// on another task in the same transaction.
    fn start_timer(
        &self,
        receipt: &TaskEditReceipt,
        start: StartTimer,
    ) -> impl Future<Output = Result<StartedTimer, TimeTrackingError>> + Send;

    /// Stop the caller's timer and save its entry. Stopping a timer that
    /// already stopped returns the entry it saved; one discarded returns none.
    fn stop_timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
        stop: StopTimer,
    ) -> impl Future<Output = Result<StoppedTimer, TimeTrackingError>> + Send;

    /// Discard the caller's timer without saving anything.
    fn discard_timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
        timer_id: Uuid,
    ) -> impl Future<Output = Result<(), TimeTrackingError>> + Send;
}

/// The time tracking service over a repository, the entity access service, a
/// rollout gate, an event publisher and a clock.
pub struct TimeTrackingServiceImpl<R, A, P, C = SystemClock> {
    repo: R,
    access: Arc<A>,
    rollout: Arc<dyn TimeTrackingRollout>,
    events: P,
    clock: C,
}

impl<R, A, P> TimeTrackingServiceImpl<R, A, P> {
    /// Compose the service with the system clock.
    pub fn new(repo: R, access: Arc<A>, rollout: Arc<dyn TimeTrackingRollout>, events: P) -> Self {
        Self {
            repo,
            access,
            rollout,
            events,
            clock: SystemClock,
        }
    }
}

impl<R, A, P, C> TimeTrackingServiceImpl<R, A, P, C> {
    /// Replace the clock, for tests of timer limits.
    pub fn with_clock<C2: Clock>(self, clock: C2) -> TimeTrackingServiceImpl<R, A, P, C2> {
        TimeTrackingServiceImpl {
            repo: self.repo,
            access: self.access,
            rollout: self.rollout,
            events: self.events,
            clock,
        }
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> TimeTrackingError {
    TimeTrackingError::Internal(rootcause::Report::new(error).into_dynamic())
}

fn repository<E: RepositoryError>(error: E) -> TimeTrackingError {
    if error.is_contended() {
        return TimeTrackingError::Busy;
    }
    internal(error)
}

fn authenticated<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<&MacroUserIdStr<'static>, TimeTrackingError> {
    receipt
        .get_authenticated_user()
        .map_err(|_| TimeTrackingError::NotFound("task"))
}

impl<R, A, P, C> TimeTrackingServiceImpl<R, A, P, C>
where
    R: TimeTrackingRepository,
    A: EntityAccessService,
    P: TimeEntryEventPublisher,
    C: Clock,
{
    async fn require_enabled(&self, user_id: &MacroUserIdStr<'_>) -> Result<(), TimeTrackingError> {
        if self.rollout.enabled_for(user_id).await {
            return Ok(());
        }
        Err(TimeTrackingError::NotFound("time tracking"))
    }

    /// The entry, when the caller can see its task and logged it.
    async fn own_entry(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entry_id: Uuid,
    ) -> Result<TimeEntry, TimeTrackingError> {
        let entry = self
            .repo
            .entry(entry_id)
            .await
            .map_err(repository)?
            .ok_or(TimeTrackingError::NotFound("time entry"))?;

        let access = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user_id,
                None,
                &entry.task_id,
                EntityType::Document,
            )
            .await;
        match access {
            Ok(_) => {}
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_)
                | AccessError::BadRequest(_),
            ) => return Err(TimeTrackingError::NotFound("time entry")),
            Err(error @ (AccessError::Unavailable(_) | AccessError::Internal(_))) => {
                return Err(internal(error));
            }
        }

        if !may_change_entry(&entry, user_id) {
            return Err(TimeTrackingError::NotAuthor);
        }
        Ok(entry)
    }

    async fn total_with(&self, entry: TimeEntry) -> Result<LoggedTime, TimeTrackingError> {
        let total_minutes = self
            .repo
            .task_total(&entry.task_id)
            .await
            .map_err(repository)?;
        Ok(LoggedTime {
            entry,
            total_minutes,
        })
    }

    fn publish_logged(&self, logged: &LoggedTime) {
        self.events
            .publish(TimeEntryMacroEvent::logged(TimeEntryChange::new(
                &logged.entry,
                logged.total_minutes,
            )));
    }
}

impl<R, A, P, C> TimeTrackingService for TimeTrackingServiceImpl<R, A, P, C>
where
    R: TimeTrackingRepository,
    A: EntityAccessService,
    P: TimeEntryEventPublisher,
    C: Clock,
{
    #[tracing::instrument(
        name = "time.list_entries",
        skip_all,
        fields(task_id = %receipt.entity().entity_id, entries = Empty),
        err(level = Level::INFO)
    )]
    async fn list_entries(
        &self,
        receipt: &TaskViewReceipt,
        page: TimeEntryPageRequest,
    ) -> Result<TimeEntryPage, TimeTrackingError> {
        let limit = page.limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        if limit == 0 || limit > MAX_PAGE_LIMIT {
            return Err(TimeTrackingError::InvalidInput(format!(
                "a page lists 1 to {MAX_PAGE_LIMIT} entries"
            )));
        }

        let task_id = &receipt.entity().entity_id;
        // One more than the page tells whether another page follows.
        let mut entries = self
            .repo
            .entries(task_id, u16::from(limit) + 1, page.after)
            .await
            .map_err(repository)?;
        let next_cursor = if entries.len() > usize::from(limit) {
            entries.truncate(usize::from(limit));
            entries.last().map(|entry| TimeEntryCursor {
                date: entry.date,
                id: entry.id,
            })
        } else {
            None
        };
        let total_minutes = self.repo.task_total(task_id).await.map_err(repository)?;

        tracing::Span::current().record("entries", entries.len());
        Ok(TimeEntryPage {
            entries,
            total_minutes,
            next_cursor,
        })
    }

    #[tracing::instrument(
        name = "time.log_entry",
        skip_all,
        fields(
            task_id = %receipt.entity().entity_id,
            entry_id = Empty,
            minutes = i64::from(entry.minutes),
            entry_date = %entry.date,
            source = "manual",
            outcome = Empty,
        ),
        err(level = Level::INFO)
    )]
    async fn log_entry(
        &self,
        receipt: &TaskEditReceipt,
        entry: NewTimeEntry,
    ) -> Result<LoggedTime, TimeTrackingError> {
        let user_id = authenticated(receipt)?;
        self.require_enabled(user_id).await?;

        let span = EntrySpan::from_parts(entry.started_at, entry.ended_at)?;
        let today = self.clock.now().date_naive();
        let values = EntryValues::validate(entry.date, entry.minutes, entry.note, span, today)?;
        let row = NewEntryRow {
            id: entry.id.unwrap_or_else(Uuid::now_v7),
            task_id: receipt.entity().entity_id.clone(),
            user_id: user_id.clone(),
            values,
            source: TimeEntrySource::Manual,
        };
        tracing::Span::current().record("entry_id", tracing::field::display(row.id));

        let outcome = self.repo.insert_entry(&row).await.map_err(repository)?;
        match outcome {
            InsertEntryOutcome::Inserted(logged) => {
                tracing::Span::current().record("outcome", "created");
                self.publish_logged(&logged);
                Ok(logged)
            }
            InsertEntryOutcome::Existing(stored)
                if stored.user_id == row.user_id && stored.task_id == row.task_id =>
            {
                tracing::Span::current().record("outcome", "replayed");
                self.total_with(stored).await
            }
            InsertEntryOutcome::Existing(_) => {
                tracing::Span::current().record("outcome", "id_taken");
                Err(TimeTrackingError::Conflict(
                    "that entry id belongs to another entry",
                ))
            }
            InsertEntryOutcome::TaskUnavailable => {
                tracing::Span::current().record("outcome", "task_unavailable");
                Err(TimeTrackingError::NotFound("task"))
            }
        }
    }

    #[tracing::instrument(
        name = "time.update_entry",
        skip_all,
        fields(entry_id = %entry_id, task_id = Empty, outcome = Empty),
        err(level = Level::INFO)
    )]
    async fn update_entry(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entry_id: Uuid,
        changes: TimeEntryChanges,
    ) -> Result<LoggedTime, TimeTrackingError> {
        self.require_enabled(user_id).await?;
        let entry = self
            .own_entry(user_id, entry_id)
            .await
            .inspect_err(|error| {
                if matches!(error, TimeTrackingError::NotAuthor) {
                    tracing::Span::current().record("outcome", "not_author");
                }
            })?;
        tracing::Span::current().record("task_id", entry.task_id.as_str());

        // The changes merge onto the entry as read; when another edit of it
        // commits first, the repository refuses and the changes merge again
        // onto the newer entry, so an omitted field never restores an old value.
        let mut entry = entry;
        for _ in 0..WRITE_ATTEMPTS {
            let values =
                EntryValues::edited(&entry, changes.clone(), self.clock.now().date_naive())?;
            let outcome = self
                .repo
                .update_entry(entry_id, user_id, &values, entry.updated_at)
                .await
                .map_err(repository)?;
            match outcome {
                UpdateEntryOutcome::Written(logged) => {
                    tracing::Span::current().record("outcome", "updated");
                    self.events
                        .publish(TimeEntryMacroEvent::updated(TimeEntryChange::new(
                            &logged.entry,
                            logged.total_minutes,
                        )));
                    return Ok(logged);
                }
                UpdateEntryOutcome::Changed => {
                    entry = self.own_entry(user_id, entry_id).await?;
                }
                UpdateEntryOutcome::EntryMissing => {
                    return Err(TimeTrackingError::NotFound("time entry"));
                }
                UpdateEntryOutcome::TaskUnavailable => {
                    return Err(TimeTrackingError::NotFound("task"));
                }
            }
        }

        tracing::Span::current().record("outcome", "contended");
        Err(TimeTrackingError::Conflict(
            "the entry changed on another device while saving this edit; try again",
        ))
    }

    #[tracing::instrument(
        name = "time.delete_entry",
        skip_all,
        fields(entry_id = %entry_id, task_id = Empty, outcome = Empty),
        err(level = Level::INFO)
    )]
    async fn delete_entry(
        &self,
        user_id: &MacroUserIdStr<'static>,
        entry_id: Uuid,
    ) -> Result<TaskTimeTotal, TimeTrackingError> {
        self.require_enabled(user_id).await?;
        let entry = self
            .own_entry(user_id, entry_id)
            .await
            .inspect_err(|error| {
                if matches!(error, TimeTrackingError::NotAuthor) {
                    tracing::Span::current().record("outcome", "not_author");
                }
            })?;
        tracing::Span::current().record("task_id", entry.task_id.as_str());

        let outcome = self
            .repo
            .delete_entry(entry_id, user_id)
            .await
            .map_err(repository)?;
        match outcome {
            DeleteEntryOutcome::Deleted(total_minutes) => {
                tracing::Span::current().record("outcome", "deleted");
                self.events
                    .publish(TimeEntryMacroEvent::deleted(TimeEntryChange::new(
                        &entry,
                        total_minutes,
                    )));
                Ok(TaskTimeTotal { total_minutes })
            }
            DeleteEntryOutcome::EntryMissing => Err(TimeTrackingError::NotFound("time entry")),
            DeleteEntryOutcome::TaskUnavailable => Err(TimeTrackingError::NotFound("task")),
        }
    }

    #[tracing::instrument(name = "time.read_timer", skip_all, err)]
    async fn timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<TimerState, TimeTrackingError> {
        let timer = self.repo.timer(user_id).await.map_err(repository)?;
        Ok(TimerState {
            timer,
            server_now: self.clock.now(),
        })
    }

    #[tracing::instrument(
        name = "time.start_timer",
        skip_all,
        fields(
            task_id = %receipt.entity().entity_id,
            timer_id = Empty,
            stopped_previous = Empty,
            outcome = Empty,
        ),
        err(level = Level::INFO)
    )]
    async fn start_timer(
        &self,
        receipt: &TaskEditReceipt,
        start: StartTimer,
    ) -> Result<StartedTimer, TimeTrackingError> {
        let user_id = authenticated(receipt)?;
        self.require_enabled(user_id).await?;

        let now = self.clock.now();
        let timer = RunningTimer {
            id: start.id.unwrap_or_else(Uuid::now_v7),
            task_id: receipt.entity().entity_id.clone(),
            started_at: timer_start(start.started_at, now)?,
        };
        tracing::Span::current().record("timer_id", tracing::field::display(timer.id));

        // Each attempt reads the person's timer and asks the repository to
        // replace exactly that one; another device changing it in between
        // makes the repository refuse, and the next attempt reads it again.
        for _ in 0..WRITE_ATTEMPTS {
            let current = self.repo.timer(user_id).await.map_err(repository)?;
            if let Some(current) = current.as_ref().filter(|current| current.id == timer.id) {
                if current.task_id != timer.task_id {
                    return Err(TimeTrackingError::Conflict(
                        "that timer is running on another task",
                    ));
                }
                tracing::Span::current().record("outcome", "replayed");
                return Ok(StartedTimer {
                    timer: current.clone(),
                    stopped: None,
                });
            }

            let stopped_at = self.clock.now();
            let previous = current
                .as_ref()
                .map(|previous| {
                    finish_timer(
                        previous,
                        user_id,
                        stopped_at,
                        TimerEnding::Now,
                        start.time_zone,
                    )
                })
                .transpose()
                .inspect_err(|error| {
                    if matches!(error, TimeTrackingError::TimerOverLimit(_)) {
                        tracing::Span::current().record("outcome", "over_limit");
                    }
                })?;

            let outcome = self
                .repo
                .start_timer(user_id, &timer, previous.as_ref())
                .await
                .map_err(repository)?;
            match outcome {
                StartTimerOutcome::Started(stopped) => {
                    tracing::Span::current().record("outcome", "started");
                    tracing::Span::current().record("stopped_previous", stopped.is_some());
                    if let Some(logged) = &stopped {
                        self.publish_logged(logged);
                    }
                    return Ok(StartedTimer { timer, stopped });
                }
                StartTimerOutcome::TimerChanged => continue,
                StartTimerOutcome::TaskUnavailable => {
                    return Err(TimeTrackingError::NotFound("task"));
                }
                StartTimerOutcome::IdTaken => {
                    return Err(TimeTrackingError::Conflict(
                        "that timer id belongs to another timer or entry",
                    ));
                }
            }
        }

        tracing::Span::current().record("outcome", "contended");
        Err(TimeTrackingError::Conflict(
            "your timer changed on another device while starting this one; try again",
        ))
    }

    #[tracing::instrument(
        name = "time.stop_timer",
        skip_all,
        fields(
            timer_id = %stop.timer_id,
            task_id = Empty,
            elapsed_seconds = Empty,
            minutes = Empty,
            outcome = Empty,
        ),
        err(level = Level::INFO)
    )]
    async fn stop_timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
        stop: StopTimer,
    ) -> Result<StoppedTimer, TimeTrackingError> {
        self.require_enabled(user_id).await?;

        let now = self.clock.now();
        let running = self
            .repo
            .timer(user_id)
            .await
            .map_err(repository)?
            .filter(|timer| timer.id == stop.timer_id);
        if let Some(timer) = running {
            let span = tracing::Span::current();
            span.record("task_id", timer.task_id.as_str());
            span.record("elapsed_seconds", (now - timer.started_at).num_seconds());

            let row = finish_timer(&timer, user_id, now, stop.ending, stop.time_zone).inspect_err(
                |error| {
                    if matches!(error, TimeTrackingError::TimerOverLimit(_)) {
                        tracing::Span::current().record("outcome", "over_limit");
                    }
                },
            )?;
            span.record("minutes", i64::from(row.values.minutes));

            let outcome = self.repo.stop_timer(&row).await.map_err(repository)?;
            match outcome {
                StopTimerOutcome::Stopped(logged) => {
                    span.record("outcome", "stopped");
                    self.publish_logged(&logged);
                    return Ok(StoppedTimer {
                        logged: Some(logged),
                    });
                }
                StopTimerOutcome::IdTaken => {
                    span.record("outcome", "id_taken");
                    return Err(TimeTrackingError::Conflict(
                        "that timer id belongs to another entry",
                    ));
                }
                StopTimerOutcome::TimerGone => {}
            }
        }

        // The timer is gone: another device stopped it (the entry has its id)
        // or discarded it.
        let saved = self
            .repo
            .entry(stop.timer_id)
            .await
            .map_err(repository)?
            .filter(|entry| entry.user_id == *user_id && entry.source == TimeEntrySource::Timer);
        let logged = match saved {
            Some(entry) => {
                tracing::Span::current().record("outcome", "replayed");
                Some(self.total_with(entry).await?)
            }
            None => {
                tracing::Span::current().record("outcome", "already_discarded");
                None
            }
        };
        Ok(StoppedTimer { logged })
    }

    #[tracing::instrument(
        name = "time.discard_timer",
        skip_all,
        fields(timer_id = %timer_id),
        err(level = Level::INFO)
    )]
    async fn discard_timer(
        &self,
        user_id: &MacroUserIdStr<'static>,
        timer_id: Uuid,
    ) -> Result<(), TimeTrackingError> {
        self.require_enabled(user_id).await?;
        self.repo
            .discard_timer(user_id, timer_id)
            .await
            .map_err(repository)
    }
}
