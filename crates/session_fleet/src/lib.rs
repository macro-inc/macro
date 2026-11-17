#![deny(missing_docs)]
//! A fleet of session-service replicas sharing provider accounts: each
//! account runs on whichever replica holds its Postgres advisory lock. The
//! supervisor takes free accounts on rescan and on `NOTIFY`, forwards signals
//! to each account's runner, and on SIGTERM hands accounts over in batches;
//! losing the lock connection stops every account. Used by the WhatsApp and
//! Slack session services, which supply the runner, the account directory and
//! their signal channels.

pub mod listener;
pub mod locks;
pub mod ports;
pub mod supervisor;
