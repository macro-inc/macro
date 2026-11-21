//! CRM contact population on a queue and workers of its own.
//!
//! Inbox sync, backfill and the Outlook projection name the correspondents of
//! every message they store. Populating them on the shared backfill workers
//! let a large CRM backfill hold the workers, database connections and mailbox
//! row locks that inbox sync needs. Producers now record one request per
//! mailbox and address, and send a message only when none is queued for it:
//! a request for a correspondent whose message is still queued merges its
//! hints into the pending entry instead. The queue groups messages by mailbox,
//! so each mailbox runs one population at a time, and the listener never
//! waits for a slot: a refused message is hidden and tried again later.

mod backoff;
mod consume;
mod ports;
mod requests;
#[cfg(test)]
mod test;

pub use consume::*;
pub use ports::*;
pub use requests::*;
