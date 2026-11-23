//! Time tracking mutation fields delegating to the owning domain service.
//!
//! Every reply carries the changed records with their ids: the entry, the
//! task with its new Time logged (read from the primary through Soup), and the
//! viewer's time tracking as stored after a timer change, so a normalized
//! cache updates every view without refetching.

use std::marker::PhantomData;

use async_graphql::{Context, ID, Object};
use graphql_common::{parse_id, require_authenticated_user};
use graphql_soup::SoupEntityEdges;
use time_tracking::domain::models::TimeTrackingError;

use crate::{
    DeleteTimeEntryInput, DeleteTimeEntryPayload, DiscardTimerPayload, GraphqlTimeEntry,
    GraphqlTimeTracking, LogTimeInput, LogTimePayload, StartTimerInput, StartTimerPayload,
    StopTimerInput, StopTimerPayload, TimeTrackingGraphqlContext, UpdateTimeEntryInput,
    UpdateTimeEntryPayload, context::TimeTrackingFailure, graphql_error,
};

/// The noun the domain reports for an entry that is gone or hidden.
const MISSING_ENTRY: &str = "time entry";

/// Root time tracking mutations composed into the complete schema.
pub struct TimeTrackingMutationRoot<E: SoupEntityEdges>(PhantomData<E>);

impl<E: SoupEntityEdges> Default for TimeTrackingMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

/// Log, change and delete time on tasks, and run the viewer's one timer.
#[Object]
impl<E: SoupEntityEdges> TimeTrackingMutationRoot<E> {
    /// Log typed time on a task the viewer can edit. Replaying an `id` returns
    /// the entry the first request stored, so a retried request logs once.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn log_time(
        &self,
        ctx: &Context<'_>,
        input: LogTimeInput,
    ) -> async_graphql::Result<LogTimePayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let (task_id, entry) = input.into_domain()?;
        let logged = ctx
            .data::<TimeTrackingGraphqlContext>()?
            .0
            .log(user.clone(), task_id, entry)
            .await
            .map_err(graphql_error)?;
        Ok(LogTimePayload {
            task_id: logged.entry.task_id.clone(),
            entry: GraphqlTimeEntry::new(logged.entry, &user),
            _edges: PhantomData,
        })
    }

    /// Change one of the viewer's own entries.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn update_time_entry(
        &self,
        ctx: &Context<'_>,
        input: UpdateTimeEntryInput,
    ) -> async_graphql::Result<UpdateTimeEntryPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let (entry_id, changes) = input.into_domain()?;
        let logged = ctx
            .data::<TimeTrackingGraphqlContext>()?
            .0
            .update(user.clone(), entry_id, changes)
            .await
            .map_err(graphql_error)?;
        Ok(UpdateTimeEntryPayload {
            task_id: logged.entry.task_id.clone(),
            entry: GraphqlTimeEntry::new(logged.entry, &user),
            _edges: PhantomData,
        })
    }

    /// Delete one of the viewer's own entries. An entry that is already gone
    /// counts as deleted, so a retried delete settles instead of failing.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn delete_time_entry(
        &self,
        ctx: &Context<'_>,
        input: DeleteTimeEntryInput,
    ) -> async_graphql::Result<DeleteTimeEntryPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let (entry_id, task_id) = input.into_domain()?;
        match ctx
            .data::<TimeTrackingGraphqlContext>()?
            .0
            .delete(user, entry_id)
            .await
        {
            Ok(_)
            | Err(TimeTrackingFailure::Domain(TimeTrackingError::NotFound(MISSING_ENTRY))) => {
                Ok(DeleteTimeEntryPayload {
                    deleted_entry_id: ID(entry_id.to_string()),
                    task_id,
                    _edges: PhantomData,
                })
            }
            Err(failure) => Err(graphql_error(failure)),
        }
    }

    /// Start timing a task the viewer can edit. A timer running on another
    /// task stops and saves its entry in the same step; when that timer ran
    /// past the limit the start is refused with `TIMER_OVER_LIMIT` until the
    /// viewer stops or discards it.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn start_timer(
        &self,
        ctx: &Context<'_>,
        input: StartTimerInput,
    ) -> async_graphql::Result<StartTimerPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let (task_id, start) = input.into_domain()?;
        let api = &ctx.data::<TimeTrackingGraphqlContext>()?.0;
        let started = api
            .start(user.clone(), task_id, start)
            .await
            .map_err(graphql_error)?;
        let state = api.timer(user.clone()).await.map_err(graphql_error)?;
        let stopped_task_id = started
            .stopped
            .as_ref()
            .map(|logged| logged.entry.task_id.clone());
        Ok(StartTimerPayload {
            time_tracking: GraphqlTimeTracking::new(user.clone(), state),
            stopped_entry: started
                .stopped
                .map(|logged| GraphqlTimeEntry::new(logged.entry, &user)),
            stopped_task_id,
        })
    }

    /// Stop the viewer's timer and save its entry. A timer past the limit is
    /// refused with `TIMER_OVER_LIMIT` unless `endedAt` or `logAll` says what
    /// to log. Stopping a timer that already stopped returns its entry; one
    /// that was discarded returns none.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn stop_timer(
        &self,
        ctx: &Context<'_>,
        input: StopTimerInput,
    ) -> async_graphql::Result<StopTimerPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let stop = input.into_domain()?;
        let api = &ctx.data::<TimeTrackingGraphqlContext>()?.0;
        let stopped = api.stop(user.clone(), stop).await.map_err(graphql_error)?;
        let state = api.timer(user.clone()).await.map_err(graphql_error)?;
        Ok(StopTimerPayload {
            time_tracking: GraphqlTimeTracking::new(user.clone(), state),
            entry: stopped
                .logged
                .map(|logged| GraphqlTimeEntry::new(logged.entry, &user)),
        })
    }

    /// Discard the viewer's timer without saving anything.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn discard_timer(
        &self,
        ctx: &Context<'_>,
        timer_id: ID,
    ) -> async_graphql::Result<DiscardTimerPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let timer_id = parse_id(timer_id, "timerId")?;
        let api = &ctx.data::<TimeTrackingGraphqlContext>()?.0;
        api.discard(user.clone(), timer_id)
            .await
            .map_err(graphql_error)?;
        let state = api.timer(user.clone()).await.map_err(graphql_error)?;
        Ok(DiscardTimerPayload {
            time_tracking: GraphqlTimeTracking::new(user, state),
        })
    }
}
