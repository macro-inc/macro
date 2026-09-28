//! Explicit process-local journal for standalone agents and tests.
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput};
use crate::domain::model::CursorRunId;
use agent_client_protocol::schema::v1::SessionId;
use futures::future::BoxFuture;
use std::{collections::HashMap, sync::Mutex};
/// Process-local storage; production harnesses must inject PostgreSQL storage.
#[derive(Debug, Default)]
pub struct MemoryJournal(Mutex<HashMap<SessionId, Vec<JournalEntry>>>);
impl CursorJournal for MemoryJournal {
    fn read<'a>(
        &'a self,
        session: &'a SessionId,
    ) -> BoxFuture<'a, Result<Vec<JournalEntry>, rootcause::Report>> {
        Box::pin(async move {
            Ok(self
                .0
                .lock()
                .expect("journal poisoned")
                .get(session)
                .cloned()
                .unwrap_or_default())
        })
    }
    fn append<'a>(
        &'a self,
        session: &'a SessionId,
        expected: i64,
        run: Option<&'a CursorRunId>,
        input: &'a JournalInput,
    ) -> BoxFuture<'a, Result<JournalEntry, rootcause::Report>> {
        Box::pin(async move {
            let mut all = self.0.lock().expect("journal poisoned");
            let entries = all.entry(session.clone()).or_default();
            if entries.last().map_or(0, |e| e.sequence) != expected {
                return Err(rootcause::report!("journal writer superseded"));
            }
            let entry = JournalEntry {
                sequence: expected + 1,
                run: run.cloned(),
                input: input.clone(),
            };
            entries.push(entry.clone());
            Ok(entry)
        })
    }
}
