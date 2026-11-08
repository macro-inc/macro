use super::*;
/// Pointer facts needed for range-to-cell conversion.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TouchState {
    /// Touch pointer rather than mouse.
    pub is_touch: bool,
    /// Observer is actively selecting.
    pub is_selecting: bool,
}
/// Selection-change work for the host observer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RangeFix {
    /// No change.
    None,
    /// Range endpoints were updated.
    Applied,
    /// Convert the range through the observer's anchor/focus methods.
    ConvertToCells {
        /// Owning table.
        table: Id<TableNode>,
        /// Anchor cell.
        anchor: Id<TableCellNode>,
        /// Focus cell.
        focus: Id<TableCellNode>,
        /// Reset observer pointer type after a touch conversion.
        reset_pointer_type: bool,
    },
}
/// Firefox down-arrow correction: enter the first cell when native movement skips it.
pub fn fix_selection_after_down_into_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
) -> Result<bool> {
    if !matches!(tx.previous_selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    let Some(Selection::Range(r)) = tx.selection() else {
        return Ok(false);
    };
    if !r.is_collapsed() {
        return Ok(false);
    }
    let Some(cell) = find_cell_node(tx.view(), r.anchor.key()) else {
        return Ok(false);
    };
    let Some(row) = tx.first_child(table).filter(|k| tx.is::<TableRowNode>(*k)) else {
        return Ok(false);
    };
    let Some(first) = tx.first_child(row).filter(|k| tx.is::<TableCellNode>(*k)) else {
        return Ok(false);
    };
    let mut node = Some(cell.key());
    while let Some(key) = node {
        if key == first {
            return Ok(false);
        }
        if key == table.key() {
            tx.select_start(first)?;
            return Ok(true);
        }
        node = tx.parent(key);
    }
    Ok(false)
}
fn edge_point(view: StateRef<'_>, table: Id<TableNode>, last: bool) -> Result<Point> {
    let (map, _, _) = compute_table_map_skip_cell_check(view, table, None, None)?;
    let value = if last {
        map.rows.last().and_then(|r| r.last())
    } else {
        map.rows.first().and_then(|r| r.first())
    }
    .and_then(Option::as_ref)
    .ok_or(Error::Invariant("Table map contains a hole"))?;
    Ok(Point::element(
        value.cell,
        ChildIndex(if last {
            view.children_size(value.cell)
        } else {
            0
        }),
    ))
}
/// Clamp crossing table ranges or ask the observer to convert a range into cells.
pub fn fix_range_selection_for_tables(
    tx: &mut Transaction<'_>,
    touch_for: &dyn Fn(NodeKey) -> TouchState,
) -> Result<RangeFix> {
    let Some(Selection::Range(mut r)) = tx.selection().cloned() else {
        return Ok(RangeFix::None);
    };
    let (ta, tf) = (
        find_table_node(tx.view(), r.anchor.key()),
        find_table_node(tx.view(), r.focus.key()),
    );
    let backward = r.is_backward(tx.view())?;
    if let Some(table) = tf
        && ta.is_none_or(|a| tx.is_parent_of(a, table))
    {
        r.focus = edge_point(tx.view(), table, !backward)?;
        tx.set_selection(Some(Selection::Range(r)))?;
        return Ok(RangeFix::Applied);
    }
    if let Some(table) = ta
        && tf.is_none_or(|f| tx.is_parent_of(f, table))
    {
        r.anchor = edge_point(tx.view(), table, backward)?;
        tx.set_selection(Some(Selection::Range(r)))?;
        return Ok(RangeFix::Applied);
    }
    if let Some(table) = ta
        && ta == tf
    {
        let a = find_cell_node(tx.view(), r.anchor.key());
        let f = find_cell_node(tx.view(), r.focus.key());
        if let (Some(anchor), Some(focus)) = (a, f) {
            if anchor != focus {
                return Ok(RangeFix::ConvertToCells {
                    table,
                    anchor,
                    focus,
                    reset_pointer_type: false,
                });
            }
            let touch = touch_for(table.key());
            if touch.is_touch
                && touch.is_selecting
                && r.is_collapsed()
                && let Some(Selection::Range(prev)) = tx.previous_selection()
                && prev.is_collapsed()
                && let Some(anchor) = find_cell_node(tx.view(), prev.anchor.key())
                && anchor != focus
            {
                return Ok(RangeFix::ConvertToCells {
                    table,
                    anchor,
                    focus,
                    reset_pointer_type: true,
                });
            }
        }
    }
    Ok(RangeFix::None)
}
/// Persist the nested table normalization performed during upstream getNodes.
pub fn normalize_table_selection(tx: &mut Transaction<'_>) -> Result<()> {
    if let Some(Selection::Table(s)) = tx.selection().cloned() {
        let next = super::super::selection::normalized(tx.view(), s)?;
        if next != s {
            tx.set_selection(Some(Selection::Table(next)))?;
        }
    }
    Ok(())
}
