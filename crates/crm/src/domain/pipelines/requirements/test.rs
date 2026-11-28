use super::*;
use databases::domain::models::{Table, TableVersion};

#[test]
fn a_row_inserted_with_a_client_id_and_moved_into_a_stage_needs_its_required_fields() {
    let table_id = TableId::from_uuid(Uuid::from_u128(1));
    let stage_column = ColumnId::from_uuid(Uuid::from_u128(2));
    let required_column = ColumnId::from_uuid(Uuid::from_u128(3));
    let stage = OptionId::from_uuid(Uuid::from_u128(4));
    let row = RowId::from_uuid(Uuid::from_u128(5));
    let table = TableDetail {
        table: Table {
            id: table_id,
            database_id: DatabaseId::from_uuid(Uuid::nil()),
            name: "Deals".to_owned(),
            position: "80".parse().unwrap(),
            version: TableVersion(1),
        },
        sql_name: "\"Sales\".\"Deals\"".to_owned(),
        columns: vec![],
        views: vec![],
    };
    let rules = [StageRequirement {
        stage_column_id: stage_column,
        stage_id: stage,
        required_column_ids: vec![required_column],
    }];
    let ops = [
        DatabaseOp::Rows {
            table: table_id,
            change: RowsChange::Insert {
                rows: vec![vec![]],
                ids: Some(vec![row]),
            },
        },
        DatabaseOp::Rows {
            table: table_id,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![row],
                    cells: vec![CellWrite {
                        column: stage_column,
                        value: CellValue::Options(vec![OptionRef::Id(stage)]),
                    }],
                },
            },
        },
    ];

    let refused = validate_batch(&table, &rules, vec![], &ops);

    assert!(
        matches!(
            refused,
            Err(PipelineError::Database(
                databases::domain::models::DatabaseError::InvalidOp(
                    databases::domain::models::OpRefusal {
                        op: 1,
                        column: Some(column),
                        ..
                    }
                )
            )) if column == required_column
        ),
        "{refused:?}"
    );
}
