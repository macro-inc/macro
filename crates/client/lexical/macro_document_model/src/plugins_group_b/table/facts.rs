//! Read-only bulk table geometry shared by native rendering and application controls.
use lexical_model::{EditorState, Error, NodeKey};
use lexical_rich_nodes::table::{
    ColumnWidths, TableCellNode, TableNode, TableRowNode, compute_table_map_skip_cell_check,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    keys: Vec<u32>,
}

fn key(key: NodeKey) -> Value {
    json!({"index":key.index(),"generation":key.generation()})
}

pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != "group-b.table-facts" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    let request: Request = serde_json::from_value(data.clone())?;
    let view = state.view();
    let mut tables = Vec::with_capacity(request.keys.len());
    for index in request.keys {
        let table_key = NodeKey::from_parts(lexical_model::KeyParts { index, generation });
        let table = view
            .cast::<TableNode>(table_key)
            .filter(|_| view.is_attached(table_key))
            .ok_or(Error::Invariant(
                "table facts require an attached TableNode",
            ))?;
        let node = view.get_or_err::<TableNode>(table_key)?;
        let (map, _, _) = compute_table_map_skip_cell_check(view, table, None, None)?;
        let mut origins = BTreeMap::new();
        let slots = map
            .rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|slot| {
                        slot.as_ref().map(|entry| {
                            origins.entry(entry.cell.key()).or_insert(*entry);
                            key(entry.cell.key())
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let mut rows = Vec::new();
        let mut cells = Vec::new();
        for row_key in view.children_keys(table_key)? {
            let row = view.get_or_err::<TableRowNode>(row_key)?;
            let mut cell_keys = Vec::new();
            for cell_key in view.children_keys(row_key)? {
                let cell = view.get_or_err::<TableCellNode>(cell_key)?;
                let origin = origins
                    .get(&cell_key)
                    .ok_or(Error::Invariant("table cell absent from computed map"))?;
                cell_keys.push(key(cell_key));
                cells.push(json!({
                    "key":key(cell_key),"row":origin.start_row,"column":origin.start_column,
                    "rowSpan":origin.row_span(view),"colSpan":origin.col_span(view),
                    "headerState":origin.header_state(view).bits(),"width":cell.width,
                    "backgroundColor":cell.background_color,"verticalAlign":cell.vertical_align,
                }));
            }
            rows.push(json!({"key":key(row_key),"height":row.height,"cellKeys":cell_keys}));
        }
        let col_widths = match &node.col_widths {
            ColumnWidths::Undefined => json!({"kind":"missing"}),
            ColumnWidths::Null => json!({"kind":"null"}),
            ColumnWidths::Values(widths) => json!({"kind":"value","value":widths}),
        };
        tables.push(json!({
            "key":key(table_key),"rowCount":map.row_count(),"columnCount":map.column_count(),
            "rows":rows,"slots":slots,"cells":cells,"colWidths":col_widths,
            "frozenRowCount":node.frozen_row_count,"frozenColumnCount":node.frozen_column_count,
            "rowStriping":node.row_striping,
        }));
    }
    Ok(Some(json!({"generation":generation,"tables":tables})))
}
