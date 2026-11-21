//! CRM contact population workers. Producers send one message per pending
//! correspondent to a FIFO queue grouped by mailbox; the email domain runs the
//! population and decides each message's acknowledgement, which this listener
//! performs. Workers use their own database pool, separate from inbox sync's
//! and backfill's.

mod process;
pub mod worker;
