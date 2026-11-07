//! TableSelection behavior and the core's pluggable table-selection hooks.
use super::*;
use std::collections::HashSet;
/// Construct element endpoints at offset zero without installing the selection.
pub fn table_selection(
    table: Id<TableNode>,
    anchor: Id<TableCellNode>,
    focus: Id<TableCellNode>,
) -> TableSelection {
    let mut selection = TableSelection::new(NodeKey::ROOT, NodeKey::ROOT, NodeKey::ROOT);
    selection.set(table.key(), anchor.key(), focus.key());
    selection
}
/// Validate table membership and reuse an existing table selection's point offsets.
pub fn create_table_selection_from(
    tx: &Transaction<'_>,
    table: Id<TableNode>,
    anchor: Id<TableCellNode>,
    focus: Id<TableCellNode>,
) -> Result<TableSelection> {
    if !tx.is_attached(table) {
        return Err(Error::invariant(format!(
            "$createTableSelectionFrom: tableNode {} is not attached",
            table.key()
        )));
    }
    if find_table_node(tx.view(), anchor.key()) != Some(table) {
        return Err(Error::invariant(format!(
            "$createTableSelectionFrom: anchorCell {} is not in table {}",
            anchor.key(),
            table.key()
        )));
    }
    if find_table_node(tx.view(), focus.key()) != Some(table) {
        return Err(Error::invariant(format!(
            "$createTableSelectionFrom: focusCell {} is not in table {}",
            focus.key(),
            table.key()
        )));
    }
    let mut selection = if let Some(previous) = tx.selection().and_then(Selection::as_table) {
        let mut selection =
            TableSelection::new(previous.table, previous.anchor.key(), previous.focus.key());
        selection.anchor = previous.anchor;
        selection.focus = previous.focus;
        selection
    } else {
        TableSelection::new(NodeKey::ROOT, NodeKey::ROOT, NodeKey::ROOT)
    };
    selection.set(table.key(), anchor.key(), focus.key());
    Ok(selection)
}
/// Whether a nullable selection has the table variant.
pub fn is_table_selection(selection: Option<&Selection>) -> bool {
    matches!(selection, Some(Selection::Table(_)))
}
/// Inclusive logical rectangle containing the anchor and focus cell rectangles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableSelectionShape {
    /// Left column.
    pub from_x: u32,
    /// Top row.
    pub from_y: u32,
    /// Right column.
    pub to_x: u32,
    /// Bottom row.
    pub to_y: u32,
}
/// Model operations supplied for the core-owned selection value.
pub trait TableSelectionExt {
    /// Selected table, rows and cell subtrees, preserving upstream DFS order.
    fn get_nodes(self, view: StateRef<'_>) -> Result<Vec<NodeKey>>;
    /// Endpoint rectangle without the transitive span expansion used by get_nodes.
    fn get_shape(self, view: StateRef<'_>) -> Result<TableSelectionShape>;
    /// OR the first paragraph's stored typing format across selected cells.
    fn has_format(self, view: StateRef<'_>, format: TextFormatType) -> Result<bool>;
    /// Tab-separated cells and newline-terminated rows.
    fn text_content(self, view: StateRef<'_>) -> Result<String>;
    /// Replace the focus element's contents through a normalized range selection.
    fn insert_nodes(self, tx: &mut Transaction<'_>, nodes: &[NodeKey]) -> Result<()>;
}
fn cell_nodes(
    view: StateRef<'_>,
    selection: TableSelection,
) -> Result<(Id<TableCellNode>, Id<TableCellNode>, Id<TableNode>)> {
    let endpoint = |name: &str, point: Point| -> Result<(Id<TableCellNode>, Id<TableNode>)> {
        let node_type = view.type_name(point.key())?;
        let cell = find_cell_node(view,point.key()).ok_or_else(|| Error::invariant(format!("Expected TableSelection {name} to be (or a child of) TableCellNode, got key {} of type {node_type}",point.key())))?;
        let row = view
            .parent(cell)
            .and_then(|key| view.cast::<TableRowNode>(key))
            .ok_or_else(|| {
                Error::invariant(format!(
                    "Expected TableSelection {name} cell parent to be a TableRowNode"
                ))
            })?;
        let table = view
            .parent(row)
            .and_then(|key| view.cast::<TableNode>(key))
            .ok_or_else(|| {
                Error::invariant(format!(
                    "Expected TableSelection {name} row parent to be a TableNode"
                ))
            })?;
        Ok((cell, table))
    };
    let (a, table) = endpoint("anchor", selection.anchor)?;
    let (f, other) = endpoint("focus", selection.focus)?;
    if table != other {
        return Err(Error::Invariant(
            "Expected TableSelection anchor and focus to be in the same table",
        ));
    }
    Ok((a, f, table))
}
pub(super) fn normalized(
    view: StateRef<'_>,
    mut selection: TableSelection,
) -> Result<TableSelection> {
    if !selection.is_valid(view) {
        return Ok(selection);
    }
    let (_, focus, table) = cell_nodes(view, selection)?;
    let focus_grid = view
        .parent(focus)
        .and_then(|row| view.parent(row))
        .ok_or(Error::Invariant("Expected TableNode"))?;
    if focus_grid != table.key() {
        // The same-table invariant above currently makes this upstream branch
        // unreachable. Keep its rewrite here for parity with getNodes.
        if !view.is_parent_of(table, focus) {
            let parent = view.parent_or_err(table)?;
            selection.set(selection.table, parent, focus.key());
        } else {
            let parent = view.parent_or_err(focus_grid)?;
            selection.set(selection.table, focus.key(), parent);
        }
    }
    Ok(selection)
}
impl TableSelectionExt for TableSelection {
    fn get_nodes(self, view: StateRef<'_>) -> Result<Vec<NodeKey>> {
        if !self.is_valid(view) {
            return Ok(vec![]);
        }
        let normalized = normalized(view, self)?;
        if normalized != self {
            return normalized.get_nodes(view);
        }
        let (a, f, table) = cell_nodes(view, self)?;
        let (map, av, fv) = compute_table_map(view, table, a, f)?;
        let rect = compute_table_cell_rect_boundary(&map, &av, &fv);
        let mut nodes = vec![table.key()];
        let mut seen = HashSet::from([table.key()]);
        let mut last_row = None;
        for row in rect.min_row..=rect.max_row {
            for column in rect.min_column..=rect.max_column {
                let cell = map
                    .get(row, column)
                    .ok_or(Error::Invariant("Table map contains a hole"))?
                    .cell;
                let parent = view.parent_or_err(cell)?;
                row_id(view, parent)?;
                if last_row != Some(parent) {
                    if seen.insert(parent) {
                        nodes.push(parent);
                    }
                    last_row = Some(parent);
                }
                if !seen.contains(&cell.key()) {
                    visit_recursively(view, cell.key(), &mut |key| {
                        if seen.insert(key) {
                            nodes.push(key);
                        }
                        true
                    });
                }
            }
        }
        Ok(nodes)
    }
    fn get_shape(self, view: StateRef<'_>) -> Result<TableSelectionShape> {
        let (a, f, _) = cell_nodes(view, self)?;
        let a = get_table_cell_node_rect(view, a)?
            .ok_or(Error::Invariant("Expected table cell rectangle"))?;
        let f = get_table_cell_node_rect(view, f)?
            .ok_or(Error::Invariant("Expected table cell rectangle"))?;
        Ok(TableSelectionShape {
            from_x: a.column_index.min(f.column_index),
            from_y: a.row_index.min(f.row_index),
            to_x: (a.column_index + a.col_span - 1).max(f.column_index + f.col_span - 1),
            to_y: (a.row_index + a.row_span - 1).max(f.row_index + f.row_span - 1),
        })
    }
    fn has_format(self, view: StateRef<'_>, format: TextFormatType) -> Result<bool> {
        let mut flags = TextFormat::empty();
        for node in self.get_nodes(view)? {
            if view.is::<TableCellNode>(node)
                && let Some(p) = view.first_child(node)
                && view.is::<Paragraph>(p)
            {
                flags |= view.element_data(p)?.text_format;
            }
        }
        Ok(flags.has(format))
    }
    fn text_content(self, view: StateRef<'_>) -> Result<String> {
        let cells = self
            .get_nodes(view)?
            .into_iter()
            .filter(|key| view.is::<TableCellNode>(*key))
            .collect::<Vec<_>>();
        let mut text = String::new();
        for (index, cell) in cells.iter().copied().enumerate() {
            text.push_str(&view.text_content(cell));
            text.push(
                if cells.get(index + 1).and_then(|next| view.parent(*next)) != view.parent(cell) {
                    '\n'
                } else {
                    '\t'
                },
            );
        }
        Ok(text)
    }
    fn insert_nodes(self, tx: &mut Transaction<'_>, nodes: &[NodeKey]) -> Result<()> {
        let focus = self.focus.key();
        if !tx.is_element(focus) {
            return Err(Error::Invariant(
                "Expected TableSelection focus to be an ElementNode",
            ));
        }
        let size = tx.children_size(focus);
        tx.element(focus)?
            .select(Some(ChildIndex(0)), Some(ChildIndex(size)))?;
        tx.normalize_selection()?;
        tx.insert_nodes(nodes)
    }
}
/// Explicit stack DFS; children are visited from last to first.
pub fn visit_recursively(
    view: StateRef<'_>,
    node: NodeKey,
    visit: &mut dyn FnMut(NodeKey) -> bool,
) {
    let mut stack = vec![node];
    while let Some(key) = stack.pop() {
        if visit(key) && view.is_element(key) {
            stack.extend(view.children(key));
        }
    }
}
/// Adapter installed into lexical_model without a core dependency on table types.
pub struct TableSelectionHooksImpl;
impl TableSelectionHooks for TableSelectionHooksImpl {
    fn nodes(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<Vec<NodeKey>> {
        selection.get_nodes(view)
    }
    fn text_content(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<String> {
        TableSelectionExt::text_content(*selection, view)
    }
    fn insert_nodes(
        &self,
        tx: &mut Transaction<'_>,
        slot: SelectionSlot,
        nodes: &[NodeKey],
    ) -> Result<()> {
        let selection = tx
            .selection_at(slot)?
            .and_then(Selection::as_table)
            .ok_or(Error::UnsupportedSelection)?;
        selection.insert_nodes(tx, nodes)
    }
}
