//! Sans-I/O document sessions with editor and generic collaborative surfaces.
#![deny(missing_docs)]

pub use doc_sync_core::{Access, Now, PeerRange, RequestId, SyncConfig, SyncInput};

mod error;
pub use error::*;
mod generic;
pub use generic::*;
mod editor;
pub use editor::*;
mod session;
pub use session::*;
#[cfg(feature = "test-faults")]
mod test_faults;
#[cfg(feature = "test-faults")]
pub use test_faults::ProjectionFaultWrite;
mod comments;
mod surfaces;
pub use comments::*;

#[cfg(test)]
mod test;

#[cfg(feature = "conformance")]
mod observation;
#[cfg(feature = "conformance")]
pub use observation::UndoObservation;

mod query;
pub use query::*;

#[cfg(feature = "application")]
mod application;
#[cfg(feature = "application")]
pub use application::*;
