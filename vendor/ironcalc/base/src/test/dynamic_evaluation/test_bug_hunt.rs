#![allow(clippy::unwrap_used, clippy::panic)]

// A battery of tests aimed at the evaluation algorithm.
// Each test targets one angle from which stale values, false
// cycles or order/history dependence could sneak in. Tests that fail
// document a bug; they are deliberately not fixed here.
//
// Every test that evaluates twice checks the fixed-point property along the
// way: the second evaluation must not change anything.

use crate::cell::CellValue;
use crate::expressions::types::Area;

use crate::test::util::new_empty_model;
use crate::Model;
use crate::UserModel;

fn number(model: &Model, cell: &str) -> f64 {
    match model.get_cell_value_by_ref(cell) {
        Ok(CellValue::Number(n)) => n,
        other => panic!("{cell} is not a number: {other:?}"),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CSE array formulas
// ═══════════════════════════════════════════════════════════════════════════

//         ║    A    |    B    |
// ════════╬═════════╪═════════╪
//    1    ║ =B2*2   | {=5}    |
//    2    ║         | {=5}    |
//
// `set_user_array_formula` fills the CSE area with empty *string* placeholders,
// not spill cells. A reader that runs before the CSE anchor gets a constant
// ("") back, so the read is not recorded and the reader is never retracted.
#[test]
fn cse_placeholder_read_before_cse_anchor_evaluates() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 2, 1, 2, "=5").unwrap();
    model._set("A1", "=B2*2");

    model.evaluate();
    assert_eq!(model._get_text("B2"), "5");
    assert_eq!(model._get_text("A1"), "10");

    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
}

//         ║    A    |       B        |
// ════════╬═════════╪════════════════╪
//    1    ║ {=5}    | =SEQUENCE(A2+1)|
//    2    ║ {=5}    |                |
//
// Same placeholder problem, but the reader is a dynamic anchor, evaluated
// before any CSE anchor by the anchors-first heuristic.
#[test]
fn cse_placeholder_read_by_earlier_dynamic_anchor() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 1, 1, 2, "=5").unwrap();
    model._set("B1", "=SEQUENCE(A2+1)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A2"), "5");
        assert_eq!(model._get_text("B1"), "1");
        assert_eq!(model._get_text("B6"), "6");
    }
}

// {=A2+1} entered over A1:A2 reads its own spill cell. The spill-cell path
// evaluates the anchor, finds it `Evaluating`, discards that #CIRC! and
// returns whatever the spill cell currently holds.
#[test]
fn cse_reading_its_own_spill_cell_is_circular() {
    let mut model = new_empty_model();
    model
        .set_user_array_formula(0, 1, 1, 1, 2, "=A2+1")
        .unwrap();

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "#CIRC!");
        assert_eq!(model._get_text("A2"), "#CIRC!");
    }
}

// Two CSE arrays reading each other's spill cells.
#[test]
fn two_cse_arrays_reading_each_other_are_circular() {
    let mut model = new_empty_model();
    model
        .set_user_array_formula(0, 1, 1, 1, 2, "=B2+1")
        .unwrap();
    model
        .set_user_array_formula(0, 1, 2, 1, 2, "=A2+1")
        .unwrap();

    for _ in 0..2 {
        model.evaluate();
        for cell in ["A1", "A2", "B1", "B2"] {
            assert_eq!(model._get_text(cell), "#CIRC!", "{cell}");
        }
    }
}

//         ║    A     |       B       |
// ════════╬══════════╪═══════════════╪
//    1    ║ {=B1+1}  | =SEQUENCE(A2) |
//    2    ║ {=B1+1}  |               |
//
// A dynamic anchor reads a CSE spill cell whose anchor is being evaluated on
// its behalf: a cycle through a CSE area.
#[test]
fn dynamic_anchor_and_cse_array_reading_each_other_are_circular() {
    let mut model = new_empty_model();
    model
        .set_user_array_formula(0, 1, 1, 1, 2, "=B1+1")
        .unwrap();
    model._set("B1", "=SEQUENCE(A2)");

    let mut snapshots = Vec::new();
    for _ in 0..2 {
        model.evaluate();
        snapshots.push((
            model._get_text("A1"),
            model._get_text("A2"),
            model._get_text("B1"),
        ));
    }
    assert_eq!(snapshots[0], snapshots[1], "not a fixed point");
    assert_eq!(model._get_text("B1"), "#CIRC!");
}

//         ║    A    |       B       |      C       |
// ════════╬═════════╪═══════════════╪══════════════╪
//    1    ║ {=C3*2} | =SEQUENCE(A1) | =SEQUENCE(3) |
//    2    ║ {=C3*2} |               |              |
//
// B1 pulls the CSE anchor in before C1 has spilled; the CSE array must be
// retracted like any other reader when C3 is written.
#[test]
fn cse_array_reading_future_dynamic_spill_is_retracted() {
    let mut model = new_empty_model();
    model
        .set_user_array_formula(0, 1, 1, 1, 2, "=C3*2")
        .unwrap();
    model._set("B1", "=SEQUENCE(A1)");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "6");
        assert_eq!(model._get_text("A2"), "6");
        assert_eq!(model._get_text("B1"), "1");
        assert_eq!(model._get_text("B6"), "6");
    }
}

//         ║    A    |    B    |
// ════════╬═════════╪═════════╪
//    1    ║         | {=5}    |
//    2    ║ {=7}    | {=7}    |   <- A2:B2 overlaps B1:B2 at B2
//
// Placing a CSE array whose area overlaps another CSE array's area must be
// refused, as writing into a CSE cell is. `set_user_array_formula` used to
// prepare only the anchor position, so with the anchor outside the other area
// the second array was accepted and overwrote B2.
#[test]
fn cse_over_another_cse_area_is_refused() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 2, 1, 2, "=5").unwrap();
    let result = model.set_user_array_formula(0, 2, 1, 2, 1, "=7");
    assert!(result.is_err(), "overlapping CSE array was accepted");

    model.evaluate();
    assert_eq!(model._get_text("B1"), "5");
    assert_eq!(model._get_text("B2"), "5");
}

//         ║    B    |      C       |
// ════════╬═════════╪══════════════╪
//    5    ║ {=5}    | =SEQUENCE(2) |   <- B5:C5 covers the anchor C5
//    6    ║         |              |
//
// Same cause: covering a dynamic anchor with a CSE area did not clear the
// anchor's spill, so C6 survived as an orphan spill cell pointing at a cell
// that was no longer an anchor.
#[test]
fn cse_over_dynamic_anchor_clears_its_spill() {
    let mut model = new_empty_model();
    model._set("C5", "=SEQUENCE(2)");
    model.evaluate();
    assert_eq!(model._get_text("C6"), "2");

    model.set_user_array_formula(0, 5, 2, 2, 1, "=5").unwrap();
    model.evaluate();
    assert_eq!(model._get_text("B5"), "5");
    assert_eq!(model._get_text("C5"), "5");
    assert_eq!(model._get_text("C6"), "");
}

// `#` on a CSE anchor gives its declared range.
#[test]
fn spill_range_operator_on_cse_anchor() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 1, 1, 1, 2, "=5").unwrap();
    model._set("B1", "=SUM(A1#)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("B1"), "10");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ways of reaching a spill position other than a literal reference
// ═══════════════════════════════════════════════════════════════════════════

// In every test of this group the reader is the earlier anchor, so it runs
// before C1 has spilled and must be retracted when C1 writes.

#[test]
fn countblank_over_future_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(COUNTBLANK(C2:C3)+1)");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "1");
        assert_eq!(model._get_text("A2"), "");
    }
}

#[test]
fn isblank_of_future_spill_position() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(IF(ISBLANK(C3),1,3))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

#[test]
fn indirect_into_future_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(SUM(INDIRECT(\"C3\")))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

// Not an ordering issue, but found on the way: a reference returned by
// INDIRECT used to give #N/IMPL! inside a function argument that wants a
// number, even through arithmetic. It is now dereferenced like a value: a
// single cell gives its value, a larger range is intersected with the row or
// column of the formula, as in Excel's scalar context.
#[test]
fn sequence_of_indirect_reference() {
    let mut model = new_empty_model();
    model._set("C1", "=SEQUENCE(3)");
    model._set("A1", "=SEQUENCE(INDIRECT(\"C3\"))");
    model._set("B1", "=SEQUENCE(INDIRECT(\"C3\")*1)");

    model.evaluate();
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("B3"), "3");
}

#[test]
fn indirect_range_in_scalar_argument_intersects_with_the_row() {
    let mut model = new_empty_model();
    model._set("C1", "=SEQUENCE(3)");
    // Row 3 of C1:C3 is C3 = 3.
    model._set("A3", "=SEQUENCE(INDIRECT(\"C1:C3\"))");
    // Row 1 is outside C2:C3 and column A is outside column C: no intersection.
    model._set("E1", "=SEQUENCE(INDIRECT(\"C2:C3\"))");
    // The string and boolean casts dereference too.
    model._set("E2", "=LEN(INDIRECT(\"C2\"))");
    model._set("E3", "=IF(INDIRECT(\"C3\"),\"yes\",\"no\")");

    model.evaluate();
    assert_eq!(model._get_text("A3"), "1");
    assert_eq!(model._get_text("A5"), "3");
    assert_eq!(model._get_text("E1"), "#VALUE!");
    assert_eq!(model._get_text("E2"), "1");
    assert_eq!(model._get_text("E3"), "yes");
}

#[test]
fn defined_name_cell_into_future_spill_area() {
    let mut model = new_empty_model();
    model.new_defined_name("spot", None, "Sheet1!$C$3").unwrap();
    model._set("A1", "=SEQUENCE(spot)");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

#[test]
fn defined_name_range_over_future_spill_area() {
    let mut model = new_empty_model();
    model
        .new_defined_name("area", None, "Sheet1!$C$1:$C$3")
        .unwrap();
    model._set("A1", "=SEQUENCE(SUM(area))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A6"), "6");
    }
}

#[test]
fn let_binding_of_future_spill_position() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(LET(x,C3,x))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

#[test]
fn xlookup_into_future_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(XLOOKUP(3,C1:C3,C1:C3))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

#[test]
fn sumif_over_future_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(SUMIF(C1:C3,\">1\"))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A5"), "5");
    }
}

#[test]
fn rows_of_spill_range_before_anchor() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(ROWS(C1#))");
    model._set("C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

// The spill carries errors; the earlier reader must see the error, not the
// empty cell it read first.
#[test]
fn error_values_in_spill_read_by_earlier_anchor() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,C2)");
    model._set("C1", "=SEQUENCE(3)/0");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("C2"), "#DIV/0!");
        assert_eq!(model._get_text("A1"), "#DIV/0!");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stale reads inside a running evaluation (retract_when_done)
// ═══════════════════════════════════════════════════════════════════════════

//         ║       A       |      B       |    D    |    E    |
// ════════╬═══════════════╪══════════════╪═════════╪═════════╪
//    1    ║ =SEQUENCE(D1) | =SEQUENCE(3) | =B2+B1  | =A3     |
//
// The stale read happens in D1, a scalar in the middle of A1's evaluation:
// D1 reads B2 while empty, then B1, which spills B2. D1 is flagged, and the
// flag has to travel up to A1. E1 reads A3 during the sweep; if A1 spilled
// only one row at first, E1 must be retracted when A1 re-spills.
#[test]
fn stale_read_through_scalar_chain_is_redone() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(D1)");
    model._set("B1", "=SEQUENCE(3)");
    model._set("D1", "=B2+B1");
    model._set("E1", "=A3");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("D1"), "3");
        assert_eq!(model._get_text("A1"), "1");
        assert_eq!(model._get_text("A2"), "2");
        assert_eq!(model._get_text("A3"), "3");
        assert_eq!(model._get_text("E1"), "3");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Contention
// ═══════════════════════════════════════════════════════════════════════════

//         ║        A         |      B       |
// ════════╬══════════════════╪══════════════╪
//    1    ║ =SEQUENCE(1,1,B2)| =SEQUENCE(3) |
//    2    ║ =SEQUENCE(1,2)   |              |
//
// A1 runs first, reads B2 while empty. B1 wins B2 over A2. A1 must end up
// with the winner's value.
#[test]
fn earlier_reader_of_contended_cell_sees_winner() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,B2)");
    model._set("B1", "=SEQUENCE(3)");
    model._set("A2", "=SEQUENCE(1,2)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("B2"), "2");
        assert_eq!(model._get_text("A2"), "#SPILL!");
        assert_eq!(model._get_text("A1"), "2");
    }
}

//         ║          A          |      B       |
// ════════╬═════════════════════╪══════════════╪
//    1    ║ =SEQUENCE(1,1,A2+B2)| =SEQUENCE(3) |
//    2    ║ =SEQUENCE(1,2)      |              |
//
// A1 pulls A2 in first, so A2 spills into B2 and A1 reads it. B1, which
// runs later, finds B2 occupied: the existing spill keeps its cells and B1
// gets #SPILL!, even though B1 comes first in the sheet.
#[test]
fn existing_spill_blocks_an_anchor_earlier_in_the_sheet() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,A2+B2)");
    model._set("B1", "=SEQUENCE(3)");
    model._set("A2", "=SEQUENCE(1,2)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A2"), "1");
        assert_eq!(model._get_text("B2"), "2");
        assert_eq!(model._get_text("A1"), "3");
        assert_eq!(model._get_text("B1"), "#SPILL!");
    }
}

// Contention appears as an input changes between passes. The spill that
// exists (A2:C2) keeps its cells: C1, which now wants C1:C3, gets #SPILL!
// and A2 is untouched, even though C1 comes first in the sheet. A fresh
// model with the same contents resolves the other way, since C1 evaluates
// before A2 there: history is kept on purpose.
#[test]
fn contention_toggled_by_input_keeps_the_existing_spill() {
    let build = |a5: &str| {
        let mut model = new_empty_model();
        model._set("A5", a5);
        model._set("C1", "=SEQUENCE(A5)");
        model._set("A2", "=SEQUENCE(1,3)");
        model._set("D1", "=SUM(A2:C2)");
        model
    };

    let mut model = build("1");
    model.evaluate();
    assert_eq!(model._get_text("C2"), "3");
    assert_eq!(model._get_text("D1"), "6");

    model._set("A5", "3");
    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("C1"), "#SPILL!");
        assert_eq!(model._get_text("C2"), "3");
        assert_eq!(model._get_text("D1"), "6");
    }

    model._set("A5", "1");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("D1"), "6");

    let mut fresh = build("3");
    fresh.evaluate();
    assert_eq!(fresh._get_text("C2"), "2");
    assert_eq!(fresh._get_text("A2"), "#SPILL!");
}

// ═══════════════════════════════════════════════════════════════════════════
// Cycles
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn two_anchors_reading_each_others_value_are_circular() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(B1)");
    model._set("B1", "=SEQUENCE(A1)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "#CIRC!");
        assert_eq!(model._get_text("B1"), "#CIRC!");
    }
}

#[test]
fn indirect_into_own_spill_area_is_circular() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(SUM(INDIRECT(\"A2\"))+2)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "#CIRC!");
        assert_eq!(model._get_text("A2"), "");
    }
}

// The two anchors read each other's spill areas (not values). Whatever the
// verdict, it must be the same on every pass.
#[test]
fn mutual_area_dependency_is_a_fixed_point() {
    let mut model = new_empty_model();
    model._set("A1", "=B2:B3");
    model._set("B1", "=A2:A3");

    model.evaluate();
    let first: Vec<String> = ["A1", "A2", "A3", "B1", "B2", "B3"]
        .iter()
        .map(|c| model._get_text(c))
        .collect();
    model.evaluate();
    let second: Vec<String> = ["A1", "A2", "A3", "B1", "B2", "B3"]
        .iter()
        .map(|c| model._get_text(c))
        .collect();
    assert_eq!(first, second);
    assert!(
        first.iter().any(|v| v == "#CIRC!"),
        "expected a circular reference, got {first:?}"
    );
}

//         ║    A    |    D           |
// ════════╬═════════╪════════════════╪
//    3    ║         | =D5+2          |
//    4    ║ =D3:D5  | =SEQUENCE(D3)  |
//    5    ║         |                |
//
// A4 reads D3 (= 2) and then D4, whose spill would close the cycle
// D3 → D5 → D4. D4 reports #CIRC! and does not spill; D3 and A4 keep the
// values they computed with an empty D5, which the final sheet holds. Found
// by the consistency oracle, which must stay clean.
#[test]
fn running_reader_of_a_cycle_member_is_redone() {
    let mut model = new_empty_model();
    model._set("A4", "=D3:D5");
    model._set("D3", "=D5+2");
    model._set("D4", "=SEQUENCE(D3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("D3"), "2");
        assert_eq!(model._get_text("D4"), "#CIRC!");
        assert_eq!(model._get_text("A4"), "2");
        assert_eq!(model._get_text("A5"), "#CIRC!");
        assert_eq!(model._get_text("A6"), "0");
        assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Volatile functions
// ═══════════════════════════════════════════════════════════════════════════

// The shape of C1 is random. A1, evaluated first, counts C1's cells and must
// agree with the shape actually stored after each pass.
#[test]
fn volatile_shape_read_by_earlier_anchor_is_consistent() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(COUNT(C1:C5))");
    model._set("C1", "=SEQUENCE(RANDBETWEEN(1,5))");

    for _ in 0..4 {
        model.evaluate();
        let c_cells = (1..=5)
            .filter(|r| !model._get_text_at(0, *r, 3).is_empty())
            .count();
        let a_cells = (1..=5)
            .filter(|r| !model._get_text_at(0, *r, 1).is_empty())
            .count();
        assert_eq!(a_cells, c_cells);
        assert_eq!(number(&model, "Sheet1!A1"), 1.0);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Several sheets
// ═══════════════════════════════════════════════════════════════════════════

// Sheet1's anchors run before Sheet2's, so Sheet1!A1 reads Sheet2!C3 too early.
#[test]
fn cross_sheet_reader_before_spill() {
    let mut model = new_empty_model();
    model.add_sheet("Sheet2").unwrap();
    model._set("A1", "=SEQUENCE(Sheet2!C3)");
    model._set("Sheet2!C1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A3"), "3");
    }
}

#[test]
fn cross_sheet_spill_cycle_is_circular() {
    let mut model = new_empty_model();
    model.add_sheet("Sheet2").unwrap();
    model._set("A1", "=Sheet2!B2+2");
    model._set("Sheet2!B1", "=SEQUENCE(Sheet1!A1)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("Sheet2!B1"), "#CIRC!");
        assert_eq!(model._get_text("A1"), "2");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// History: edits and structural changes between evaluations
// ═══════════════════════════════════════════════════════════════════════════

// Break a spill by writing into it, then clear the cell: the spill must come
// back exactly, with nothing left over.
#[test]
fn break_and_restore_spill_matches_fresh_model() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model.evaluate();
    model._set("A2", "x");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#SPILL!");
    assert_eq!(model._get_text("A3"), "");
    model._set("A2", "");
    model.evaluate();

    for cell in ["A1", "A2", "A3", "A4"] {
        let expected = match cell {
            "A1" => "1",
            "A2" => "2",
            "A3" => "3",
            _ => "",
        };
        assert_eq!(model._get_text(cell), expected, "{cell}");
    }
}

// Undo the entry that broke a spill, then shrink the spill: the cell the
// undo restored beyond the new area must not survive as an orphan.
#[test]
fn undo_of_spill_break_then_shrink_leaves_no_orphan() {
    let mut model = UserModel::new_empty("model", "en", "UTC", "en").unwrap();
    model.set_user_input(0, 1, 1, "=SEQUENCE(3)").unwrap();
    model.set_user_input(0, 2, 1, "x").unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#SPILL!".to_string())
    );
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 3, 1), Ok("3".to_string()));

    model.set_user_input(0, 1, 1, "=SEQUENCE(2)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 2, 1), Ok("2".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 3, 1), Ok("".to_string()));
}

// Insert a row through a spill area.
#[test]
fn insert_row_through_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model._set("B5", "=A3");
    model.evaluate();

    model.insert_rows(0, 2, 1).unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("A4"), "");
    assert_eq!(model._get_formula("B6"), "=A4");
    assert_eq!(model._get_text("B6"), "0");
}

// Delete the row holding the anchor: the spill must go with it.
#[test]
fn delete_anchor_row_clears_spill() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model.evaluate();

    model.delete_rows(0, 1, 1).unwrap();
    model.evaluate();

    for cell in ["A1", "A2", "A3"] {
        assert_eq!(model._get_text(cell), "", "{cell}");
    }
}

// Delete a row inside the spill area: the spill re-forms below the anchor.
#[test]
fn delete_row_inside_spill_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model.evaluate();

    model.delete_rows(0, 2, 1).unwrap();
    model.evaluate();

    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("A4"), "");
}

// Clearing a range that contains a spill area with the range API.
#[test]
fn range_clear_over_spill_area_then_reenter() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model._set("B1", "=A3*2");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "6");

    let area = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 3,
    };
    model.range_clear_contents(&area).unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "");
    assert_eq!(model._get_text("B1"), "0");

    model._set("A1", "=SEQUENCE(2)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "");
    assert_eq!(model._get_text("B1"), "0");
}

// ═══════════════════════════════════════════════════════════════════════════
// History dependence of cycle verdicts (found by test_history_independence)
// ═══════════════════════════════════════════════════════════════════════════

fn snapshot(model: &Model, cells: &[&str]) -> Vec<String> {
    cells.iter().map(|c| model._get_text(c)).collect()
}

//         ║       B        |    C    |    D    |
// ════════╬════════════════╪═════════╪═════════╪
//    2    ║                |         |         |
//    3    ║                | =D2:D4  | =D4+1   |
//    4    ║ =SEQUENCE(1,3) |         |         |
//
// C3 and B4 contend for C4, and C3 reads D3, which reads B4's spill cell D4.
// With a takeover rule this was a cycle that only existed if B4 had spilled
// first. With the existing-spill rule there is no takeover: entering B4 first,
// B4 keeps C4 and C3 simply gets #SPILL!; on a fresh sheet C3 runs first and
// B4 is the one blocked. Both are fixed points, and which one holds is the
// sheet's history, as in Excel.
#[test]
fn contention_with_a_dependency_keeps_history() {
    let cells = ["B4", "C4", "D4", "C3", "C5", "D3"];

    let mut history = new_empty_model();
    history._set("B4", "=SEQUENCE(1,3)");
    history.evaluate();
    history._set("D3", "=D4+1");
    history.evaluate();
    history._set("C3", "=D2:D4");
    history.evaluate();
    let after_history = snapshot(&history, &cells);
    history.evaluate();
    assert_eq!(after_history, snapshot(&history, &cells));
    assert_eq!(after_history, ["1", "2", "3", "#SPILL!", "", "4"]);

    let mut fresh = new_empty_model();
    fresh._set("B4", "=SEQUENCE(1,3)");
    fresh._set("D3", "=D4+1");
    fresh._set("C3", "=D2:D4");
    fresh.evaluate();
    let after_fresh = snapshot(&fresh, &cells);
    fresh.evaluate();
    assert_eq!(after_fresh, snapshot(&fresh, &cells));
    assert_eq!(after_fresh, ["#SPILL!", "1", "", "0", "0", "1"]);
}

//         ║       C        |    D    |
// ════════╬════════════════╪═════════╪
//    1    ║ =SEQUENCE(C4)  |         |
//    2    ║                | =C2:C4  |
//    4    ║ =D4*2          |         |
//
// D2 and C4 form a cycle (D2 reads C4, C4 reads D4 which D2 writes). When D2
// still has spill cells from a previous evaluation, C1 pulls C4 in, C4 reads
// D4 through the stale cell, D2 is evaluated on C4's behalf and the loop
// closes on the stack. On a fresh sheet the loop is caught by D2's write
// barrier instead. Both paths must blame the anchor only: D2 = #CIRC!, C4
// keeps 0 (D4 is empty in the final sheet), C1 = SEQUENCE(0) = #CALC!.
#[test]
fn cycle_blame_does_not_depend_on_stale_spill_cells() {
    let cells = ["C1", "C4", "D2", "D3", "D4"];

    let mut history = new_empty_model();
    history._set("D2", "=C2:C4");
    history.evaluate();
    history._set("C1", "=SEQUENCE(C4)");
    history.evaluate();
    history._set("C4", "=D4*2");
    history.evaluate();
    let after_history = snapshot(&history, &cells);
    assert_eq!(
        super::oracle::violations(&mut history),
        Vec::<String>::new()
    );
    history.evaluate();
    assert_eq!(after_history, snapshot(&history, &cells));
    assert_eq!(after_history, ["#CALC!", "0", "#CIRC!", "", ""]);

    let mut fresh = new_empty_model();
    fresh._set("D2", "=C2:C4");
    fresh._set("C1", "=SEQUENCE(C4)");
    fresh._set("C4", "=D4*2");
    fresh.evaluate();
    let after_fresh = snapshot(&fresh, &cells);
    assert_eq!(super::oracle::violations(&mut fresh), Vec::<String>::new());
    fresh.evaluate();
    assert_eq!(after_fresh, snapshot(&fresh, &cells));
    assert_eq!(after_fresh, ["#CALC!", "0", "#CIRC!", "", ""]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Structural changes around CSE arrays
// ═══════════════════════════════════════════════════════════════════════════

// A 2x3 CSE array at B3:C5 is shifted by row and column operations. Every
// cell of the array must follow, and nothing must be left behind.
#[test]
fn cse_array_survives_row_and_column_shifts() {
    let mut model = new_empty_model();
    model.set_user_array_formula(0, 3, 2, 2, 3, "=5").unwrap();
    model.evaluate();

    // Insert a row above: the array moves to B4:C6.
    model.insert_rows(0, 1, 1).unwrap();
    model.evaluate();
    for cell in ["B4", "C4", "B5", "C5", "B6", "C6"] {
        assert_eq!(model._get_text(cell), "5", "{cell} after insert row");
    }
    for cell in ["B3", "C3", "B7", "C7"] {
        assert_eq!(model._get_text(cell), "", "{cell} after insert row");
    }

    // Delete a row above: back to B3:C5.
    model.delete_rows(0, 1, 1).unwrap();
    model.evaluate();
    for cell in ["B3", "C3", "B4", "C4", "B5", "C5"] {
        assert_eq!(model._get_text(cell), "5", "{cell} after delete row");
    }
    for cell in ["B6", "C6"] {
        assert_eq!(model._get_text(cell), "", "{cell} after delete row");
    }

    // Insert a column at the anchor column: the array moves to C3:D5.
    model.insert_columns(0, 2, 1).unwrap();
    model.evaluate();
    for cell in ["C3", "D3", "C4", "D4", "C5", "D5"] {
        assert_eq!(model._get_text(cell), "5", "{cell} after insert column");
    }
    for cell in ["B3", "B4", "B5", "E3"] {
        assert_eq!(model._get_text(cell), "", "{cell} after insert column");
    }

    // Delete a column before: back to B3:C5.
    model.delete_columns(0, 1, 1).unwrap();
    model.evaluate();
    for cell in ["B3", "C3", "B4", "C4", "B5", "C5"] {
        assert_eq!(model._get_text(cell), "5", "{cell} after delete column");
    }
    for cell in ["D3", "D4", "D5"] {
        assert_eq!(model._get_text(cell), "", "{cell} after delete column");
    }
}
