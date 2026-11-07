//! Deterministic client synchronization. Hosts execute effects and supply both clocks.
#![deny(missing_docs)]

pub use sync_doc_id::SyncDocId;

mod values;
pub use values::*;
mod config;
pub use config::*;
mod document;
pub use document::*;
mod input;
pub use input::*;
mod output;
pub use output::*;
mod storage;
pub use storage::*;
mod wal;
pub use wal::*;

#[cfg(test)]
mod test;

mod connection;
pub use connection::{Connection, Heartbeat};
mod peers;
pub use peers::*;


mod presence;
pub use presence::*;

mod router;
pub use router::*;
