#![deny(missing_docs)]

mod autofill;
mod border;
mod border_utils;
mod clipboard;
mod common;
mod conditional_formatting;
pub(crate) mod history;
mod links;
mod merged_cells;
mod named_cell_styles;
mod sequence_detector;
mod ui;
mod undo_redo;

pub use common::UserModel;

#[cfg(test)]
pub use ui::SelectedView;

pub use clipboard::ClipboardData;
pub use common::BorderArea;
