use databases::domain::models::{DatabaseId, RowId, Table, TableId, TableVersion, ViewId};

use super::*;

#[test]
fn only_layout_operations_add_an_implicit_version_guard() {
    let table = TableDetail {
        table: Table {
            id: TableId::new(),
            database_id: DatabaseId::new(),
            name: "Deals".into(),
            position: "80".parse().unwrap(),
            version: TableVersion(7),
        },
        sql_name: "\"Deals\"".into(),
        columns: vec![],
        views: vec![],
    };
    let fields = CommercialFields::default();
    let mut rows = OpBatch::from(vec![DatabaseOp::Rows {
        table: table.table.id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![RowId::new()],
                cells: vec![CellWrite {
                    column: ColumnId::new(),
                    value: CellValue::Number(125.0),
                }],
            },
        },
    }]);
    fields.prepare(&table, &mut rows).unwrap();
    assert!(rows.base_versions.is_empty());
    rows.base_versions.insert(table.table.id, TableVersion(3));
    fields.prepare(&table, &mut rows).unwrap();
    assert_eq!(rows.base_versions[&table.table.id], TableVersion(3));

    let mut layout = OpBatch::from(vec![DatabaseOp::View {
        table: table.table.id,
        view: ViewId::new(),
        change: ViewChange::Delete,
    }]);
    fields.prepare(&table, &mut layout).unwrap();
    assert_eq!(layout.base_versions[&table.table.id], TableVersion(7));
    layout.base_versions.insert(table.table.id, TableVersion(3));
    fields.prepare(&table, &mut layout).unwrap();
    assert_eq!(layout.base_versions[&table.table.id], TableVersion(3));
}
