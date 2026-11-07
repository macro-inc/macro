//! Deterministic client sync contracts. Hosts execute effects and supply both clocks.
//! Connection and convergence state machines are implemented separately from these values.
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
