//! An in-memory [`McpServerStore`] for the sources' tests.

use crate::outbound::native::models::{MacroUserIdStr, McpServerRecord};
use crate::outbound::native::ports::McpServerStore;
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
        let held = rows
            .iter()
            .find(|row| row.user_id == record.user_id && row.url == record.url)
            .map(|row| (row.credentials.clone(), row.requires_sign_in));
        rows.retain(|row| !(row.user_id == record.user_id && row.url == record.url));
        let mut record = record.clone();
        // As the table does: saving no credentials keeps the stored ones,
        // and the stored sign-in mark with them.
        if record.credentials.is_none()
            && let Some((credentials, requires_sign_in)) = held
        {
            record.credentials = credentials;
            record.requires_sign_in = requires_sign_in;
        }
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

    async fn mark_requires_sign_in(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        for row in self.rows.lock().unwrap().iter_mut() {
            if row.user_id == *user_id && row.url == server_url && row.credentials.is_none() {
                row.requires_sign_in = true;
            }
        }
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
