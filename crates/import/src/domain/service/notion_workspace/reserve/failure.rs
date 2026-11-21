//! Keep run-wide outages separate from source-specific reservation failures.

use super::*;
use crate::domain::models::SourceStopReason;
use crate::domain::ports::DatabaseWriteFailure;
use import_notion::domain::ports::NotionError;

pub(super) enum Failure {
    Permanent(SourceStopReason, NotionDatabaseFallback),
    SourceRetryable(&'static str),
    RunWide(&'static str),
}

/// Safe report text; the wrapper adds the reviewed source title once.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct RunFailure(pub String);

pub(super) fn classify(error: &anyhow::Error) -> Failure {
    for cause in error.chain() {
        if let Some(reason) = cause.downcast_ref::<SourceStopReason>() {
            return Failure::Permanent(*reason, NotionDatabaseFallback::Unresolved);
        }
        if let Some(error) = cause.downcast_ref::<NotionError>() {
            return notion(error);
        }
        if let Some(error) = cause.downcast_ref::<DatabaseWriteFailure>() {
            return match error {
                DatabaseWriteFailure::InvalidSchema => Failure::Permanent(
                    SourceStopReason::DatabaseRejected,
                    NotionDatabaseFallback::Unresolved,
                ),
                DatabaseWriteFailure::NotFound => Failure::Permanent(
                    SourceStopReason::DestinationMissing,
                    NotionDatabaseFallback::NotFound,
                ),
                DatabaseWriteFailure::PermissionDenied => Failure::Permanent(
                    SourceStopReason::DestinationNotPermitted,
                    NotionDatabaseFallback::NoAccess,
                ),
                DatabaseWriteFailure::Conflict => {
                    Failure::SourceRetryable("the source database changed during reservation")
                }
                DatabaseWriteFailure::Authentication => Failure::RunWide(
                    "database service authentication is unavailable; retry this import",
                ),
                DatabaseWriteFailure::Unavailable => {
                    Failure::RunWide("the database service is unavailable; retry this import")
                }
            };
        }
        // Transparent wrappers do not always expose the wrapped error itself
        // through Error::source, so retain its typed scope explicitly.
        if let Some(error) = cause.downcast_ref::<ImportError>() {
            match error {
                ImportError::Notion(error) => return notion(error),
                ImportError::Other(error) => return classify(error),
                _ => {}
            }
        }
    }
    Failure::RunWide(
        "database reservation could not complete because a backing service is unavailable; retry this import",
    )
}

fn notion(error: &NotionError) -> Failure {
    match error {
        NotionError::IncompleteViewList => {
            Failure::SourceRetryable("the source saved-view list is incomplete")
        }
        NotionError::NotFound => Failure::Permanent(
            SourceStopReason::DestinationMissing,
            NotionDatabaseFallback::NotFound,
        ),
        NotionError::Forbidden => Failure::Permanent(
            SourceStopReason::DestinationNotPermitted,
            NotionDatabaseFallback::NoAccess,
        ),
        NotionError::Decode(_)
        | NotionError::Upstream {
            status: 400 | 422, ..
        } => Failure::Permanent(
            SourceStopReason::DatabaseRejected,
            NotionDatabaseFallback::Unresolved,
        ),
        NotionError::Upstream { status: 401, .. } => Failure::RunWide(
            "Notion authentication is unavailable; reconnect Notion and retry this import",
        ),
        NotionError::RateLimited { .. } | NotionError::Upstream { status: 429, .. } => {
            Failure::RunWide("Notion rate limited the request; retry this import")
        }
        NotionError::Upstream { .. } | NotionError::Transport(_) => {
            Failure::RunWide("Notion could not complete the request; retry this import")
        }
    }
}
