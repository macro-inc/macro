#![allow(clippy::unwrap_used)]
#![allow(clippy::panic)]

use bitcode::decode;

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    test::util::new_empty_model,
    user_model::history::{Diff, QueueDiffs},
    UserModel,
};

fn last_diff_list(model: &mut UserModel) -> Vec<Diff> {
    let bytes = model.flush_send_queue();
    let queue: Vec<QueueDiffs> = decode(&bytes).unwrap();
    // Get the last operation's diff list
    queue.last().unwrap().list.clone()
}

#[test]
fn diff_invariant_insert_rows() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    assert!(model.insert_rows(0, 5, 3).is_ok());

    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    assert!(matches!(
        &list[0],
        Diff::InsertRows {
            sheet: 0,
            row: 5,
            count: 3
        }
    ));
}

#[test]
fn diff_invariant_insert_columns() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    assert!(model.insert_columns(0, 2, 4).is_ok());
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    assert!(matches!(
        &list[0],
        Diff::InsertColumns {
            sheet: 0,
            column: 2,
            count: 4
        }
    ));
}

#[test]
fn undo_redo_after_batch_delete() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Place values that will shift.
    model.set_user_input(0, 20, 1, "A").unwrap();
    model.set_user_input(0, 1, 20, "B").unwrap();

    // Fill some of the rows we are about to delete for testing
    for r in 10..15 {
        model.set_user_input(0, r, 1, "tmp").unwrap();
    }

    // Delete rows 10..14 and columns 5..8
    assert!(model.delete_rows(0, 10, 5).is_ok());
    assert!(model.delete_columns(0, 5, 4).is_ok());

    // Verify shift
    assert_eq!(model.get_formatted_cell_value(0, 15, 1).unwrap(), "A");
    assert_eq!(model.get_formatted_cell_value(0, 1, 16).unwrap(), "B");

    // Undo
    model.undo().unwrap(); // columns
    model.undo().unwrap(); // rows
    assert_eq!(model.get_formatted_cell_value(0, 20, 1).unwrap(), "A");
    assert_eq!(model.get_formatted_cell_value(0, 1, 20).unwrap(), "B");

    // Redo
    model.redo().unwrap(); // rows
    model.redo().unwrap(); // columns
    assert_eq!(model.get_formatted_cell_value(0, 15, 1).unwrap(), "A");
    assert_eq!(model.get_formatted_cell_value(0, 1, 16).unwrap(), "B");
}

#[test]
fn diff_order_delete_rows() {
    // Verifies that delete diffs are generated with all data preserved
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Populate rows to delete
    for r in 5..10 {
        model.set_user_input(0, r, 1, &r.to_string()).unwrap();
    }

    assert!(model.delete_rows(0, 5, 5).is_ok());

    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);

    // Should have one bulk diff with all the row data
    match &list[0] {
        Diff::DeleteRows {
            sheet,
            row,
            count,
            old_data,
        } => {
            assert_eq!(*sheet, 0);
            assert_eq!(*row, 5);
            assert_eq!(*count, 5);
            assert_eq!(old_data.len(), 5);
            // Verify the data was collected for each row
            for (i, row_data) in old_data.iter().enumerate() {
                let _expected_value = (5 + i).to_string();
                assert!(row_data.data.contains_key(&1));
            }
        }
        _ => panic!("Unexpected diff variant"),
    }
}

#[test]
fn batch_operations_with_formulas() {
    // Verifies formulas update correctly after batch ops
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    model.set_user_input(0, 1, 1, "10").unwrap();
    model.set_user_input(0, 5, 1, "=A1*2").unwrap(); // Will become A3 after insert

    assert!(model.insert_rows(0, 2, 2).is_ok());

    // Formula should now reference A1 (unchanged) but be in row 7
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "20");
    assert_eq!(model.get_cell_content(0, 7, 1).unwrap(), "=A1*2");

    // Undo and verify formula is back at original position
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "20");
}

#[test]
fn edge_case_single_operation() {
    // Single row/column operations should still work correctly
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    assert!(model.insert_rows(0, 1, 1).is_ok());
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);

    assert!(model.insert_columns(0, 1, 1).is_ok());
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
}

#[test]
fn delete_empty_rows() {
    // Delete multiple empty rows and verify behavior
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set data in rows 1 and 10, leaving rows 5-8 empty
    model.set_user_input(0, 1, 1, "Before").unwrap();
    model.set_user_input(0, 10, 1, "After").unwrap();

    // Delete empty rows 5-8
    assert!(model.delete_rows(0, 5, 4).is_ok());

    // Verify shift
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "Before");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "After");

    // Verify diffs now use bulk operation
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    match &list[0] {
        Diff::DeleteRows {
            sheet,
            row,
            count,
            old_data,
        } => {
            assert_eq!(*sheet, 0);
            assert_eq!(*row, 5);
            assert_eq!(*count, 4);
            assert_eq!(old_data.len(), 4);
            // All rows should be empty
            for row_data in old_data {
                assert!(row_data.data.is_empty());
            }
        }
        _ => panic!("Unexpected diff variant"),
    }

    // Undo/redo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "After");
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "After");
}

#[test]
fn delete_mixed_empty_and_filled_rows() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Alternating filled and empty rows
    model.set_user_input(0, 5, 1, "Row5").unwrap();
    model.set_user_input(0, 7, 1, "Row7").unwrap();
    model.set_user_input(0, 9, 1, "Row9").unwrap();
    model.set_user_input(0, 10, 1, "After").unwrap();

    assert!(model.delete_rows(0, 5, 5).is_ok());
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "After");

    // Verify mix of empty and filled row diffs
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    match &list[0] {
        Diff::DeleteRows {
            sheet,
            row,
            count,
            old_data,
        } => {
            assert_eq!(*sheet, 0);
            assert_eq!(*row, 5);
            assert_eq!(*count, 5);
            assert_eq!(old_data.len(), 5);

            // Count filled rows (should be 3: rows 5, 7, 9)
            let filled_count = old_data
                .iter()
                .filter(|row_data| !row_data.data.is_empty())
                .count();
            assert_eq!(filled_count, 3);
        }
        _ => panic!("Unexpected diff variant"),
    }

    // Undo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "Row5");
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "Row7");
    assert_eq!(model.get_formatted_cell_value(0, 9, 1).unwrap(), "Row9");
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "After");
}

#[test]
fn bulk_insert_rows_undo_redo() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up initial data
    model.set_user_input(0, 1, 1, "A1").unwrap();
    model.set_user_input(0, 2, 1, "A2").unwrap();
    model.set_user_input(0, 5, 1, "A5").unwrap();

    // Insert 3 rows at position 3
    assert!(model.insert_rows(0, 3, 3).is_ok());

    // Verify data has shifted
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "A1");
    assert_eq!(model.get_formatted_cell_value(0, 2, 1).unwrap(), "A2");
    assert_eq!(model.get_formatted_cell_value(0, 8, 1).unwrap(), "A5"); // A5 moved to A8

    // Check diff structure
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    assert!(matches!(
        &list[0],
        Diff::InsertRows {
            sheet: 0,
            row: 3,
            count: 3
        }
    ));

    // Undo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "A5"); // Back to original position

    // Redo
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 8, 1).unwrap(), "A5"); // Shifted again
}

#[test]
fn bulk_insert_columns_undo_redo() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up initial data
    model.set_user_input(0, 1, 1, "A1").unwrap();
    model.set_user_input(0, 1, 2, "B1").unwrap();
    model.set_user_input(0, 1, 5, "E1").unwrap();

    // Insert 3 columns at position 3
    assert!(model.insert_columns(0, 3, 3).is_ok());

    // Verify data has shifted
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "A1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 2).unwrap(), "B1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 8).unwrap(), "E1"); // E1 moved to H1

    // Check diff structure
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    assert!(matches!(
        &list[0],
        Diff::InsertColumns {
            sheet: 0,
            column: 3,
            count: 3
        }
    ));

    // Undo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 5).unwrap(), "E1"); // Back to original position

    // Redo
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 8).unwrap(), "E1"); // Shifted again
}

#[test]
fn bulk_delete_rows_round_trip() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up data with styles
    model.set_user_input(0, 3, 1, "Row3").unwrap();
    model.set_user_input(0, 4, 1, "Row4").unwrap();
    model.set_user_input(0, 5, 1, "Row5").unwrap();
    model.set_user_input(0, 6, 1, "Row6").unwrap();
    model.set_user_input(0, 7, 1, "After").unwrap();

    // Set some row heights to verify they're preserved
    model.set_rows_height(0, 4, 4, 30.0).unwrap();
    model.set_rows_height(0, 5, 5, 40.0).unwrap();

    // Delete rows 3-6
    assert!(model.delete_rows(0, 3, 4).is_ok());

    // Verify deletion
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "After");

    // Check diff structure
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    match &list[0] {
        Diff::DeleteRows {
            sheet,
            row,
            count,
            old_data,
        } => {
            assert_eq!(*sheet, 0);
            assert_eq!(*row, 3);
            assert_eq!(*count, 4);
            assert_eq!(old_data.len(), 4);
            // Verify data was preserved
            assert!(old_data[0].data.contains_key(&1)); // Row3
            assert!(old_data[1].data.contains_key(&1)); // Row4
            assert!(old_data[2].data.contains_key(&1)); // Row5
            assert!(old_data[3].data.contains_key(&1)); // Row6
        }
        _ => panic!("Expected DeleteRows diff"),
    }

    // Undo - should restore all data and row heights
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "Row3");
    assert_eq!(model.get_formatted_cell_value(0, 4, 1).unwrap(), "Row4");
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "Row5");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "Row6");
    assert_eq!(model.get_formatted_cell_value(0, 7, 1).unwrap(), "After");
    assert_eq!(model.get_row_height(0, 4).unwrap(), 30.0);
    assert_eq!(model.get_row_height(0, 5).unwrap(), 40.0);

    // Redo - should delete again
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "After");

    // Final undo to verify round-trip
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 3, 1).unwrap(), "Row3");
    assert_eq!(model.get_formatted_cell_value(0, 4, 1).unwrap(), "Row4");
    assert_eq!(model.get_formatted_cell_value(0, 5, 1).unwrap(), "Row5");
    assert_eq!(model.get_formatted_cell_value(0, 6, 1).unwrap(), "Row6");
}

#[test]
fn bulk_delete_columns_round_trip() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up data with styles
    model.set_user_input(0, 1, 3, "C1").unwrap();
    model.set_user_input(0, 1, 4, "D1").unwrap();
    model.set_user_input(0, 1, 5, "E1").unwrap();
    model.set_user_input(0, 1, 6, "F1").unwrap();
    model.set_user_input(0, 1, 7, "After").unwrap();

    // Set some column widths to verify they're preserved
    model.set_columns_width(0, 4, 4, 100.0).unwrap();
    model.set_columns_width(0, 5, 5, 120.0).unwrap();

    // Delete columns 3-6
    assert!(model.delete_columns(0, 3, 4).is_ok());

    // Verify deletion
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "After");

    // Check diff structure
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    match &list[0] {
        Diff::DeleteColumns {
            sheet,
            column,
            count,
            old_data,
        } => {
            assert_eq!(*sheet, 0);
            assert_eq!(*column, 3);
            assert_eq!(*count, 4);
            assert_eq!(old_data.len(), 4);
            // Verify data was preserved
            assert!(old_data[0].data.contains_key(&1)); // C1
            assert!(old_data[1].data.contains_key(&1)); // D1
            assert!(old_data[2].data.contains_key(&1)); // E1
            assert!(old_data[3].data.contains_key(&1)); // F1
        }
        _ => panic!("Expected DeleteColumns diff"),
    }

    // Undo - should restore all data and column widths
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "C1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 4).unwrap(), "D1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 5).unwrap(), "E1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "F1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 7).unwrap(), "After");
    assert_eq!(model.get_column_width(0, 4).unwrap(), 100.0);
    assert_eq!(model.get_column_width(0, 5).unwrap(), 120.0);

    // Redo - should delete again
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "After");

    // Final undo to verify round-trip
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 3).unwrap(), "C1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 4).unwrap(), "D1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 5).unwrap(), "E1");
    assert_eq!(model.get_formatted_cell_value(0, 1, 6).unwrap(), "F1");
}

#[test]
fn complex_bulk_operations_sequence() {
    // Test a complex sequence of bulk operations
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Initial setup
    model.set_user_input(0, 1, 1, "A1").unwrap();
    model.set_user_input(0, 2, 2, "B2").unwrap();
    model.set_user_input(0, 3, 3, "C3").unwrap();

    // Operation 1: Insert 2 rows at position 2
    model.insert_rows(0, 2, 2).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "A1");
    assert_eq!(model.get_formatted_cell_value(0, 4, 2).unwrap(), "B2"); // B2 moved down
    assert_eq!(model.get_formatted_cell_value(0, 5, 3).unwrap(), "C3"); // C3 moved down

    // Operation 2: Insert 2 columns at position 2
    model.insert_columns(0, 2, 2).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "A1");
    assert_eq!(model.get_formatted_cell_value(0, 4, 4).unwrap(), "B2"); // B2 moved right
    assert_eq!(model.get_formatted_cell_value(0, 5, 5).unwrap(), "C3"); // C3 moved right

    // Operation 3: Delete the inserted rows
    model.delete_rows(0, 2, 2).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 4).unwrap(), "B2");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "C3");

    // Undo all operations
    model.undo().unwrap(); // Undo delete rows
    assert_eq!(model.get_formatted_cell_value(0, 4, 4).unwrap(), "B2");
    assert_eq!(model.get_formatted_cell_value(0, 5, 5).unwrap(), "C3");

    model.undo().unwrap(); // Undo insert columns
    assert_eq!(model.get_formatted_cell_value(0, 4, 2).unwrap(), "B2");
    assert_eq!(model.get_formatted_cell_value(0, 5, 3).unwrap(), "C3");

    model.undo().unwrap(); // Undo insert rows
    assert_eq!(model.get_formatted_cell_value(0, 2, 2).unwrap(), "B2");
    assert_eq!(model.get_formatted_cell_value(0, 3, 3).unwrap(), "C3");

    // Redo all operations
    model.redo().unwrap(); // Redo insert rows
    model.redo().unwrap(); // Redo insert columns
    model.redo().unwrap(); // Redo delete rows
    assert_eq!(model.get_formatted_cell_value(0, 2, 4).unwrap(), "B2");
    assert_eq!(model.get_formatted_cell_value(0, 3, 5).unwrap(), "C3");
}

#[test]
fn bulk_operations_with_formulas_update() {
    // Test that formulas update correctly with bulk operations
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up data and formulas
    model.set_user_input(0, 1, 1, "10").unwrap();
    model.set_user_input(0, 5, 1, "20").unwrap();
    model.set_user_input(0, 10, 1, "=A1+A5").unwrap(); // Formula referencing A1 and A5

    // Insert 3 rows at position 3
    model.insert_rows(0, 3, 3).unwrap();

    // Formula should update to reference the shifted cells
    assert_eq!(model.get_formatted_cell_value(0, 13, 1).unwrap(), "30"); // Formula moved down
    assert_eq!(model.get_cell_content(0, 13, 1).unwrap(), "=A1+A8"); // A5 became A8

    // Undo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 10, 1).unwrap(), "30");
    assert_eq!(model.get_cell_content(0, 10, 1).unwrap(), "=A1+A5");

    // Now test column insertion
    model.set_user_input(0, 1, 5, "20").unwrap(); // Add value in E1
    model.set_user_input(0, 1, 10, "=A1+E1").unwrap();
    model.insert_columns(0, 3, 2).unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 1, 12).unwrap(), "30"); // Formula moved right
    assert_eq!(model.get_cell_content(0, 1, 12).unwrap(), "=A1+G1"); // E1 became G1
}

#[test]
fn bulk_delete_with_styles() {
    // Test that cell and row/column styles are preserved
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Set up data with various styles
    for r in 5..10 {
        model.set_user_input(0, r, 1, &format!("Row{r}")).unwrap();
        model.set_rows_height(0, r, r, (r * 10) as f64).unwrap();
    }

    // Delete and verify style preservation
    model.delete_rows(0, 5, 5).unwrap();

    // Undo should restore all styles
    model.undo().unwrap();
    for r in 5..10 {
        assert_eq!(
            model.get_formatted_cell_value(0, r, 1).unwrap(),
            format!("Row{r}")
        );
        assert_eq!(model.get_row_height(0, r).unwrap(), (r * 10) as f64);
    }
}

#[test]
fn bulk_operations_large_count() {
    // Test operations with large counts
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Insert a large number of rows
    model.set_user_input(0, 1, 1, "Before").unwrap();
    model.set_user_input(0, 100, 1, "After").unwrap();

    assert!(model.insert_rows(0, 50, 100).is_ok());

    // Verify shift
    assert_eq!(model.get_formatted_cell_value(0, 1, 1).unwrap(), "Before");
    assert_eq!(model.get_formatted_cell_value(0, 200, 1).unwrap(), "After"); // Moved by 100

    // Check diff
    let list = last_diff_list(&mut model);
    assert_eq!(list.len(), 1);
    assert!(matches!(
        &list[0],
        Diff::InsertRows {
            sheet: 0,
            row: 50,
            count: 100
        }
    ));

    // Undo and redo
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 100, 1).unwrap(), "After");

    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 200, 1).unwrap(), "After");
}

#[test]
fn bulk_operations_error_cases() {
    // Test error conditions
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Negative count should fail
    assert!(model.insert_rows(0, 1, -5).is_err());
    assert!(model.insert_columns(0, 1, -5).is_err());
    assert!(model.delete_rows(0, 1, -5).is_err());
    assert!(model.delete_columns(0, 1, -5).is_err());

    // Zero count should fail
    assert!(model.insert_rows(0, 1, 0).is_err());
    assert!(model.insert_columns(0, 1, 0).is_err());
    assert!(model.delete_rows(0, 1, 0).is_err());
    assert!(model.delete_columns(0, 1, 0).is_err());

    // Out of bounds operations should fail
    assert!(model.delete_rows(0, LAST_ROW - 5, 10).is_err());
    assert!(model.delete_columns(0, LAST_COLUMN - 5, 10).is_err());
}

#[test]
fn bulk_diff_serialization() {
    // Test that bulk diffs can be serialized/deserialized correctly
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Create some data
    model.set_user_input(0, 1, 1, "Test").unwrap();
    model.insert_rows(0, 2, 3).unwrap();

    // Flush and get the serialized diffs
    let bytes = model.flush_send_queue();

    // Create a new model and apply the diffs
    let base2 = new_empty_model();
    let mut model2 = UserModel::from_model(base2);

    assert!(model2.apply_external_diffs(&bytes).is_ok());

    // Verify the state matches
    assert_eq!(model2.get_formatted_cell_value(0, 1, 1).unwrap(), "Test");
}

#[test]
fn boundary_validation() {
    let base = new_empty_model();
    let mut model = UserModel::from_model(base);

    // Test deleting rows beyond valid range
    assert!(model.delete_rows(0, LAST_ROW, 2).is_err());
    assert!(model.delete_rows(0, LAST_ROW + 1, 1).is_err());

    // Test deleting columns beyond valid range
    assert!(model.delete_columns(0, LAST_COLUMN, 2).is_err());
    assert!(model.delete_columns(0, LAST_COLUMN + 1, 1).is_err());

    // Test valid boundary deletions (should work with our empty row fix)
    assert!(model.delete_rows(0, LAST_ROW, 1).is_ok());
    assert!(model.delete_columns(0, LAST_COLUMN, 1).is_ok());
}
