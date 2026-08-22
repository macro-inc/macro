//! Cursor cloud agents as a session container provider.

pub mod manager;
pub mod pipe;

pub use manager::{CURSOR_PROVIDER, CursorContainerManager};
pub use pipe::PipeTransport;
