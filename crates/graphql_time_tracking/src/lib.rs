//! Typed GraphQL inbound adapter for time tracking: a task's time entries, the
//! viewer's running timer, and the mutations that log, change and delete time
//! and start, stop and discard the timer.
#![deny(missing_docs)]

mod context;
mod inputs;
mod loaders;
mod mutation;
mod objects;
mod query;

#[cfg(test)]
mod test;

pub use context::{TimeTrackingAuthorizer, TimeTrackingGraphqlContext};
pub use inputs::{
    DeleteTimeEntryInput, LogTimeInput, StartTimerInput, StopTimerInput, UpdateTimeEntryInput,
};
pub use loaders::{TimeEntriesLoader, load_time_entries, time_entries_loader};
pub use mutation::TimeTrackingMutationRoot;
pub use objects::{
    DeleteTimeEntryPayload, DiscardTimerPayload, GraphqlRunningTimer, GraphqlTimeEntry,
    GraphqlTimeEntryPage, GraphqlTimeEntrySource, GraphqlTimeTracking, LogTimePayload,
    StartTimerPayload, StopTimerPayload, UpdateTimeEntryPayload,
};
pub use query::resolve_time_tracking;

use async_graphql::{ErrorExtensions, Value};
use entity_access::domain::models::AccessError;
use time_tracking::domain::models::{RunningTimer, TimeTrackingError};

use crate::context::TimeTrackingFailure;

/// An error with a machine-readable `code` extension the web reads.
fn coded(message: impl Into<String>, code: &'static str) -> async_graphql::Error {
    async_graphql::Error::new(message.into()).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}

/// A rejected argument.
pub(crate) fn bad_input(message: impl Into<String>) -> async_graphql::Error {
    coded(message, "BAD_USER_INPUT")
}

fn timer_value(timer: &RunningTimer) -> Value {
    async_graphql::value!({
        "id": timer.id.to_string(),
        "taskId": timer.task_id.clone(),
        "startedAt": timer.started_at.to_rfc3339(),
    })
}

/// Preserve actionable domain and access failures while hiding infrastructure
/// details. A timer past the limit carries that timer in the `timer` extension.
pub(crate) fn graphql_error(failure: TimeTrackingFailure) -> async_graphql::Error {
    match failure {
        TimeTrackingFailure::Domain(error) => domain_error(error),
        TimeTrackingFailure::Access(error) => access_error(error),
    }
}

fn domain_error(error: TimeTrackingError) -> async_graphql::Error {
    let message = error.to_string();
    match error {
        TimeTrackingError::NotFound(_) => coded(message, "NOT_FOUND"),
        TimeTrackingError::NotAuthor => coded(message, "NOT_AUTHOR"),
        TimeTrackingError::InvalidInput(_) => coded(message, "BAD_USER_INPUT"),
        TimeTrackingError::TimerOverLimit(timer) => {
            async_graphql::Error::new(message).extend_with(|_, extensions| {
                extensions.set("code", "TIMER_OVER_LIMIT");
                extensions.set("timer", timer_value(&timer));
            })
        }
        TimeTrackingError::Conflict(_) => coded(message, "CONFLICT"),
        TimeTrackingError::Busy => coded(message, "UNAVAILABLE"),
        TimeTrackingError::Internal(report) => {
            tracing::error!(error = ?report, "time tracking GraphQL request failed");
            coded("internal server error", "INTERNAL_SERVER_ERROR")
        }
    }
}

fn access_error(error: AccessError) -> async_graphql::Error {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => coded(
            "you do not have the access this needs on the task",
            "FORBIDDEN",
        ),
        AccessError::NotFound(_) => coded("task not found", "NOT_FOUND"),
        AccessError::BadRequest(message) => coded(message, "BAD_USER_INPUT"),
        AccessError::Unavailable(report) => {
            tracing::warn!(error = ?report, "task access check unavailable");
            coded(
                "the access check is briefly unavailable; try again",
                "UNAVAILABLE",
            )
        }
        AccessError::Internal(report) => {
            tracing::error!(error = ?report, "task access check failed");
            coded("internal server error", "INTERNAL_SERVER_ERROR")
        }
    }
}
