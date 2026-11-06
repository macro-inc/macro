//! What the inbox needs beyond the shared feed layer.

use std::future::Future;

use attention_feed::domain::models::DoneReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use super::models::{ClearProgress, ClearStep};

/// Where a running clear records what it changed, so one token undoes the
/// whole clear from any server, after the request that started it has
/// ended. Entries expire on their own once undo is no longer offered.
pub trait ClearLog: Send + Sync + 'static {
    /// Open the log for clear `id`.
    fn begin(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Record one batch: the rows it cleared and what it changed, unless the
    /// log is gone (undone, or expired). Returns what the clear does next.
    fn record(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        rows: usize,
        receipt: &DoneReceipt,
    ) -> impl Future<Output = Result<ClearStep, Report>> + Send;

    /// Mark the clear stopped; its log is complete.
    fn finish(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// How far the clear has got; `None` for an unknown or expired clear.
    fn progress(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<ClearProgress>, Report>> + Send;

    /// Ask a running clear to stop after its current batch.
    fn cancel(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Everything the clear changed, as recorded so far.
    fn receipts(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<Vec<DoneReceipt>, Report>> + Send;

    /// Delete the log once its undo is done, so the clear is undone once.
    fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
