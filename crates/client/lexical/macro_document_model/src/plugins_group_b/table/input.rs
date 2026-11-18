//! Source table Tab policies, separate from upstream cell navigation.
use super::*;
use lexical_rich_nodes::list::ListItemNode;

/// Run before row growth and upstream navigation at the source Critical slot.
/// An eligible list consumes Tab even when the nested indent command yields.
pub fn handle_list_tab(tx: &mut Transaction<'_>, shift: bool) -> Result<Handled, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range) else {
        return Ok(Handled::No);
    };
    if !range.is_collapsed() {
        return Ok(Handled::No);
    }
    let Some(item) = tx.find_matching_parent(range.anchor.key(), |state, key| {
        state.is::<ListItemNode>(key)
    }) else {
        return Ok(Handled::No);
    };
    if find_cell_node(tx.view(), item).is_none() {
        return Ok(Handled::No);
    }
    let depth = tx.indent(item);
    let previous = tx
        .prev_sibling(item)
        .filter(|key| tx.is_element(*key))
        .map_or(0, |key| tx.indent(key));
    if (shift && depth == 0) || (!shift && depth > previous) {
        return Ok(Handled::No);
    }
    tx.prevent_default();
    tx.dispatch(if shift {
        &Command::OutdentContent
    } else {
        &Command::IndentContent
    })?;
    Ok(Handled::Yes)
}

/// Run after list Tab at the source Critical slot; yield ordinary navigation.
pub fn handle_insert_row_tab(tx: &mut Transaction<'_>, shift: bool) -> Result<Handled, Error> {
    if shift {
        return Ok(Handled::No);
    }
    let Some(range) = tx.selection().and_then(Selection::as_range) else {
        return Ok(Handled::No);
    };
    if !range.is_collapsed() {
        return Ok(Handled::No);
    }
    let Some(cell) = find_cell_node(tx.view(), range.anchor.key()) else {
        return Ok(Handled::No);
    };
    let Some(row) = tx
        .parent(cell)
        .filter(|key| tx.view().is::<TableRowNode>(*key))
    else {
        return Ok(Handled::No);
    };
    if !tx
        .parent(row)
        .is_some_and(|key| tx.view().is::<TableNode>(key))
        || tx.next_sibling(cell).is_some()
        || tx.next_sibling(row).is_some()
    {
        return Ok(Handled::No);
    }
    tx.prevent_default();
    if let Some(row) = insert_table_row_at_selection(tx, true)?
        && let Some(first) = tx
            .first_child(row)
            .filter(|key| tx.view().is::<TableCellNode>(*key))
    {
        tx.select_start(first)?;
    }
    Ok(Handled::Yes)
}

#[cfg(test)]
mod test;
