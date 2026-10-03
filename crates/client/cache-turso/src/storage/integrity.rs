use super::{TursoStorage, driver, required_text};
use crate::{PhysicalResetReason, TursoStorageError};
use turso_core::Value;

impl TursoStorage {
    /// Explicitly scans the database with `PRAGMA quick_check`.
    ///
    /// This synchronous diagnostic visits all cached data and must stay off the
    /// startup and foreground-read paths. Normal opens still validate schema,
    /// scope/version metadata, and queued writes. This method never resets or
    /// deletes storage; integrity failures latch the normal reset-required state.
    pub fn check_integrity(&self) -> Result<(), TursoStorageError> {
        self.require_healthy()?;
        self.latch_result(
            driver::query(&self.connection(), "PRAGMA quick_check", Vec::new())
                .and_then(|rows| validate_quick_check_rows(&rows)),
        )
    }
}

fn validate_quick_check_rows(rows: &[Vec<Value>]) -> Result<(), TursoStorageError> {
    if rows.len() == 1
        && rows[0].len() == 1
        && required_text(&rows[0], 0).ok().as_deref() == Some("ok")
    {
        Ok(())
    } else {
        Err(TursoStorageError::reset(PhysicalResetReason::Integrity))
    }
}

#[cfg(test)]
mod test;
