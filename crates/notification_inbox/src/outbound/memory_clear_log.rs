//! The clear log in memory, for tests and single-process use.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use attention_feed::domain::models::DoneReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::{models::ClearProgress, ports::ClearLog};

#[derive(Debug, Default)]
struct Entry {
    rows: usize,
    finished: bool,
    cancelled: bool,
    receipts: Vec<DoneReceipt>,
}

/// [`ClearLog`] in process memory; clones share one log.
#[derive(Clone, Default)]
pub struct MemoryClearLog {
    entries: Arc<Mutex<HashMap<(String, Uuid), Entry>>>,
}

impl MemoryClearLog {
    fn with<T>(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        f: impl FnOnce(&mut Entry) -> T,
    ) -> Option<T> {
        self.entries
            .lock()
            .unwrap()
            .get_mut(&(user.as_ref().to_string(), id))
            .map(f)
    }
}

impl ClearLog for MemoryClearLog {
    async fn begin(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        self.entries
            .lock()
            .unwrap()
            .insert((user.as_ref().to_string(), id), Entry::default());
        Ok(())
    }

    async fn record(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        rows: usize,
        receipt: &DoneReceipt,
    ) -> Result<bool, Report> {
        Ok(self
            .with(user, id, |entry| {
                entry.rows += rows;
                if !receipt.keys.is_empty() {
                    entry.receipts.push(receipt.clone());
                }
                entry.cancelled
            })
            .unwrap_or(false))
    }

    async fn finish(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        self.with(user, id, |entry| entry.finished = true);
        Ok(())
    }

    async fn progress(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<ClearProgress>, Report> {
        Ok(self.with(user, id, |entry| ClearProgress {
            rows: entry.rows,
            finished: entry.finished,
        }))
    }

    async fn cancel(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        self.with(user, id, |entry| entry.cancelled = true);
        Ok(())
    }

    async fn take(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Vec<DoneReceipt>, Report> {
        Ok(self
            .entries
            .lock()
            .unwrap()
            .remove(&(user.as_ref().to_string(), id))
            .map(|entry| entry.receipts)
            .unwrap_or_default())
    }
}
