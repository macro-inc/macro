//! Keep run-wide outages separate from source-specific reservation failures.

use super::*;
use crate::domain::models::SourceStopReason;
use crate::domain::ports::DatabaseWriteFailure;
use import_notion::domain::ports::NotionError;

pub(super) enum Failure {
    Permanent(SourceStopReason, NotionDatabaseFallback),
    SourceRetryable(&'static str),
    RunWide(&'static str),
    Unexpected,
    NotionUnavailable,
}

/// Safe report text; the wrapper adds the reviewed source title once.
#[derive(Debug, thiserror::Error)]
#[error("{reason}")]
pub(super) struct RunFailure {
    pub reason: String,
    pub error_type: &'static str,
    pub unexpected: bool,
}

#[derive(Clone, Copy)]
pub(super) enum DeferredKind {
    Unexpected,
    NotionUnavailable,
}

pub(super) struct Deferred {
    pub kind: DeferredKind,
    pub error_type: &'static str,
}

/// Content-free diagnostic names; never format a provider or metadata error.
pub(super) fn error_type(error: &anyhow::Error) -> &'static str {
    for cause in error.chain() {
        if let Some(error) = cause.downcast_ref::<RunFailure>() {
            return error.error_type;
        }
        if cause.is::<write::Cancelled>() {
            return "cancelled";
        }
        if cause.is::<serde_json::Error>() {
            return "serde_json::Error";
        }
        if cause.is::<uuid::Error>() {
            return "uuid::Error";
        }
        if cause.is::<SourceStopReason>() {
            return "SourceStopReason";
        }
        if cause.is::<NotionError>() {
            return "NotionError";
        }
        if let Some(error) = cause.downcast_ref::<DatabaseWriteFailure>() {
            return match error {
                DatabaseWriteFailure::FolderUnavailable => "folder_access",
                DatabaseWriteFailure::MissingStarterTable => "missing_starter_table",
                DatabaseWriteFailure::MissingTitleColumn => "missing_title_column",
                _ => "DatabaseWriteFailure",
            };
        }
        if let Some(error) = cause.downcast_ref::<ImportError>() {
            return match error {
                ImportError::Other(error) => error_type(error),
                ImportError::Metadata(_) => "serde_json::Error",
                ImportError::Db(_) => "ImportError::Db",
                ImportError::Notion(_) => "NotionError",
                _ => "ImportError",
            };
        }
    }
    "unexpected_reservation_error"
}

pub(super) fn named(item: &write::WriteItem, error: ImportError) -> ImportError {
    if matches!(&error, ImportError::Other(error) if error.is::<write::Cancelled>()) {
        return error;
    }
    let (reason, unexpected) = match &error {
        ImportError::Other(error) => error
            .downcast_ref::<RunFailure>()
            .map(|error| (error.reason.as_str(), error.unexpected))
            .unwrap_or(("Retry this import.", true)),
        _ => ("Retry this import.", true),
    };
    let title = if item.title.trim().is_empty() {
        plan::UNTITLED_DATABASE
    } else {
        &item.title
    };
    let punctuation = if reason.ends_with(['.', '!', '?']) {
        ""
    } else {
        "."
    };
    if unexpected {
        ImportError::Other(anyhow::anyhow!(
            "An unexpected error stopped {title}. {reason}{punctuation}"
        ))
    } else {
        ImportError::Other(anyhow::anyhow!("Database “{title}”: {reason}{punctuation}"))
    }
}

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
                DatabaseWriteFailure::MissingStarterTable => Failure::Permanent(
                    SourceStopReason::RecordedTableMissing,
                    NotionDatabaseFallback::Unresolved,
                ),
                DatabaseWriteFailure::MissingTitleColumn | DatabaseWriteFailure::InvalidSchema => {
                    Failure::Permanent(
                        SourceStopReason::DatabaseRejected,
                        NotionDatabaseFallback::Unresolved,
                    )
                }
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
                DatabaseWriteFailure::FolderUnavailable => Failure::RunWide(
                    "the import folder is inaccessible; access will be checked again on retry",
                ),
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
                ImportError::Db(_) => {
                    return Failure::RunWide("import storage is unavailable; retry this import");
                }
                _ => {}
            }
        }
    }
    Failure::Unexpected
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
            "Notion authentication is unavailable. Reconnect Notion and retry this import",
        ),
        NotionError::RateLimited { .. } | NotionError::Upstream { status: 429, .. } => {
            Failure::RunWide("Notion rate limited the request; retry this import")
        }
        NotionError::Upstream {
            status: 500..=599, ..
        }
        | NotionError::Transport(_) => Failure::NotionUnavailable,
        NotionError::Upstream { .. } => {
            Failure::RunWide("Notion could not complete the request; retry this import")
        }
    }
}

/// Only static diagnostic identifiers enter traces; report titles never do.
pub(super) fn record(error_type: &'static str, source: &NotionId) {
    tracing::Span::current().record("error_type", error_type);
    tracing::warn!(source_id = %source, error_type, "database reservation failed");
}

#[tracing::instrument(name = "notion.resolve_source_failure", skip_all, fields(source_id = %item.notion_id, error_type = cause.error_type, attempts = tracing::field::Empty))]
pub(super) async fn spend<Store: WrittenObjects>(
    item: &write::WriteItem,
    progress: &write::Progress<'_, Store>,
    cause: Deferred,
) -> Result<ReservedSource> {
    let unexpected = matches!(cause.kind, DeferredKind::Unexpected);
    let reason = if unexpected {
        "Retry this import."
    } else {
        "Notion could not read this source while another source responded; retry this import"
    };
    spend_budget(item, progress, reason, cause.error_type, unexpected).await
}

pub(super) async fn spend_retryable<Store: WrittenObjects>(
    item: &write::WriteItem,
    progress: &write::Progress<'_, Store>,
    reason: &'static str,
    error_type: &'static str,
) -> Result<ReservedSource> {
    spend_budget(item, progress, reason, error_type, false).await
}

async fn spend_budget<Store: WrittenObjects>(
    item: &write::WriteItem,
    progress: &write::Progress<'_, Store>,
    reason: &'static str,
    error_type: &'static str,
    unexpected: bool,
) -> Result<ReservedSource> {
    let attempts = progress.reservation_failure().await?;
    tracing::Span::current().record("attempts", attempts as i64);
    if attempts < write::RESERVATION_ATTEMPTS {
        return Err(ImportError::Other(
            RunFailure {
                reason: format!(
                    "{reason} Attempt {attempts} of {}.",
                    write::RESERVATION_ATTEMPTS
                ),
                error_type,
                unexpected,
            }
            .into(),
        ));
    }
    let stop = if unexpected {
        SourceStopReason::UnexpectedReservationErrors
    } else {
        SourceStopReason::ReservationRetriesExhausted
    };
    degrade(item, progress, stop, error_type).await
}

/// With no health proof, wait for three observations spanning a full day.
#[tracing::instrument(name = "notion.wait_source_outage", skip_all, fields(source_id = %item.notion_id, error_type, observations = tracing::field::Empty, age_seconds = tracing::field::Empty))]
pub(super) async fn without_peer<Store: WrittenObjects>(
    item: &write::WriteItem,
    progress: &write::Progress<'_, Store>,
    now: chrono::DateTime<chrono::Utc>,
    review_id: Uuid,
    error_type: &'static str,
) -> Result<ReservedSource> {
    if progress.prolonged_notion_failure(now, review_id).await? {
        return degrade(
            item,
            progress,
            SourceStopReason::NotionPersistentFailure,
            error_type,
        )
        .await;
    }
    Err(ImportError::Other(
        RunFailure {
            reason: "Notion could not complete the request; retry this import".into(),
            error_type,
            unexpected: false,
        }
        .into(),
    ))
}

async fn degrade<Store: WrittenObjects>(
    item: &write::WriteItem,
    progress: &write::Progress<'_, Store>,
    stop: SourceStopReason,
    error_type: &'static str,
) -> Result<ReservedSource> {
    progress.degrade_reservation(stop).await?;
    progress.source_stopped(&item.title, stop).await?;
    progress.flush_warnings().await?;
    Ok(ReservedSource {
        destination: Some(DatabaseDestination::Fallback(
            NotionDatabaseFallback::Unresolved,
        )),
        failure: Some(stop.to_string()),
        error_type: Some(error_type),
        ..Default::default()
    })
}

/// Claim failures keep their run-wide scope and name the failing phase.
pub(super) fn claim_failure(error: ImportError) -> anyhow::Error {
    let error = error.into();
    RunFailure {
        reason: "the team-object claim failed; retry this import".into(),
        error_type: error_type(&error),
        unexpected: false,
    }
    .into()
}

#[cfg(test)]
mod test {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Log(Arc<Mutex<Vec<u8>>>);
    impl Write for Log {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn diagnostic_types_and_source_ids_are_searchable_without_error_content() {
        let output = Log::default();
        let writer = output.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .without_time()
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .with_writer(move || writer.clone())
            .finish();
        let source = NotionId::parse("dddddddddddddddddddddddddddddddd").unwrap();
        tracing::subscriber::with_default(subscriber, || {
            for error in [
                anyhow::anyhow!("private title and private payload"),
                serde_json::from_str::<Vec<String>>("\"private title and private payload\"")
                    .unwrap_err()
                    .into(),
            ] {
                let span = tracing::info_span!("notion.reserve_database", source_id = %source, error_type = tracing::field::Empty);
                let _entered = span.enter();
                record(error_type(&error), &source);
            }
        });
        let text = String::from_utf8(output.0.lock().unwrap().clone()).unwrap();
        assert!(
            text.contains("error_type")
                && text.contains("unexpected_reservation_error")
                && text.contains("serde_json::Error"),
            "{text}"
        );
        assert!(text.contains(source.as_str()), "{text}");
        assert!(
            !text.contains("private title") && !text.contains("private payload"),
            "{text}"
        );
    }

    #[test]
    fn audit_sustained_team_claim_failure_is_named_and_run_wide() {
        let error = claim_failure(ImportError::NotReady(
            "The team's copy changed; import again.",
        ));
        let failure = error
            .downcast_ref::<RunFailure>()
            .expect("claim errors must retain run-wide scope");
        assert!(!failure.unexpected);
        assert!(failure.reason.contains("team-object claim"));
        assert!(!failure.reason.contains("database service"));
    }
}
