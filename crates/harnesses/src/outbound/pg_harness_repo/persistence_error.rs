//! Failures from hosted registration and harness metadata persistence.
#[derive(Debug, thiserror::Error)]
pub(super) enum HarnessPersistenceError {
    #[error("a hosted pairing needs the harness's computer id")]
    MissingComputer,
    #[error("{0}")]
    Internal(rootcause::Report),
}
