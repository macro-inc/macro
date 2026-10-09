//! Reuse the database query compiler and fold for host-owned storage reads.
use crate::domain::{
    catalog::{StorageTable, engine_table},
    models::{DatabaseError, RowRef},
    storage::StorageRowsQuery,
};
use database_sql::{Catalog, Cell, Row};
use models_databases::{
    OptionId, RowId, ViewId,
    views::{DatabaseView, ViewLayout},
};
use models_properties::service::property_value::PropertyValue;
use std::collections::HashMap;

pub(super) fn row(row: &RowRef, cells: &HashMap<uuid::Uuid, PropertyValue>) -> Row {
    Row {
        id: row.id,
        position: Some(row.position.clone()),
        cells: cells
            .iter()
            .map(|(id, value)| {
                (
                    *id,
                    match value {
                        PropertyValue::Bool(value) => Cell::Bool(*value),
                        PropertyValue::Num(value) => Cell::Number(*value),
                        PropertyValue::Str(value) => Cell::Text(value.clone()),
                        PropertyValue::Date(value) => Cell::Date(*value),
                        PropertyValue::SelectOption(ids) => {
                            Cell::Options(ids.iter().copied().map(OptionId::from_uuid).collect())
                        }
                        PropertyValue::EntityRef(refs) => Cell::Entities(
                            refs.iter()
                                .map(|reference| reference.entity_id.clone())
                                .collect(),
                        ),
                        PropertyValue::Link(urls) => Cell::Text(urls.join(" ")),
                    },
                )
            })
            .collect(),
    }
}

pub(super) fn rows(
    entry: &StorageTable,
    rows: Vec<Row>,
    request: &StorageRowsQuery,
) -> Result<Vec<RowId>, DatabaseError> {
    let catalog = Catalog {
        tables: vec![engine_table(entry, "")],
    };
    let query = if request.row_ids.is_some() {
        Default::default()
    } else {
        request.query.clone()
    };
    let now = chrono::Utc::now();
    let view = DatabaseView {
        id: ViewId::new(),
        database_id: entry.table.database_id,
        table_id: entry.table.id,
        name: String::new(),
        position: entry.table.position.clone(),
        query,
        layout: ViewLayout::Table { columns: vec![] },
        created_at: now,
        updated_at: now,
    };
    let select = database_sql::compile_view(&view, &catalog).map_err(|error| {
        DatabaseError::InvalidOp(crate::domain::models::OpRefusal {
            op: 0,
            row: None,
            column: None,
            taken: None,
            reason: error.to_string(),
        })
    })?;
    let filter = select.where_.clone();
    let mut plan = database_sql::split(&catalog, select);
    // Storage supplies unfiltered rows, so evaluate even predicates the SQL
    // planner would normally push into its external row source.
    plan.residual = filter;
    Ok(database_sql::fold_relations(&catalog, &plan, vec![rows]).1)
}
