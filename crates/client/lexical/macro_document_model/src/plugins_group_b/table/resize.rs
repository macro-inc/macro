//! Source resize snapshots from one batch of DOM measurements and immutable model geometry.
use super::*;
use serde_json::Value;
pub(super) const MIN_COLUMN_WIDTH: f64 = 120.0;
pub(super) const MIN_ROW_HEIGHT: f64 = 33.0;
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum Edge {
    Left,
    Right,
    Bottom,
}
#[derive(Clone, Debug, serde::Deserialize)]
struct Measurement {
    key: u32,
    width: f64,
    height: f64,
}
#[derive(serde::Deserialize)]
struct Request {
    cell: u32,
    edge: Edge,
    zoom: f64,
    measurements: Vec<Measurement>,
}
#[derive(serde::Serialize)]
#[serde(
    tag = "axis",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum Snapshot {
    Column {
        generation: u32,
        table: u32,
        column: u32,
        base_widths: Vec<JsNumber>,
        revert_widths: Option<Vec<Option<JsNumber>>>,
    },
    Row {
        generation: u32,
        row: u32,
        base_height: JsNumber,
        revert_height: Option<JsNumber>,
    },
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.transform::<TableNode>(|tx, table| {
        if tx
            .get_or_err::<TableNode>(table)?
            .col_widths
            .as_ref()
            .is_none()
        {
            let count = TableNode::column_count(tx.view(), table);
            tx.get_mut::<TableNode>(table)?.col_widths =
                ColumnWidths::Values(vec![Some(JsNumber(MIN_COLUMN_WIDTH)); count as usize]);
        }
        Ok(())
    })
}
pub(in crate::plugins_group_b) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name == "group-b.table-convertible" {
        let mut keys = Vec::new();
        for key in state.view().children_keys(NodeKey::ROOT)? {
            if super::list_grid::can_convert(&state.view(), key)? {
                keys.push(key.index());
            }
        }
        return Ok(Some(serde_json::to_value(keys)?));
    }
    if name != "group-b.table-resize" {
        return Ok(None);
    }
    let request: Request = serde_json::from_value(data.clone())?;
    let snapshot = capture(state, &request, generation)?;
    Ok(Some(serde_json::to_value(snapshot)?))
}
fn capture(
    state: &EditorState,
    request: &Request,
    generation: u32,
) -> Result<Option<Snapshot>, Error> {
    if !request.zoom.is_finite() || request.zoom <= 0.0 {
        return Ok(None);
    }
    let view = state.view();
    let key = NodeKey::from_parts(KeyParts {
        index: request.cell,
        generation,
    });
    let Some(cell) = view
        .cast::<TableCellNode>(key)
        .filter(|_| view.is_attached(key))
    else {
        return Ok(None);
    };
    let table = get_table_node_from_lexical_node(view, key)?;
    let (map, position, _) = compute_table_map(view, table, cell, cell)?;
    if matches!(request.edge, Edge::Bottom) {
        let row_index = position
            .start_row
            .saturating_add(position.row_span(view))
            .saturating_sub(1);
        let rows: Vec<_> = view
            .children_keys(table)?
            .into_iter()
            .filter(|key| view.is::<TableRowNode>(*key))
            .collect();
        let Some(row) = rows.get(row_index as usize).copied() else {
            return Ok(None);
        };
        let revert_height = view.get_or_err::<TableRowNode>(row)?.height;
        let measured = request
            .measurements
            .iter()
            .find(|measurement| measurement.key == row.index())
            .map(|measurement| measurement.height)
            .filter(|height| *height > 0.0);
        let base_height = measured
            .map(|height| height / request.zoom)
            .unwrap_or_else(|| revert_height.map_or(MIN_ROW_HEIGHT, |height| height.0));
        return Ok(Some(Snapshot::Row {
            generation,
            row: row.index(),
            base_height: JsNumber(base_height),
            revert_height,
        }));
    }
    let column = if matches!(request.edge, Edge::Right) {
        position
            .start_column
            .saturating_add(position.col_span(view))
            .saturating_sub(1)
    } else if let Some(column) = position.start_column.checked_sub(1) {
        column
    } else {
        return Ok(None);
    };
    let revert_widths = view
        .get_or_err::<TableNode>(table)?
        .col_widths
        .as_ref()
        .cloned();
    let mut base_widths = Vec::new();
    for column in 0..map.column_count() {
        let mut width = None;
        for row in 0..map.row_count() {
            let entry = map
                .get(row, column)
                .ok_or(Error::Invariant("resize table map hole"))?;
            if entry.col_span(view) != 1 {
                continue;
            }
            if let Some(measured) = request.measurements.iter().find(|measurement| {
                measurement.key == entry.cell.key().index() && measurement.width > 0.0
            }) {
                width = Some(measured.width / request.zoom);
                break;
            }
        }
        let stored = revert_widths
            .as_ref()
            .and_then(|widths| widths.get(column as usize))
            .copied()
            .flatten()
            .map(|width| width.0);
        base_widths.push(JsNumber(width.or(stored).unwrap_or(MIN_COLUMN_WIDTH)));
    }
    Ok(Some(Snapshot::Column {
        generation,
        table: table.key().index(),
        column,
        base_widths,
        revert_widths,
    }))
}
pub(super) fn column(
    tx: &mut Transaction<'_>,
    table: NodeKey,
    index: u32,
    base: &[f64],
    delta: f64,
    merge: bool,
) -> Result<bool, Error> {
    if !tx.is::<TableNode>(table) || !tx.is_attached(table) {
        return Ok(false);
    }
    let mut widths: Vec<_> = base.iter().map(|width| Some(JsNumber(*width))).collect();
    let Some(width) = widths.get_mut(index as usize) else {
        return Ok(false);
    };
    let Some(base) = base.get(index as usize) else {
        return Ok(false);
    };
    *width = Some(JsNumber((base + delta).max(MIN_COLUMN_WIDTH)));
    tx.get_mut::<TableNode>(table)?.col_widths = ColumnWidths::Values(widths);
    tags(tx, merge);
    Ok(true)
}
pub(super) fn row(
    tx: &mut Transaction<'_>,
    row: NodeKey,
    base: f64,
    delta: f64,
    merge: bool,
) -> Result<bool, Error> {
    if !tx.is::<TableRowNode>(row) || !tx.is_attached(row) {
        return Ok(false);
    }
    tx.get_mut::<TableRowNode>(row)?.height = Some(JsNumber((base + delta).max(MIN_ROW_HEIGHT)));
    tags(tx, merge);
    Ok(true)
}
pub(super) fn tags(tx: &mut Transaction<'_>, merge: bool) {
    tx.add_tag(UpdateTag::SkipScrollIntoView);
    if merge {
        tx.add_tag(UpdateTag::HistoryMerge);
    }
}
