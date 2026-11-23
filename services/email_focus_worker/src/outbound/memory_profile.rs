//! The owner's stored Macro memory and calendar time zone as Focus context.

use calendar_events::domain::ports::CalendarRepository;
use email::domain::focus::ProfileSource;
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryRepo;
use rootcause::Report;

/// Reads the stored memory and never generates one: generation is a full
/// agent run, and classifying mail must not start it.
pub struct MemoryProfiles<R, C> {
    repo: R,
    calendars: C,
}

impl<R, C> MemoryProfiles<R, C> {
    /// Read memories from `repo` and time zones from `calendars`.
    pub fn new(repo: R, calendars: C) -> Self {
        Self { repo, calendars }
    }
}

impl<R: MemoryRepo, C: CalendarRepository> ProfileSource for MemoryProfiles<R, C> {
    async fn profile(&self, owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(self
            .repo
            .get_latest_memory(owner.clone())
            .await?
            .map(|record| record.memory))
    }

    async fn time_zone(&self, owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        self.calendars.primary_time_zone(owner.as_ref()).await
    }
}
