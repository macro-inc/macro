#![allow(clippy::unwrap_used)]

// Ranges read as a whole. A function that walks a whole column or row visits
// only the sheet's used area; the remainder is put on record as one
// rectangle read empty (`clip_to_used_area`, `record_seen_empty_range`), so
// that a spill into it restarts the pass like a spill into a recorded cell,
// and so that a whole-column read does not record one entry per cell.

use crate::test::util::new_empty_model;
use crate::Model;

fn restarts(model: &Model) -> u32 {
    model.evaluation.restarts_in_last_evaluation
}

fn anchor_order(model: &Model) -> Vec<String> {
    model
        .evaluation
        .anchor_order
        .iter()
        .map(|a| {
            let column = (b'A' + (a.column - 1) as u8) as char;
            format!("{column}{}", a.row)
        })
        .collect()
}

//         ║       A          |       B        |       C        |       D        |
// ════════╬══════════════════╪════════════════╪════════════════╪════════════════╪
//    1    ║ =SEQUENCE(1,1,SUM(D:D)) |         | =SEQUENCE(3,1,10) | =SEQUENCE(5) |
//
// A1 is an anchor that sums a whole column, and runs first. The used area
// ends at row 3 (C1's spill) when the sum clips D:D, and D1, evaluated on
// demand by the walk, spills to row 5. The rows the walk skipped were on
// record: D1's commit contradicts them, and A1 is recomputed after D1.
// Before the record existed, A1 kept the sum of the three rows it walked.
#[test]
fn a_spill_beyond_the_used_area_restarts_the_anchor_that_summed_the_column() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,SUM(D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "15");
    assert_eq!(model._get_text("D5"), "5");
    assert_eq!(restarts(&model), 1);
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
    let order = anchor_order(&model);
    let position = |cell: &str| order.iter().position(|c| c == cell).unwrap();
    assert!(position("D1") < position("A1"));

    model.evaluate();
    assert_eq!(model._get_text("A1"), "15");
    assert_eq!(restarts(&model), 0);
}

// The spill lands entirely outside the used area at the time of the read:
// B7:B10 is the used area, D12 spills below it. Same mechanism.
#[test]
fn a_spill_entirely_beyond_the_used_area_is_seen() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,SUM(D:D))");
    model._set("B7", "=SEQUENCE(4)");
    model._set("D12", "=SEQUENCE(2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(restarts(&model), 1);
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// COUNTIF clips differently: it counts the cells beyond the used area as
// empty without visiting them. They are on record all the same.
#[test]
fn a_countif_over_a_whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,COUNTIF(D:D,\">0\"))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(restarts(&model), 1);
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// A whole-row read, the other direction of the clip.
#[test]
fn a_spill_beyond_the_used_area_of_a_whole_row_is_seen() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,SUM(3:3))");
    model._set("A3", "=SEQUENCE(1,5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "15");
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// A reader that is not an anchor runs after every anchor has spilled, so it
// needs no restart at all.
#[test]
fn an_ordinary_formula_summing_a_whole_column_needs_no_restart() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM(D:D)");
    model._set("D1", "=SEQUENCE(3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "6");
    assert_eq!(restarts(&model), 0);
}

// The skipped remainder of a whole-column read is one rectangle, not a
// record per cell: the records after an evaluation hold nothing beyond
// the cells actually visited.
#[test]
fn a_whole_column_read_records_one_rectangle() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM(D:D)");
    model._set("D1", "1");
    model._set("D2", "2");
    model._set("D3", "");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert!(
        model.evaluation.seen.len() <= 4,
        "{:?}",
        model.evaluation.seen
    );
    assert_eq!(model.evaluation.seen_ranges.len(), 1);
    let range = model.evaluation.seen_ranges[0];
    assert_eq!((range.column1, range.column2), (4, 4));
    assert!(range.row1 <= 4);
    assert_eq!(range.row2, crate::constants::LAST_ROW);
}

// XLOOKUP clips its whole-column arrays like the others; it has no test
// file of its own, so its case lives here. The other clipped functions are
// tested the same way in their own files.
#[test]
fn an_xlookup_over_a_whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,XLOOKUP(5,D:D,D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(restarts(&model), 1);
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());

    model.evaluate();
    assert_eq!(model._get_text("A1"), "5");
    assert_eq!(restarts(&model), 0);
}
