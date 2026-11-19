//! Granola meetings as the call import recorded them, and whether the user's
//! Granola connection syncs.

use std::sync::Arc;

use call::domain::imports::{CallImportService, ImportedCallRecord};
use call::domain::records::CallProvider;
use granola_sync::domain::ports::Accounts;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::GranolaMeetings;

/// [`GranolaMeetings`] over the call import and Granola's accounts.
#[derive(Clone)]
pub struct ImportedGranolaMeetings {
    calls: Arc<dyn CallImportService>,
    accounts: Arc<dyn Accounts>,
}

impl ImportedGranolaMeetings {
    /// Meetings from `calls`, connections from `accounts`.
    pub fn new(calls: Arc<dyn CallImportService>, accounts: Arc<dyn Accounts>) -> Self {
        Self { calls, accounts }
    }
}

impl GranolaMeetings for ImportedGranolaMeetings {
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        Ok(self.accounts.account(user).await?.is_some())
    }

    async fn meetings(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report> {
        self.calls
            .list_source_records(user, CallProvider::Granola)
            .await
    }
}
