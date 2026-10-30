//! The owner's stored Macro memory as Focus context.

use email::domain::focus::ProfileSource;
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryRepo;
use rootcause::Report;

/// Reads the stored memory and never generates one: generation is a full
/// agent run, and classifying mail must not start it.
pub struct MemoryProfiles<R> {
    repo: R,
}

impl<R> MemoryProfiles<R> {
    /// Read memories from `repo`.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R: MemoryRepo> ProfileSource for MemoryProfiles<R> {
    async fn profile(&self, owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(self
            .repo
            .get_latest_memory(owner.clone())
            .await?
            .map(|record| record.memory))
    }
}
