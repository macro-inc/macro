//! Portable model half of upstream `@lexical/table`.
use lexical_model::*;
type Result<T> = std::result::Result<T, Error>;
/// Table node payloads and JavaScript-compatible numeric fields.
pub mod nodes;
pub use nodes::*;
fn table_id(view: StateRef<'_>, key: NodeKey) -> Result<Id<TableNode>> {
    view.cast(key).ok_or(Error::NodeTypeMismatch(key))
}
fn row_id(view: StateRef<'_>, key: NodeKey) -> Result<Id<TableRowNode>> {
    view.cast(key).ok_or(Error::NodeTypeMismatch(key))
}
fn cell_id(view: StateRef<'_>, key: NodeKey) -> Result<Id<TableCellNode>> {
    view.cast(key).ok_or(Error::NodeTypeMismatch(key))
}
/// Span-aware geometry and table ancestry lookups.
pub mod map;
pub use map::*;
/// Fresh physical grids and navigation decisions for view adapters.
pub mod grid;
pub use grid::*;
/// Table creation, row/column edits and cell merge operations.
pub mod ops;
pub use ops::*;

#[cfg(test)]
mod grid_test;
