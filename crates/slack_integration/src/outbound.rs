//! External adapters for the import domain.

#[cfg(all(
    test,
    any(
        feature = "s3",
        feature = "sqs",
        feature = "gateway",
        feature = "search"
    )
))]
mod test_support;

#[cfg(feature = "gateway")]
pub mod gateway_notifier;
#[cfg(feature = "ledger")]
pub mod import_ledger;
#[cfg(feature = "postgres")]
pub mod pg_slack_import_repo;
#[cfg(feature = "s3")]
pub mod s3_storage;
#[cfg(feature = "search")]
pub mod search_backfill;
#[cfg(feature = "sqs")]
pub mod sqs_queue;
