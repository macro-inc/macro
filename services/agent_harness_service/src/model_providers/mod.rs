//! Concrete outbound adapters for fresh model discovery.

mod access;
mod cursor;
mod in_memory;
mod macrod;

pub use access::VisibleHarnessAccess;
pub use cursor::CursorModels;
pub use in_memory::InMemoryModels;
pub use macrod::MacrodModels;
