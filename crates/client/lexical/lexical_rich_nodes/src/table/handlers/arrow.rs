use super::*;
fn corner(rect: TableCellRectBoundary, v: &TableMapValue) -> Option<(u32, u32)> {
    let x = if v.start_column == rect.min_column {
        rect.min_column
    } else if i64::from(v.start_column) + i64::from(v.col_span) - 1 == i64::from(rect.max_column) {
        rect.max_column
    } else {
        return None;
    };
    let y = if v.start_row == rect.min_row {
        rect.min_row
    } else if i64::from(v.start_row) + i64::from(v.row_span) - 1 == i64::from(rect.max_row) {
        rect.max_row
    } else {
        return None;
    };
    Some((x, y))
}
fn opposite(rect: TableCellRectBoundary, (x, y): (u32, u32)) -> (u32, u32) {
    (
        if x == rect.min_column {
            rect.max_column
        } else {
            rect.min_column
        },
        if y == rect.min_row {
            rect.max_row
        } else {
            rect.min_row
        },
    )
}
fn cell_at(map: &TableMap, (x, y): (u32, u32)) -> Result<Id<TableCellNode>> {
    Ok(map
        .get(y, x)
        .ok_or(Error::Invariant("Table map contains a hole"))?
        .cell)
}
/// Extend/contract a table rectangle, preserving the anchor's corner through merged cells.
pub fn adjust_focus_in_direction(
    map: &TableMap,
    anchor: &TableMapValue,
    focus: &TableMapValue,
    dir: TableDirection,
) -> Result<Option<(Id<TableCellNode>, Id<TableCellNode>)>> {
    let rect = compute_table_cell_rect_boundary(map, anchor, focus);
    let spans = compute_table_cell_rect_spans(map, &rect)?;
    let c = corner(rect, anchor).ok_or_else(|| {
        Error::invariant(format!(
            "getCornerOrThrow: cell {} is not at a corner of rect",
            anchor.cell.key()
        ))
    })?;
    let (x, y) = opposite(rect, c);
    let (mut x, mut y) = (i64::from(x), i64::from(y));
    match dir {
        TableDirection::Forward => {
            x += if x == i64::from(rect.max_column) {
                1
            } else {
                i64::from(spans.left_span)
            }
        }
        TableDirection::Backward => {
            x -= if x == i64::from(rect.min_column) {
                1
            } else {
                i64::from(spans.right_span)
            }
        }
        TableDirection::Down => {
            y += if y == i64::from(rect.max_row) {
                1
            } else {
                i64::from(spans.top_span)
            }
        }
        TableDirection::Up => {
            y -= if y == i64::from(rect.min_row) {
                1
            } else {
                i64::from(spans.bottom_span)
            }
        }
    }
    let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
        return Ok(None);
    };
    let Some(next) = map.get(y, x) else {
        return Ok(None);
    };
    let rect = compute_table_cell_rect_boundary(map, anchor, next);
    let (a, f) = if let Some(a) = corner(rect, anchor) {
        (a, opposite(rect, a))
    } else if let Some(f) = corner(rect, next) {
        (opposite(rect, f), f)
    } else {
        (
            (rect.min_column, rect.min_row),
            (rect.max_column, rect.max_row),
        )
    };
    Ok(Some((cell_at(map, a)?, cell_at(map, f)?)))
}
fn block_parent_if_first(view: StateRef<'_>, start: NodeKey) -> Option<NodeKey> {
    let mut node = start;
    loop {
        if view.is_element(node) && !view.is_inline(node) {
            return Some(node);
        }
        let parent = view.parent(node)?;
        if view.first_child(parent) != Some(node) {
            return None;
        }
        node = parent;
    }
}
fn directional_sibling(view: StateRef<'_>, key: NodeKey, up: bool) -> Option<NodeKey> {
    if up {
        view.prev_sibling(key)
    } else {
        view.next_sibling(key)
    }
}
fn exit_caret(view: StateRef<'_>, table: Id<TableNode>, dir: CaretDirection) -> Result<PointCaret> {
    let caret = NodeCaret::Sibling(SiblingCaret::new(table.key(), dir));
    match caret.adjacent_child_caret(view) {
        Some(NodeCaret::Child(c)) => normalize_caret(view, c.into()),
        _ => Ok(caret.into()),
    }
}
fn horizontal(
    tx: &mut Transaction<'_>,
    r: &RangeSelection,
    extend: bool,
    backward: bool,
    table: Id<TableNode>,
    view: &dyn TableView,
) -> Result<HandlerResult> {
    let direction = if backward {
        CaretDirection::Previous
    } else {
        CaretDirection::Next
    };
    let initial = caret_from_point(tx.view(), &r.focus, direction)?;
    if let PointCaret::Text(text) = initial
        && text.is_extendable(tx.view())?
    {
        return Ok(HandlerResult::none());
    }
    let mut last = initial;
    let mut cursor =
        CaretRange::extend(tx.view(), initial).node_carets(tx.view(), RootMode::ShadowRoot)?;
    while let Some(caret) = cursor.next(tx.view())? {
        if !matches!(caret, NodeCaret::Sibling(_)) || !tx.is_element(caret.origin()) {
            return Ok(HandlerResult::none());
        }
        last = caret.into();
    }
    let Some(anchor) = last
        .parent_at_caret(tx.view())
        .and_then(|k| tx.view().cast::<TableCellNode>(k))
    else {
        return Ok(HandlerResult::none());
    };
    if find_table_node(tx.view(), anchor.key()) != Some(table) {
        return Ok(HandlerResult::none());
    }
    let mut cursor =
        CaretRange::extend(tx.view(), SiblingCaret::new(anchor.key(), direction).into())
            .node_carets(tx.view(), RootMode::Root)?;
    let mut focus = None;
    while let Some(caret) = cursor.next(tx.view())? {
        if tx.is::<TableRowNode>(caret.origin()) {
            continue;
        }
        if tx.is::<TableCellNode>(caret.origin()) {
            if matches!(caret, NodeCaret::Child(_)) {
                focus = Some(caret);
                break;
            }
            continue;
        }
        break;
    }
    if !view.has_cell_element(anchor.key()) {
        return Ok(HandlerResult::none());
    }
    if extend {
        let target = focus
            .map(|c| cell_id(tx.view(), c.origin()))
            .transpose()?
            .unwrap_or(anchor);
        if focus.is_some() && !view.has_cell_element(target.key()) {
            return Ok(HandlerResult::none());
        }
        return Ok(HandlerResult::cells(table, anchor, target, true));
    }
    let caret = if let Some(focus) = focus {
        normalize_caret(tx.view(), focus.into())?
    } else {
        exit_caret(tx.view(), table, direction)?
    };
    tx.set_selection_from_caret_range(CaretRange::collapsed(caret))?;
    Ok(HandlerResult::stopped())
}
/// Handle an arrow using model carets and fresh physical table coordinates.
pub fn handle_arrow_key(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    dir: TableDirection,
    shift: bool,
    view: &dyn TableView,
) -> Result<HandlerResult> {
    let vertical = matches!(dir, TableDirection::Up | TableDirection::Down);
    let up = dir == TableDirection::Up;
    if vertical && view.is_typeahead_open() {
        return Ok(HandlerResult::none());
    }
    let Some(selection) = tx.selection().cloned() else {
        return Ok(HandlerResult::none());
    };
    let in_table = is_selection_in_table(tx.view(), Some(&selection), table.key());
    if !in_table {
        if let Selection::Range(mut r) = selection {
            if dir == TableDirection::Backward {
                if r.focus.offset() > 0 {
                    return Ok(HandlerResult::none());
                }
                if let Some(block) = block_parent_if_first(tx.view(), r.focus.key())
                    && let Some(prev) = tx.prev_sibling(block).filter(|k| tx.is::<TableNode>(*k))
                {
                    if shift {
                        r.focus = Point::element(
                            tx.parent_or_err(prev)?,
                            tx.index_within_parent(prev)
                                .ok_or(Error::Invariant("Expected attached table"))?,
                        );
                        tx.set_selection(Some(Selection::Range(r)))?;
                    } else {
                        tx.select_end(prev)?;
                    }
                    return Ok(HandlerResult::stopped());
                }
            }
            if shift && vertical {
                let backward = r.is_backward(tx.view())?;
                if !r.is_collapsed() && ((up && !backward) || (!up && backward)) {
                    if find_table_node(tx.view(), r.focus.key()) != Some(table) {
                        return Ok(HandlerResult::none());
                    }
                    let Some(sibling) = directional_sibling(tx.view(), table.key(), up) else {
                        return Ok(HandlerResult::none());
                    };
                    let mut node = sibling;
                    let mut offset = 0;
                    if up && tx.is_element(sibling) {
                        offset = tx.children_size(sibling);
                        node = tx.last_child(sibling).unwrap_or(sibling);
                        offset = if tx.is_text(node) {
                            tx.text_content_size(node).0
                        } else {
                            let _ = offset;
                            0
                        };
                    }
                    r.focus = if tx.is_text(node) {
                        Point::text(node, Utf16Offset(offset))
                    } else {
                        Point::element(node, ChildIndex(offset))
                    };
                    tx.set_selection(Some(Selection::Range(r)))?;
                    return Ok(HandlerResult::stopped());
                }
                if tx.is_root_or_shadow_root(r.focus.key()) {
                    let nodes = r.nodes(tx.view())?;
                    let node = if up { nodes.last() } else { nodes.first() };
                    if node
                        .and_then(|n| {
                            find_parent_table_cell_node_in_table(tx.view(), table.key(), Some(*n))
                        })
                        .is_some()
                    {
                        let first = tx
                            .first_descendant(table)
                            .ok_or(Error::Invariant("Expected TableCellNode"))?;
                        let last = tx
                            .last_descendant(table)
                            .ok_or(Error::Invariant("Expected TableCellNode"))?;
                        let (a, _, _) = get_node_triplet(tx.view(), TripletSource::Node(first))?;
                        let (f, _, _) = get_node_triplet(tx.view(), TripletSource::Node(last))?;
                        return Ok(HandlerResult::cells(table, a, f, false));
                    }
                    return Ok(HandlerResult::none());
                }
                if let Some(mut block) = tx
                    .find_matching_parent(r.focus.key(), |v, k| v.is_element(k) && !v.is_inline(k))
                {
                    if tx.is::<TableCellNode>(block) {
                        block = get_table_node_from_lexical_node(tx.view(), block)?.key();
                    }
                    if directional_sibling(tx.view(), block, up) == Some(table.key()) {
                        let node = if up {
                            tx.first_descendant(table)
                        } else {
                            tx.last_descendant(table)
                        }
                        .ok_or(Error::Invariant("Expected TableCellNode"))?;
                        let (cell, _, _) = get_node_triplet(tx.view(), TripletSource::Node(node))?;
                        r.focus = Point::element(
                            cell,
                            ChildIndex(if up { 0 } else { tx.children_size(cell) }),
                        );
                        tx.set_selection(Some(Selection::Range(r)))?;
                        return Ok(HandlerResult::stopped());
                    }
                }
            }
        }
        return Ok(if dir == TableDirection::Down {
            HandlerResult {
                effect: ObserverEffect::CheckSelectionAfterDown { table },
                ..HandlerResult::none()
            }
        } else {
            HandlerResult::none()
        });
    }
    match selection {
        Selection::Range(r) => {
            if !vertical {
                return horizontal(tx, &r, shift, dir == TableDirection::Backward, table, view);
            }
            if r.is_collapsed() {
                let (Some(a), Some(f)) = (
                    find_cell_node(tx.view(), r.anchor.key()),
                    find_cell_node(tx.view(), r.focus.key()),
                ) else {
                    return Ok(HandlerResult::none());
                };
                if a != f {
                    return Ok(HandlerResult::none());
                }
                if let Some(inner) = find_table_node(tx.view(), a.key())
                    && inner != table
                {
                    return handle_arrow_key(tx, inner, dir, shift, view);
                }
                let edge = if up {
                    tx.first_child(a)
                } else {
                    tx.last_child(a)
                };
                if let Some(edge) = edge
                    && view.caret_exits_cell(&r.anchor, edge, dir) == Some(true)
                {
                    if shift {
                        return Ok(HandlerResult::cells(table, a, a, true));
                    }
                    let grid = table_grid(tx.view(), table)?;
                    let (x, y) = grid.coords_of(a)?;
                    apply_cell_move(tx, table, next_cell_in_direction(&grid, x, y, dir)?)?;
                    return Ok(HandlerResult::stopped());
                }
            }
            Ok(HandlerResult::none())
        }
        Selection::Table(s) => {
            if s.table != table.key() {
                return Ok(HandlerResult::none());
            }
            let a = find_cell_node(tx.view(), s.anchor.key());
            let f = find_cell_node(tx.view(), s.focus.key());
            if !s
                .get_nodes(tx.view())?
                .first()
                .is_some_and(|k| tx.is::<TableNode>(*k))
            {
                return Err(Error::Invariant(
                    "$handleArrowKey: TableSelection.getNodes()[0] expected to be TableNode",
                ));
            }
            let (Some(a), Some(f)) = (a, f) else {
                return Ok(HandlerResult::none());
            };
            let pair = if shift {
                let (map, av, fv) = map::checked_in(tx, table, a, f)?;
                adjust_focus_in_direction(&map, &av, &fv, dir)?
            } else {
                tx.select_end(f)?;
                None
            };
            Ok(HandlerResult {
                handled: !shift || pair.is_some(),
                stop_event: true,
                effect: ObserverEffect::ResyncFromTableSelection {
                    anchor: a,
                    then: pair,
                },
            })
        }
        _ => Ok(HandlerResult::none()),
    }
}
