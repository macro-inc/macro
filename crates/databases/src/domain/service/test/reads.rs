//! Plain cell reads for a domain that decides access itself: a respondent's
//! own row and a column's cells for tallies, scoped to one live table.

use super::*;
use crate::domain::ports::DatabaseRowReads;

fn view(database_id: DatabaseId) -> EntityAccessReceipt<ViewAccessLevel> {
    receipt::<ViewAccessLevel>(database_id, OWNER, AccessLevel::Owner)
}

#[tokio::test]
async fn cells_of_rows_answers_each_row_of_the_table_as_ops_name_its_cells() {
    let seeded = seeded().await;
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );
    let empty_row = insert_names(&seeded, &[""]).await[0];
    // A row with nothing in it: clear the text the insert wrote.
    seeded.world.lock().unwrap().cells.remove(&empty_row);
    let stray = RowId::new();

    let cells = seeded
        .service
        .cells_of_rows(
            view(seeded.database_id),
            seeded.table_id,
            &[seeded.row_id, empty_row, stray],
        )
        .await
        .unwrap();

    assert_eq!(
        cells,
        HashMap::from([
            (
                seeded.row_id,
                vec![
                    CellWrite {
                        column: seeded.name_column.id,
                        value: CellValue::Text("Sam".into()),
                    },
                    CellWrite {
                        column: seeded.status_column.id,
                        value: CellValue::Options(vec![OptionRef::Id(going)]),
                    },
                    CellWrite {
                        column: seeded.plus_ones_column.id,
                        value: CellValue::Number(2.0),
                    },
                ],
            ),
            (empty_row, vec![]),
        ])
    );
}

#[tokio::test]
async fn column_cells_answers_one_columns_nonempty_cells_across_the_table() {
    let seeded = seeded().await;
    let going = option_id(
        &seeded.world,
        seeded.status_column.property_definition_id,
        "Going",
    );
    insert_names(&seeded, &["Alex"]).await;

    let cells = seeded
        .service
        .column_cells(
            view(seeded.database_id),
            seeded.table_id,
            seeded.status_column.id,
        )
        .await
        .unwrap();
    assert_eq!(
        cells,
        HashMap::from([(
            seeded.row_id,
            CellValue::Options(vec![OptionRef::Id(going)])
        )])
    );

    let unknown = seeded
        .service
        .column_cells(view(seeded.database_id), seeded.table_id, ColumnId::new())
        .await;
    assert!(matches!(unknown, Err(DatabaseError::NotFound)));
}

#[tokio::test]
async fn row_count_counts_the_tables_rows() {
    let seeded = seeded().await;
    assert_eq!(
        seeded
            .service
            .row_count(view(seeded.database_id), seeded.table_id)
            .await
            .unwrap(),
        1
    );
    insert_names(&seeded, &["Alex", "Kim"]).await;
    assert_eq!(
        seeded
            .service
            .row_count(view(seeded.database_id), seeded.table_id)
            .await
            .unwrap(),
        3
    );
}

#[tokio::test]
async fn reads_of_a_trashed_database_or_a_table_it_lacks_are_not_found() {
    let seeded = seeded().await;
    let other_table = TableId::new();
    assert!(matches!(
        seeded
            .service
            .row_count(view(seeded.database_id), other_table)
            .await,
        Err(DatabaseError::NotFound)
    ));
    assert!(matches!(
        seeded
            .service
            .cells_of_rows(view(seeded.database_id), other_table, &[seeded.row_id])
            .await,
        Err(DatabaseError::NotFound)
    ));

    seeded.world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    assert!(matches!(
        seeded
            .service
            .row_count(view(seeded.database_id), seeded.table_id)
            .await,
        Err(DatabaseError::NotFound)
    ));
    assert!(matches!(
        seeded
            .service
            .column_cells(
                view(seeded.database_id),
                seeded.table_id,
                seeded.status_column.id
            )
            .await,
        Err(DatabaseError::NotFound)
    ));
}
