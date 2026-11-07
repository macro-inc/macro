//! Model actions behind the view-owned table observer and highlight lifecycle.
use super::*;
/// Model outcome of clearing a rectangular table selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClearText {
    /// The full table was removed; the host may need to dispatch paragraph insertion.
    TableRemoved {
        /// The table's root parent now has no children.
        root_emptied: bool,
    },
    /// Selected cells have one childless paragraph and selection is cleared.
    CellsCleared,
}
/// Clear cells using the application patch: never create an empty TextNode in a cleared cell.
pub fn clear_text(tx: &mut Transaction<'_>, table: NodeKey) -> Result<ClearText> {
    table_id(tx.view(), table).map_err(|_| Error::Invariant("Expected TableNode."))?;
    let selection = tx
        .selection()
        .and_then(Selection::as_table)
        .ok_or(Error::Invariant("Expected TableSelection"))?;
    let cells = selection
        .get_nodes(tx.view())?
        .into_iter()
        .filter(|key| tx.is::<TableCellNode>(*key))
        .collect::<Vec<_>>();
    let first_row = tx
        .first_child(table)
        .filter(|key| tx.is::<TableRowNode>(*key));
    let last_row = tx
        .last_child(table)
        .filter(|key| tx.is::<TableRowNode>(*key));
    let whole = !cells.is_empty()
        && first_row.zip(last_row).is_some_and(|(first, last)| {
            cells.first().copied() == tx.first_child(first)
                && cells.last().copied() == tx.last_child(last)
        });
    if whole {
        tx.select_previous(table, None, None)?;
        let parent = tx.parent(table);
        tx.remove(table, true)?;
        return Ok(ClearText::TableRemoved {
            root_emptied: parent == Some(NodeKey::ROOT) && tx.is_empty(NodeKey::ROOT),
        });
    }
    for cell in cells {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(cell, &[paragraph.key()])?;
        for child in tx.children_keys(cell)? {
            if child != paragraph.key() {
                tx.remove(child, true)?;
            }
        }
    }
    tx.set_selection(None)?;
    Ok(ClearText::CellsCleared)
}
/// Apply one format uniformly through detached ranges while retaining the table selection.
pub fn format_cells(tx: &mut Transaction<'_>, format: TextFormatType) -> Result<()> {
    let selection = tx
        .selection()
        .and_then(Selection::as_table)
        .ok_or(Error::Invariant("Expected Table selection"))?;
    let cells = selection
        .get_nodes(tx.view())?
        .into_iter()
        .filter(|key| tx.is::<TableCellNode>(*key))
        .collect::<Vec<_>>();
    let first = cells
        .first()
        .copied()
        .ok_or(Error::Invariant("No table cells present"))?;
    let align = tx
        .first_child(first)
        .filter(|key| tx.is::<Paragraph>(*key))
        .map(|key| {
            tx.view()
                .element_data(key)
                .map(|p| p.text_format.toggled(format, None))
        })
        .transpose()?;
    for cell in cells {
        let range = RangeSelection::new(
            Point::element(cell, ChildIndex(0)),
            Point::element(cell, ChildIndex(tx.children_size(cell))),
        );
        let slot = tx.detach_selection(Selection::Range(range));
        tx.format_text_at(slot, format, align)?;
    }
    tx.set_selection(Some(Selection::Table(selection)))
}
/// Validate endpoints, install a newly allocated table selection and return it to the view.
pub fn select_cells(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    anchor: Id<TableCellNode>,
    focus: Id<TableCellNode>,
) -> Result<TableSelection> {
    let selection = create_table_selection_from(tx, table, anchor, focus)?;
    tx.replace_selection(Some(Selection::Table(selection)))?;
    Ok(selection)
}
