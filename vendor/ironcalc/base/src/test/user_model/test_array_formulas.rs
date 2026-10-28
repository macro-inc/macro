#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn basic() {
    let mut model = new_empty_user_model();

    // Let's put an array formula in C2:F3
    let sheet = 0;
    let row = 1;
    let column = 2;
    let width = 4;
    let height = 2;
    let formula = "={1,2,3,4;5,6,7,8}";
    model
        .set_user_array_formula(sheet, row, column, width, height, formula)
        .unwrap();

    // Check that the formula is correctly set in the top-left cell
    let cell_c2 = model.get_cell_content(sheet, row, column).unwrap();
    assert_eq!(cell_c2, formula);

    // Check D3, for instance
    let cell_d3 = model.get_cell_content(sheet, row + 1, column + 1).unwrap();
    assert_eq!(cell_d3, "6");

    // Let's undo and check that the cells are cleared
    model.undo().unwrap();
    let cell_c2_after_undo = model.get_cell_content(sheet, row, column).unwrap();
    assert_eq!(cell_c2_after_undo, "");
    let cell_d3_after_undo = model.get_cell_content(sheet, row + 1, column + 1).unwrap();
    assert_eq!(cell_d3_after_undo, "");

    // Let's redo and check that the formula is back
    model.redo().unwrap();
    let cell_c2_after_redo = model.get_cell_content(sheet, row, column).unwrap();
    assert_eq!(cell_c2_after_redo, formula);
    let cell_d3_after_redo = model.get_cell_content(sheet, row + 1, column + 1).unwrap();
    assert_eq!(cell_d3_after_redo, "6");
}
