//! The agent monitor's terminal viewer (`macrod monitor`): a dense,
//! Bloomberg-style board of every agent on the machine, drawn with ratatui
//! from the collector's `Subscribe` stream or from an in-process demo fleet.
//!
//! - [`view`]: the mirrored state, updated by [`view::ViewState::apply`].
//! - [`keys`]: the pure key machine, [`keys::step`].
//! - [`app`]: page stack, cursors and filters.
//! - [`ui`]: drawing, with [`ui::draw`] as the entry point.
//! - [`body`]: the BODY pane's trait and its vitals placeholder.
#![deny(missing_docs)]

pub mod app;
pub mod body;
mod format;
pub mod keys;
pub mod theme;
pub mod ui;
pub mod view;
