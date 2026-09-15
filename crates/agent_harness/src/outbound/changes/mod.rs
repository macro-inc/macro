//! The harness-specific answers to `agent_changes`' one extraction port.
//!
//! Each harness family keeps its files somewhere different, so each gets an
//! extractor of its own, and [`RoutedChangesetExtractor`] picks one from the
//! session row the same way [`super::routing`] picks a container provider.

pub mod cursor;
pub mod macrod;
pub mod routed;

pub use cursor::CursorChangesetExtractor;
pub use macrod::MacrodChangesetExtractor;
pub use routed::RoutedChangesetExtractor;
