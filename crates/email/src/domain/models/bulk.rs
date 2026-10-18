use chrono::{DateTime, Utc};
use item_filters::ast::{LiteralTree, email::EmailLiteral};
use uuid::Uuid;

use super::preview::PreviewView;

/// Largest page of bulk targets one request may list.
pub const MAX_BULK_THREAD_TARGETS_PAGE: u32 = 500;

/// Largest number of threads one bulk action request may change.
pub const MAX_BULK_THREAD_ACTION_BATCH: usize = 100;

/// A Mail view's query: the mailbox slice and the email filter tree its list
/// sends to Soup. Bulk targets follow the list's own order, newest activity
/// first.
#[derive(Debug, Clone)]
pub struct BulkThreadQuery {
    pub view: PreviewView,
    pub filter: LiteralTree<EmailLiteral>,
}

/// Where a page of bulk targets begins.
#[derive(Debug, Clone)]
pub enum BulkThreadStart {
    /// The first thread in the view.
    Top,
    /// The given thread and everything after it ("select all below"). The
    /// thread must still match the query.
    FromThread(Uuid),
    /// The thread after the last one of a previous page.
    After(BulkThreadCursor),
}

/// The position of a thread in a view's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BulkThreadCursor {
    pub thread_id: Uuid,
    pub sort_ts: DateTime<Utc>,
}

/// A request for one page of a view's threads.
#[derive(Debug, Clone)]
pub struct BulkThreadTargetsRequest {
    pub query: BulkThreadQuery,
    pub start: BulkThreadStart,
    pub limit: u32,
}

/// A thread a bulk action may change, with the state the actions toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BulkThreadTarget {
    pub id: Uuid,
    /// Mail Done: the thread is out of the inbox.
    pub done: bool,
    pub read: bool,
    /// The thread's position in the view; it moves when new mail arrives.
    pub sort_ts: DateTime<Utc>,
}

/// One page of a view's threads. `next` is absent on the last page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BulkThreadTargetsPage {
    pub threads: Vec<BulkThreadTarget>,
    pub next: Option<BulkThreadCursor>,
}

/// An action applied to each thread of a bulk selection. Each is idempotent,
/// and each has an inverse for undo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BulkThreadAction {
    /// Mail Done.
    Archive,
    /// Mark Not Done.
    Unarchive,
    MarkRead,
    MarkUnread,
}

/// The outcome of a bulk action, per thread, in request order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BulkThreadActionResult {
    pub succeeded_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
}
