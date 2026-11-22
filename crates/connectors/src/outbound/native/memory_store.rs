//! An in-memory [`McpServerStore`] for the sources' tests.

use crate::outbound::native::domain::models::{MacroUserIdStr, McpServerRecord};
use crate::outbound::native::domain::ports::McpServerStore;
use std::sync::Mutex;

/// Rows keyed by user and URL as stored, like the `mcp_servers` table.
#[derive(Default)]
pub(crate) struct MemoryStore {
    rows: Mutex<Vec<McpServerRecord>>,
}

impl MemoryStore {
    /// A store holding `rows`.
    pub(crate) fn holding(rows: Vec<McpServerRecord>) -> Self {
        Self {
            rows: Mutex::new(rows),
        }
    }

    /// Every stored row.
    pub(crate) fn rows(&self) -> Vec<McpServerRecord> {
        self.rows.lock().unwrap().clone()
    }
}

impl McpServerStore for MemoryStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        let mut rows = self.rows.lock().unwrap();
        let kept = rows
            .iter()
            .find(|row| row.user_id == record.user_id && row.url == record.url)
            .and_then(|row| row.credentials.clone());
        rows.retain(|row| !(row.user_id == record.user_id && row.url == record.url));
        let mut record = record.clone();
        // As the table does: saving no credentials keeps the stored ones.
        record.credentials = record.credentials.or(kept);
        rows.push(record);
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        Ok(self
            .rows()
            .into_iter()
            .find(|row| row.user_id == *user_id && row.url == server_url))
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        self.rows
            .lock()
            .unwrap()
            .retain(|row| !(row.user_id == *user_id && row.url == server_url));
        Ok(())
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self
            .rows()
            .into_iter()
            .filter(|row| row.user_id == *user_id)
            .collect())
    }
}
