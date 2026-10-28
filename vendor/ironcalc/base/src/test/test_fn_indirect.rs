#![allow(clippy::unwrap_used)]

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::model::Model;
use crate::test::util::new_empty_model;

/// A1:C2 holds 1, 2, 3 / 4, 5, 6
fn set_numbers(model: &mut Model, sheet: &str) {
    for (cell, value) in [
        ("A1", "1"),
        ("B1", "2"),
        ("C1", "3"),
        ("A2", "4"),
        ("B2", "5"),
        ("C2", "6"),
    ] {
        model._set(&format!("{sheet}!{cell}"), value);
    }
}

#[test]
fn a1_notation() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    model._set("E1", "=INDIRECT(\"B2\")");
    model._set("E2", "=INDIRECT(\"B2\", TRUE)");
    model._set("E3", "=INDIRECT(\"B2\", 1)");
    model._set("E4", "=SUM(INDIRECT(\"A1:C2\", TRUE))");
    // Not R1C1 unless asked for
    model._set("E5", "=INDIRECT(\"R2C2\")");
    model._set("E6", "=INDIRECT(\"R2C2\", TRUE)");
    model.evaluate();

    assert_eq!(model._get_text("E1"), *"5");
    assert_eq!(model._get_text("E2"), *"5");
    assert_eq!(model._get_text("E3"), *"5");
    assert_eq!(model._get_text("E4"), *"21");
    assert_eq!(model._get_text("E5"), *"#REF!");
    assert_eq!(model._get_text("E6"), *"#REF!");
}

#[test]
fn r1c1_notation() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    model._set("E1", "=INDIRECT(\"R2C2\", FALSE)");
    model._set("E2", "=INDIRECT(\"R1C3\", 0)");
    model._set("E3", "=INDIRECT(\"r2c1\", FALSE)");
    model._set("E4", "=SUM(INDIRECT(\"R1C1:R2C3\", FALSE))");
    model._set("E5", "=SUM(INDIRECT(\"R2C3:R1C2\", FALSE))");
    // An empty argument is FALSE
    model._set("E6", "=INDIRECT(\"R2C2\",)");
    // Not A1
    model._set("E7", "=INDIRECT(\"B2\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("E1"), *"5");
    assert_eq!(model._get_text("E2"), *"3");
    assert_eq!(model._get_text("E3"), *"4");
    assert_eq!(model._get_text("E4"), *"21");
    assert_eq!(model._get_text("E5"), *"16");
    assert_eq!(model._get_text("E6"), *"5");
    assert_eq!(model._get_text("E7"), *"#REF!");
}

#[test]
fn r1c1_relative_to_the_cell() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    // From B3: one up is B2, one up and one left is A2
    model._set("B3", "=INDIRECT(\"R[-1]C\", FALSE)");
    model._set("C3", "=INDIRECT(\"R[-1]C[-2]\", FALSE)");
    model._set("D2", "=INDIRECT(\"RC[-1]\", FALSE)");
    model._set("D1", "=INDIRECT(\"R2C\", FALSE)");
    model._set("E2", "=INDIRECT(\"RC1\", FALSE)");
    model._set("F5", "=SUM(INDIRECT(\"R[-4]C[-5]:R[-3]C[-3]\", FALSE))");
    // Before the first row: it goes round to the last row, which is empty
    model._set("F6", "=INDIRECT(\"R[-6]C\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("B3"), *"5");
    assert_eq!(model._get_text("C3"), *"4");
    assert_eq!(model._get_text("D2"), *"6");
    // D1 reads D2
    assert_eq!(model._get_text("D1"), *"6");
    assert_eq!(model._get_text("E2"), *"4");
    assert_eq!(model._get_text("F5"), *"21");
    assert_eq!(model._get_text("F6"), *"0");
}

#[test]
fn r1c1_offsets_go_round_the_sheet() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    // The last row and the last column
    model
        .set_user_input(0, LAST_ROW, 6, "42".to_string())
        .unwrap();
    model
        .set_user_input(0, LAST_ROW - 1, 6, "41".to_string())
        .unwrap();
    model
        .set_user_input(0, 2, LAST_COLUMN, "7".to_string())
        .unwrap();
    model
        .set_user_input(0, 2, LAST_COLUMN - 1, "8".to_string())
        .unwrap();
    // Column D: the first row, the second and the last
    model._set("D1", "1000");
    model._set("D2", "1");
    model
        .set_user_input(0, LAST_ROW, 4, "2".to_string())
        .unwrap();
    // Upwards from row 6: row 0 is the last row
    model._set("F6", "=INDIRECT(\"R[-6]C\", FALSE)");
    model._set("G6", "=INDIRECT(\"R[-7]C[-1]\", FALSE)");
    // To the left from column E: column 0 is the last column
    model._set("E2", "=INDIRECT(\"RC[-5]\", FALSE)");
    // Whole rows and columns: the row and the column before the last ones
    model._set("H3", "=SUM(INDIRECT(\"R[-4]\", FALSE))");
    model._set("H4", "=SUM(INDIRECT(\"C[-9]\", FALSE))");
    // A range from the last row to row 2 is rows 2 to the last, without row 1
    model._set("H5", "=SUM(INDIRECT(\"R[-5]C[-4]:R[-3]C[-4]\", FALSE))");
    // Downwards from the last row: the row after it is the first one
    model
        .set_user_input(0, LAST_ROW, 1, "=INDIRECT(\"R[1]C[1]\", FALSE)".to_string())
        .unwrap();
    // To the right from the last column
    model
        .set_user_input(
            0,
            1,
            LAST_COLUMN,
            "=INDIRECT(\"R[1]C[3]\", FALSE)".to_string(),
        )
        .unwrap();
    // Once round the sheet is too far
    model._set("H7", "=INDIRECT(\"R[-1048576]C\", FALSE)");
    model._set("H8", "=INDIRECT(\"RC[16384]\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("F6"), *"42");
    assert_eq!(model._get_text("G6"), *"41");
    assert_eq!(model._get_text("E2"), *"7");
    assert_eq!(model._get_text("H3"), *"41");
    assert_eq!(model._get_text("H4"), *"8");
    assert_eq!(model._get_text("H5"), *"3");
    assert_eq!(model._get_text_at(0, LAST_ROW, 1), *"2");
    assert_eq!(model._get_text_at(0, 1, LAST_COLUMN), *"6");
    assert_eq!(model._get_text("H7"), *"#REF!");
    assert_eq!(model._get_text("H8"), *"#REF!");
}

#[test]
fn r1c1_largest_offsets() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    // The lowest number an offset can be written with, and the highest
    model._set("E5", "=INDIRECT(\"R[-2147483648]C\", FALSE)");
    model._set("E6", "=INDIRECT(\"RC[-2147483648]\", FALSE)");
    model._set("E7", "=INDIRECT(\"R[2147483647]C[2147483647]\", FALSE)");
    model._set("E8", "=SUM(INDIRECT(\"C[-2147483648]\", FALSE))");
    model.evaluate();

    assert_eq!(model._get_text("E5"), *"#REF!");
    assert_eq!(model._get_text("E6"), *"#REF!");
    assert_eq!(model._get_text("E7"), *"#REF!");
    assert_eq!(model._get_text("E8"), *"#REF!");
}

#[test]
fn r1c1_in_other_sheets() {
    let mut model = new_empty_model();
    model.new_sheet();
    model.add_sheet("My sheet").unwrap();
    set_numbers(&mut model, "Sheet2");
    model.set_user_input(2, 2, 2, "50".to_string()).unwrap();
    model._set("A1", "=INDIRECT(\"Sheet2!R2C2\", FALSE)");
    model._set("A2", "=SUM(INDIRECT(\"sheet2!R1C1:R2C3\", FALSE))");
    model._set("A3", "=INDIRECT(\"'My sheet'!R2C2\", FALSE)");
    // Relative to the cell, in the other sheet
    model._set("A4", "=INDIRECT(\"Sheet2!R[-2]C[1]\", FALSE)");
    model._set("A5", "=INDIRECT(\"Sheet7!R2C2\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"5");
    assert_eq!(model._get_text("A2"), *"21");
    assert_eq!(model._get_text("A3"), *"50");
    assert_eq!(model._get_text("A4"), *"5");
    assert_eq!(model._get_text("A5"), *"#REF!");
}

#[test]
fn r1c1_range_spills() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    model._set("E1", "=INDIRECT(\"R1C1:R2C3\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("E1"), *"1");
    assert_eq!(model._get_text("F1"), *"2");
    assert_eq!(model._get_text("G1"), *"3");
    assert_eq!(model._get_text("E2"), *"4");
    assert_eq!(model._get_text("F2"), *"5");
    assert_eq!(model._get_text("G2"), *"6");
    assert_eq!(model._get_text("H1"), *"");
    assert_eq!(model._get_text("E3"), *"");
}

#[test]
fn r1c1_whole_rows_and_columns() {
    let mut model = new_empty_model();
    model.new_sheet();
    set_numbers(&mut model, "Sheet2");
    model._set("A1", "=SUM(INDIRECT(\"Sheet2!C2\", FALSE))");
    model._set("A2", "=SUM(INDIRECT(\"Sheet2!R2\", FALSE))");
    model._set("A3", "=SUM(INDIRECT(\"Sheet2!C2:C3\", FALSE))");
    model._set("A4", "=SUM(INDIRECT(\"Sheet2!R1:R2\", FALSE))");
    // The column of the cell, and the next one
    model._set("A5", "=SUM(INDIRECT(\"Sheet2!C\", FALSE))");
    model._set("A6", "=SUM(INDIRECT(\"Sheet2!C[1]\", FALSE))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"7");
    assert_eq!(model._get_text("A2"), *"15");
    assert_eq!(model._get_text("A3"), *"16");
    assert_eq!(model._get_text("A4"), *"21");
    assert_eq!(model._get_text("A5"), *"5");
    assert_eq!(model._get_text("A6"), *"7");
}

#[test]
fn r1c1_reference_built_from_cells() {
    // A weight matrix and a bias in another sheet, addressed by name and size
    let mut model = new_empty_model();
    model.add_sheet("model_h0_w").unwrap();
    model.add_sheet("model_h0_b").unwrap();
    set_numbers(&mut model, "model_h0_w");
    model._set("model_h0_b!A1", "100");
    model._set("model_h0_b!B1", "200");
    model._set("model_h0_b!C1", "300");
    model._set("F1", "0");
    model._set("F2", "3");
    model._set("F3", "=\"model_h\"&F1&\"_w!R1C1:R2C\"&F2");
    model._set("F4", "=\"model_h\"&F1&\"_b!R1C1:R1C\"&F2");
    // A row of two numbers times the 2x3 matrix, plus the bias
    model._set("A1", "1");
    model._set("B1", "10");
    model._set(
        "A3",
        "=MMULT(A1:B1, INDIRECT(F3, FALSE))+INDIRECT(F4, FALSE)",
    );
    // The numbers of the row times the weights, element by element
    model._set("A5", "=A1:B1*INDIRECT(\"model_h0_w!R1C1:R2C2\", FALSE)");
    model.evaluate();

    assert_eq!(model._get_text("F3"), *"model_h0_w!R1C1:R2C3");
    assert_eq!(model._get_text("A3"), *"141");
    assert_eq!(model._get_text("B3"), *"252");
    assert_eq!(model._get_text("C3"), *"363");

    assert_eq!(model._get_text("A5"), *"1");
    assert_eq!(model._get_text("B5"), *"20");
    assert_eq!(model._get_text("A6"), *"4");
    assert_eq!(model._get_text("B6"), *"50");
}

#[test]
fn errors() {
    let mut model = new_empty_model();
    set_numbers(&mut model, "Sheet1");
    model._set("E1", "=INDIRECT()");
    model._set("E2", "=INDIRECT(\"R1C1\", FALSE, 1)");
    model._set("E3", "=INDIRECT(\"\", FALSE)");
    model._set("E4", "=INDIRECT(\"R0C1\", FALSE)");
    model._set("E5", "=INDIRECT(\"R1C1:R2\", FALSE)");
    model._set("E6", "=INDIRECT(\"R1C1\", \"no\")");
    model._set("E7", "=INDIRECT(1/0, FALSE)");
    model._set("E8", "=INDIRECT(\"R1C1\", 1/0)");
    model.evaluate();

    assert_eq!(model._get_text("E1"), *"#ERROR!");
    assert_eq!(model._get_text("E2"), *"#ERROR!");
    assert_eq!(model._get_text("E3"), *"#REF!");
    assert_eq!(model._get_text("E4"), *"#REF!");
    assert_eq!(model._get_text("E5"), *"#REF!");
    assert_eq!(model._get_text("E6"), *"#VALUE!");
    assert_eq!(model._get_text("E7"), *"#DIV/0!");
    assert_eq!(model._get_text("E8"), *"#DIV/0!");
}
