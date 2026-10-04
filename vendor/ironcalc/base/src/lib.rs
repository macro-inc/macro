//! # IronCalcBase engine API
//!
//! This is the documentation for the base engine API.
//!
//! # Basic usage
//!
//! Add the dependency in Cargo.toml:
//!
//! ```toml
//! [dependencies]
//! ironcalc_base = { git = "https://github.com/ironcalc/IronCalc" }
//! ```
//!
//! <small> until version 1.0.0 you should use the git dependencies as stated </small>
//!
//! In this example we use the excel function `CONCAT` to concatenate strings in cells `A1` and `B1`:
//!
//! ```rust
#![doc = include_str!("../examples/hello_world.rs")]
//! ```
//!
//! In this example, we demonstrate our ability to handle formulas and errors:
//!
//! ```rust
#![doc = include_str!("../examples/formulas_and_errors.rs")]
//! ```

#![warn(clippy::print_stdout)]

pub mod builtin_styles;
pub mod calc_result;
pub mod cell;
pub mod cf_types;
pub mod colors;
pub mod expressions;
pub mod formatter;
pub mod language;
pub mod locale;
pub mod new_empty;
pub mod number_format;
pub mod sheet_data;
pub mod themes;
pub mod types;
pub mod worksheet;

pub use crate::constants::COLUMN_WIDTH_FACTOR;
pub use crate::constants::ROW_HEIGHT_FACTOR;

mod actions;
mod arithmetic;
mod cast;
mod conditional_formatting;
mod constants;
mod cut_paste;
mod evaluation;
mod functions;
mod implicit_intersection;
pub mod links;
mod merged_cells;
mod model;
mod styles;
mod tz;
mod units;
mod user_model;
mod utils;
mod workbook;

#[cfg(test)]
mod test;

#[cfg(any(test, feature = "mock_time"))]
pub mod mock_time;

pub use locale::get_supported_locales;
pub use merged_cells::MergeStructure;
pub use model::get_milliseconds_since_epoch;
pub use model::FmtSettings;
pub use model::Model;
pub use user_model::BorderArea;
pub use user_model::ClipboardData;
pub use user_model::UserModel;
pub use utils::get_all_timezones;
