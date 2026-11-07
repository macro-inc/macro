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
/// Table selection geometry, traversal and core hooks.
pub mod selection;
pub use selection::*;
/// Integrity transforms and cell policies.
pub mod transforms;
/// Table capabilities fixed when the editor is built.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableConfig {
    /// Permit merged cells.
    pub has_cell_merge: bool,
    /// Permit cell backgrounds.
    pub has_cell_background_color: bool,
    /// Permit insertion of nested tables.
    pub has_nested_tables: bool,
}
impl Default for TableConfig {
    fn default() -> Self {
        Self {
            has_cell_merge: true,
            has_cell_background_color: true,
            has_nested_tables: false,
        }
    }
}
/// Register table nodes, selection hooks, integrity transforms and configured policies.
pub fn register_table(builder: EditorBuilder, config: &TableConfig) -> EditorBuilder {
    let mut builder = builder
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .node_trait::<TableNode, dyn CanSelectBefore>(|node| node)
        .table_selection_hooks(TableSelectionHooksImpl)
        .transform::<TableNode>(transforms::table_transform)
        .transform::<TableRowNode>(transforms::table_row_transform)
        .transform::<TableCellNode>(transforms::table_cell_transform);
    if !config.has_cell_merge {
        builder = builder.transform::<TableCellNode>(transforms::table_cell_unmerge_transform);
    }
    if !config.has_cell_background_color {
        builder =
            builder.transform::<TableCellNode>(transforms::table_cell_background_strip_transform);
    }
    builder
}
/// Selection, clearing and formatting actions behind the view's table observer.
pub mod observer;
pub use observer::*;
#[cfg(test)]
mod selection_test;
#[cfg(test)]
mod transforms_test;

#[cfg(test)]
mod grid_test;

#[cfg(test)]
mod observer_test;
/// Insert, select-all, triple-click and clipboard model commands.
pub mod commands;
pub use commands::*;
#[cfg(test)]
mod commands_test;
