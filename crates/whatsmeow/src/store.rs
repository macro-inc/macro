// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! Interfaces for storing data needed for WhatsApp multidevice.
//!
//! Not ported: `store/sqlstore`. [`MemoryStore`] is an in-memory
//! implementation for tests, not a port.

mod clientpayload;
mod memorystore;
mod noop;
mod sessioncache;
mod signal;
#[expect(
    clippy::module_inception,
    reason = "mirrors whatsmeow's store/store.go"
)]
mod store;

pub use clientpayload::*;
pub use memorystore::MemoryStore;
pub use noop::{NoopError, NoopStore};
pub use sessioncache::{SessionCache, SessionCacheEntry};
pub use signal::DeviceSignalStore;
pub use store::*;
