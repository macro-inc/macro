#![allow(clippy::unwrap_used, clippy::panic)]

// Known gaps of the two-phase ordering algorithm.

use crate::cell::CellValue;
use crate::test::util::new_empty_model;
use crate::Model;

//         ║    A    |    B    |      C       |
// ════════╬═════════╪═════════╪══════════════╪
//    1    ║         | =A5:A6  | =SEQUENCE(3) |
// ────────╫─────────┼─────────┼──────────────┼
//    2    ║         |         |              |
// ────────╫─────────┼─────────┼──────────────┼
//    3    ║         |         |              |
// ────────╫─────────┼─────────┼──────────────┼
//    5    ║ =C2*2   |         |              |
// ────────╫─────────┼─────────┼──────────────┼
//    6    ║ =C3*2   |         |              |
// ────────╫─────────┼─────────┼──────────────┼
//
// B1 is a spill that depends on C1's spill area only *through* the regular
// cells A5 and A6. Phase 1 evaluates B1 before C1 and pulls in A5/A6, which
// read empty C2/C3. C1's area is not in B1's direct support (only A5:A6 is),
// so the reorder check never fires.
#[test]
fn transitive_dependency_through_regular_cell() {
    let mut model = new_empty_model();

    model._set("B1", "=A5:A6");
    model._set("A5", "=C2*2");
    model._set("A6", "=C3*2");
    model._set("C1", "=SEQUENCE(3)");

    model.evaluate();

    assert_eq!(model._get_text("C2"), "2");
    assert_eq!(model._get_text("C3"), "3");
    assert_eq!(model._get_text("A5"), "4");
    assert_eq!(model._get_text("A6"), "6");
    assert_eq!(model._get_text("B1"), "4");
    assert_eq!(model._get_text("B2"), "6");
}

//         ║    B    |      C       |
// ════════╬═════════╪══════════════╪
//    1    ║ =C1#    | =SEQUENCE(3) |
// ────────╫─────────┼──────────────┼
//    2    ║         |              |
// ────────╫─────────┼──────────────┼
//    3    ║         |              |
// ────────╫─────────┼──────────────┼
//
// The spill range operator reads the `r` stored in the anchor without
// evaluating it first. B1 runs before C1, sees r = (1, 1) and copies a single
// cell. `#` is evaluated through `evaluate_node_with_reference`, which records
// nothing in `support`, so no reorder happens either.
#[test]
fn spill_range_operator_before_anchor() {
    let mut model = new_empty_model();

    model._set("B1", "=C1#");
    model._set("C1", "=SEQUENCE(3)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "2");
    assert_eq!(model._get_text("B3"), "3");
}

//         ║    A    |            B            |      D       |
// ════════╬═════════╪═════════════════════════╪══════════════╪
//    1    ║ =B1:B1  | =SUM(OFFSET(D1,1,0,2,1)) | =SEQUENCE(3) |
// ────────╫─────────┼─────────────────────────┼──────────────┼
//    2    ║         |                         |              |
// ────────╫─────────┼─────────────────────────┼──────────────┼
//    3    ║         |                         |              |
// ────────╫─────────┼─────────────────────────┼──────────────┼
//
// A1 is a (trivial) spill evaluated in Phase 1 before D1; it pulls in B1,
// whose only reference into D's spill area is computed by OFFSET. Computed
// references are never recorded in `support`, so D1's area is never matched
// against anything and B1 keeps the value it read from empty cells.
#[test]
fn computed_reference_into_spill_area() {
    let mut model = new_empty_model();

    model._set("A1", "=B1:B1");
    model._set("B1", "=SUM(OFFSET(D1,1,0,2,1))");
    model._set("D1", "=SEQUENCE(3)");

    model.evaluate();

    assert_eq!(model._get_text("D2"), "2");
    assert_eq!(model._get_text("D3"), "3");
    assert_eq!(model._get_text("B1"), "5");
    assert_eq!(model._get_text("A1"), "5");
}

//         ║    A    |    B    |        C        |
// ════════╬═════════╪═════════╪═════════════════╪
//    1    ║         | =A5:A6  | =RANDARRAY(3,1) |
// ────────╫─────────┼─────────┼─────────────────┼
//    5    ║ =C2*2   |         |                 |
// ────────╫─────────┼─────────┼─────────────────┼
//    6    ║ =C3*2   |         |                 |
// ────────╫─────────┼─────────┼─────────────────┼
//
// Same shape as the transitive case but with a volatile source: after the
// retraction the readers must see exactly the values that ended up in C2:C3.
#[test]
fn transitive_dependency_on_volatile_spill_is_consistent() {
    let mut model = new_empty_model();

    model._set("B1", "=A5:A6");
    model._set("A5", "=C2*2");
    model._set("A6", "=C3*2");
    model._set("C1", "=RANDARRAY(3,1)");

    model.evaluate();

    // Compare the stored numbers, not their formatted text (which is rounded).
    let number = |model: &Model, cell: &str| match model.get_cell_value_by_ref(cell) {
        Ok(CellValue::Number(n)) => n,
        other => panic!("{cell} is not a number: {other:?}"),
    };
    let c2 = number(&model, "Sheet1!C2");
    let c3 = number(&model, "Sheet1!C3");
    assert_eq!(number(&model, "Sheet1!A5"), c2 * 2.0);
    assert_eq!(number(&model, "Sheet1!A6"), c3 * 2.0);
    assert_eq!(number(&model, "Sheet1!B1"), c2 * 2.0);
    assert_eq!(number(&model, "Sheet1!B2"), c3 * 2.0);
}

//         ║    A          |      C       |
// ════════╬═══════════════╪══════════════╪
//    1    ║ =SUM(C1#)     | =SEQUENCE(3) |
// ────────╫───────────────┼──────────────┼
//
// A scalar consumer of the spill range operator, evaluated before the anchor.
#[test]
fn sum_of_spill_range_before_anchor() {
    let mut model = new_empty_model();

    model._set("A1", "=SUM(C1#)");
    model._set("C1", "=SEQUENCE(3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "6");
}

// The spill range operator on a cell whose shape depends on itself is a cycle.
#[test]
fn spill_range_operator_on_itself_is_circular() {
    let mut model = new_empty_model();

    model._set("C1", "=SEQUENCE(ROWS(C1#)+1)");

    model.evaluate();

    assert_eq!(model._get_text("C1"), "#CIRC!");
}

// ── 5.4: cycles through a spill area ────────────────────────────────────────

//         ║    A     |       B        |
// ════════╬══════════╪════════════════╪
//    1    ║ =B2+2    | =SEQUENCE(A1)  |
// ────────╫──────────┼────────────────┼
//    2    ║          |                |
// ────────╫──────────┼────────────────┼
//
// B1's shape depends on A1, and A1 reads B1's spill area: a cycle. Before
// retraction this settled on B1 = SEQUENCE(2) with A1 = 4, an inconsistent but
// stable state. The anchor reports #CIRC! and does not spill; A1 keeps the
// value it computed with an empty B2, which is what the final sheet holds.
#[test]
fn spill_cycle_through_reader_is_circular() {
    let mut model = new_empty_model();

    model._set("A1", "=B2+2");
    model._set("B1", "=SEQUENCE(A1)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("B1"), "#CIRC!");
        assert_eq!(model._get_text("B2"), "");
        assert_eq!(model._get_text("A1"), "2");
    }
}

// ── 5.6: two dynamic arrays contending for the same cells ───────────────────

//         ║       A        |       B        |
// ════════╬════════════════╪════════════════╪
//    1    ║                | =SEQUENCE(3)   |
// ────────╫────────────────┼────────────────┼
//    2    ║ =SEQUENCE(1,2) |                |
// ────────╫────────────────┼────────────────┼
//    3    ║                |                |
// ────────╫────────────────┼────────────────┼
//
// B1 (B1:B3) and A2 (A2:B2) both want B2. On a fresh sheet neither has
// spilled yet, so the first to evaluate wins: anchors run in natural order,
// B1 spills and A2 gets #SPILL!. The result is then kept on every evaluation.
#[test]
fn spill_contention_on_a_fresh_sheet_goes_to_the_first_anchor() {
    let mut model = new_empty_model();

    model._set("B1", "=SEQUENCE(3)");
    model._set("A2", "=SEQUENCE(1,2)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("B1"), "1");
        assert_eq!(model._get_text("B2"), "2");
        assert_eq!(model._get_text("B3"), "3");
        assert_eq!(model._get_text("A2"), "#SPILL!");
    }
}

//         ║       A        |       B        |
// ════════╬════════════════╪════════════════╪
//    1    ║ =SEQUENCE(A2)  | =SEQUENCE(3)   |
// ────────╫────────────────┼────────────────┼
//    2    ║ =SEQUENCE(1,2) |                |
// ────────╫────────────────┼────────────────┼
//
// Same contention, but A1 (evaluated first) pulls A2 in before B1 runs, so A2
// spills into B2 first. The spill that exists keeps its cells: B1 finds B2
// occupied and gets #SPILL!, whatever the two anchors' positions.
#[test]
fn spill_contention_existing_spill_keeps_its_cells() {
    let mut model = new_empty_model();

    model._set("A1", "=SEQUENCE(A2)");
    model._set("A2", "=SEQUENCE(1,2)");
    model._set("B1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A2"), "1");
        assert_eq!(model._get_text("B2"), "2");
        assert_eq!(model._get_text("B1"), "#SPILL!");
        assert_eq!(model._get_text("B3"), "");
        assert_eq!(model._get_text("A1"), "1");
    }
}

// ── Dependents see what the anchor stored ───────────────────────────────────

//         ║       A        |    B    |      C       |
// ════════╬════════════════╪═════════╪══════════════╪
//    1    ║ =SEQUENCE(B1)  | =C1+1   | =SEQUENCE(3) |
// ────────╫────────────────┼─────────┼──────────────┼
//    2    ║                |         |      7       |
// ────────╫────────────────┼─────────┼──────────────┼
//
// C1 is blocked by C2 and stores #SPILL!. B1 triggers C1's evaluation and used
// to receive the first element of the array (1) instead of the stored error.
#[test]
fn dependent_of_blocked_spill_sees_the_error() {
    let mut model = new_empty_model();

    model._set("A1", "=SEQUENCE(B1)");
    model._set("B1", "=C1+1");
    model._set("C1", "=SEQUENCE(3)");
    model._set("C2", "7");

    model.evaluate();

    assert_eq!(model._get_text("C1"), "#SPILL!");
    assert_eq!(model._get_text("B1"), "#SPILL!");
    assert_eq!(model._get_text("A1"), "#SPILL!");
}

// ── Cycle members all report #CIRC! ─────────────────────────────────────────

//         ║       C        |
// ════════╬════════════════╪
//    1    ║ =C4:C6         |
//    2    ║ 1              |
//    4    ║ =SEQUENCE(C1)  |
//
// C1 and C4 form a cycle. Entering it from C1 used to give C4 = #CIRC! and
// C1 = #SPILL! (its blocked spill replaced the error), entering it from C4
// gave both #SPILL!. Retraction changes entry points, so every member of a
// cycle now reports #CIRC!.
#[test]
fn every_member_of_a_cycle_reports_circ() {
    let mut model = new_empty_model();

    model._set("C1", "=C4:C6");
    model._set("C2", "1");
    model._set("C4", "=SEQUENCE(C1)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("C1"), "#CIRC!");
        assert_eq!(model._get_text("C4"), "#CIRC!");
    }
}

// The same rule applied to a scalar cycle: IFERROR does not hide it.
#[test]
fn iferror_does_not_hide_a_cycle() {
    let mut model = new_empty_model();

    model._set("A1", "=IFERROR(B1,0)");
    model._set("B1", "=A1");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "#CIRC!");
    assert_eq!(model._get_text("B1"), "#CIRC!");
}

// ── Stale read edges of a retracted cell are ignored ────────────────────────

//         ║       B        |    C     |      E       |
// ════════╬════════════════╪══════════╪══════════════╪
//    2    ║ =SEQUENCE(C5)  |          |              |
//    4    ║                | =E5:E7   | =SEQUENCE(3) |
//
// B2 reads C5 while empty, is retracted when C4 spills, and C4 is retracted
// when E4 spills. When B2 re-evaluates it reads C5 through the stale spill
// cell, which evaluates C4 on B2's behalf. B2's old edge "read C5" must not
// make that write look like a cycle.
#[test]
fn retracted_reader_of_forwarded_spill_is_not_a_cycle() {
    let mut model = new_empty_model();

    model._set("B2", "=SEQUENCE(C5)");
    model._set("C4", "=E5:E7");
    model._set("E4", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("C4"), "2");
        assert_eq!(model._get_text("C5"), "3");
        assert_eq!(model._get_text("B2"), "1");
        assert_eq!(model._get_text("B3"), "2");
        assert_eq!(model._get_text("B4"), "3");
    }
}

// ── Reading a spill position before its anchor is not a cycle ───────────────

//         ║        A         |       B        |
// ════════╬══════════════════╪════════════════╪
//    1    ║ =SEQUENCE(B2+B1) | =SEQUENCE(3)   |
//    2    ║                  |                |
//    3    ║                  |                |
//
// A1 runs first (earlier anchor), reads B2 while it is still empty, then reads
// B1, which spills B2 on A1's behalf. B1 does not depend on A1, so this is not
// a cycle: A1 simply holds a stale read and is redone once it finishes.
#[test]
fn reading_spill_position_before_its_anchor_is_not_a_cycle() {
    let mut model = new_empty_model();

    model._set("A1", "=SEQUENCE(B2+B1)");
    model._set("B1", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("B1"), "1");
        assert_eq!(model._get_text("B2"), "2");
        assert_eq!(model._get_text("B3"), "3");
        assert_eq!(model._get_text("A1"), "1");
        assert_eq!(model._get_text("A2"), "2");
        assert_eq!(model._get_text("A3"), "3");
    }
}
