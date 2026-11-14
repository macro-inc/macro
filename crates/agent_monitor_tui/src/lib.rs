//! The agent monitor's terminal viewer (`macrod monitor`): a dense,
//! Bloomberg-style board of every agent on the machine, drawn with ratatui
//! from the collector's `Subscribe` stream or from an in-process demo fleet.
//!
//! - [`keys`]: the pure key machine, [`keys::step`].
#![deny(missing_docs)]

pub mod keys;
