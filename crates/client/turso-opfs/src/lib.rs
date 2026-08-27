//! Browser-only Turso I/O over worker-owned Origin Private File System files.
//!
//! The production implementation exists only on `wasm32` DedicatedWorkers.
//! [`OpfsOwner::acquire`] derives and physically holds an exclusive Web Lock
//! and main/WAL paths from one canonical database identity. JavaScript lock and OPFS handles remain in
//! worker-local storage; Turso sees only checked numeric IDs.
//!
//! Opening is typed: a one-sided main/WAL pair becomes
//! [`ResetRequiredSession`] and cannot expose I/O. A complete [`OpfsSession`]
//! creates exactly one production Turso connection. Closing is consuming and
//! adapter-driven: [`ConnectedOpfsSession::try_close`] requires sole connection
//! ownership, calls `Connection::close`, proves success, drops Turso resources,
//! checks all references, and only then closes OPFS handles. [`ClosedSession`]
//! is a one-use choice between preservation and asynchronous physical reset.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

#[cfg(any(test, target_arch = "wasm32"))]
mod state;

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
pub use browser::{
    CloseFailure, ClosedSession, ConnectFailure, ConnectedOpfsSession, OpenDisposition,
    OpenFailure, OpenResult, OpfsError, OpfsErrorKind, OpfsOwner, OpfsSession, ResetFailure,
    ResetRequiredSession, WipeFailure,
};
