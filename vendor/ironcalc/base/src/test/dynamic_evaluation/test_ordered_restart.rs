#![allow(clippy::unwrap_used)]

// Tests aimed at the mechanics of the evaluation algorithm in
// `evaluation.rs`: passes, restarts, the remembered anchor order, and the
// verdicts of the driver. The other files in this folder test results; this
// one also looks at how they were reached, through
// `Model::evaluation.restarts_in_last_evaluation` and `anchor_order`.

use crate::expressions::types::CellReferenceIndex;
use crate::test::util::new_empty_model;
use crate::Model;

fn anchor_order(model: &Model) -> Vec<String> {
    model
        .evaluation
        .anchor_order
        .iter()
        .map(|a| model._cell_name(*a))
        .collect()
}

fn restarts(model: &Model) -> u32 {
    model.evaluation.restarts_in_last_evaluation
}

impl Model<'_> {
    fn _cell_name(&self, cell: CellReferenceIndex) -> String {
        let column = (b'A' + (cell.column - 1) as u8) as char;
        format!("{column}{}", cell.row)
    }
}

// ── Restarts and the anchor order ───────────────────────────────────────────

//         ║       A        |       B        |       C        |
// ════════╬════════════════╪════════════════╪════════════════╪
//    1    ║ =B2:B3         | =C2:C3         | =SEQUENCE(3)   |
//
// A chain in the wrong natural order: A1 reads B's spill area without touching
// B1, and B1 reads C's area likewise. The first evaluation needs one restart
// per link; they leave the anchors in dependency order, so the second
// evaluation needs none.
#[test]
fn a_reversed_chain_restarts_once_per_link_then_never_again() {
    let mut model = new_empty_model();
    model._set("A1", "=B2:B3");
    model._set("B1", "=C2:C3");
    model._set("C1", "=SEQUENCE(3)");

    // C1:C3 = 1,2,3; B1:B2 = C2:C3 = 2,3; A1:A2 = B2:B3 = 3,0.
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(model._get_text("A2"), "0");
    assert_eq!(restarts(&model), 2);
    assert_eq!(anchor_order(&model), ["C1", "B1", "A1"]);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(restarts(&model), 0);
    assert_eq!(anchor_order(&model), ["C1", "B1", "A1"]);
}

// The same chain in the right natural order needs no restart at all.
#[test]
fn a_chain_in_the_right_order_needs_no_restart() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model._set("B1", "=A2:A3");
    model._set("C1", "=B2:B3");

    model.evaluate();
    assert_eq!(model._get_text("C1"), "3");
    assert_eq!(restarts(&model), 0);
    assert_eq!(anchor_order(&model), ["A1", "B1", "C1"]);
}

// Reading the anchor itself is different: it evaluates the anchor on demand,
// so a chain written that way never restarts whatever its order.
#[test]
fn reading_the_anchor_evaluates_it_on_demand_without_a_restart() {
    let mut model = new_empty_model();
    model._set("A1", "=B1:B3");
    model._set("B1", "=C1:C3");
    model._set("C1", "=SEQUENCE(3)");

    model.evaluate();
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(restarts(&model), 0);
    assert_eq!(anchor_order(&model), ["A1", "B1", "C1"]);
}

// The remembered order survives edits: a new anchor is appended, a removed one
// is dropped, the others keep their order.
#[test]
fn the_anchor_order_follows_edits() {
    let mut model = new_empty_model();
    model._set("A1", "=B2:B3");
    model._set("B1", "=SEQUENCE(3)");
    model.evaluate();
    assert_eq!(anchor_order(&model), ["B1", "A1"]);

    model._set("D1", "=SEQUENCE(2)");
    model.evaluate();
    assert_eq!(anchor_order(&model), ["B1", "A1", "D1"]);
    assert_eq!(restarts(&model), 0);

    model._set("B1", "");
    model.evaluate();
    assert_eq!(anchor_order(&model), ["A1", "D1"]);
    assert_eq!(model._get_text("A1"), "0");
}

// A structural change moves the anchors; the order is rebuilt from what exists
// and the values stay right.
#[test]
fn the_anchor_order_survives_a_row_insertion() {
    let mut model = new_empty_model();
    model._set("A1", "=B3:B4");
    model._set("B2", "=SEQUENCE(3)");
    model.evaluate();
    assert_eq!(anchor_order(&model), ["B2", "A1"]);
    assert_eq!(model._get_text("A2"), "3");

    // The anchors are now at A2 and B3. Nothing is known about the moved
    // positions, so the order is rebuilt from natural order and repaired by a
    // restart, as on a fresh sheet.
    model.insert_rows(0, 1, 1).unwrap();
    model.evaluate();
    assert_eq!(anchor_order(&model), ["B3", "A2"]);
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "3");
    assert_eq!(model._get_text("B5"), "3");
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// ── Stale reads ─────────────────────────────────────────────────────────────

//         ║       A        |       B        |
// ════════╬════════════════╪════════════════╪
//    1    ║ =B3*2          | =SEQUENCE(A5)  |
//    5    ║ 3              |                |
//
// B1 spills B1:B3 on the first evaluation. When A5 changes, the second
// evaluation must not let A1 read the leftover B3 before B1 has run again.
#[test]
fn a_leftover_spill_cell_is_never_read_before_its_anchor_runs() {
    let mut model = new_empty_model();
    model._set("A5", "3");
    model._set("B1", "=SEQUENCE(A5)");
    model._set("A1", "=B3*2");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "6");

    model._set("A5", "2");
    model.evaluate();
    assert_eq!(model._get_text("B3"), "");
    assert_eq!(model._get_text("A1"), "0");
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// The same with the reader being an earlier anchor, so that it runs before B1
// and hits the leftover cell: the pass restarts with B1 first.
#[test]
fn a_stale_read_by_an_earlier_anchor_moves_the_anchor_first() {
    let mut model = new_empty_model();
    model._set("A5", "3");
    model._set("B1", "=SEQUENCE(A5)");
    model._set("A1", "=SEQUENCE(1,1,B3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(anchor_order(&model), ["B1", "A1"]);

    model._set("A5", "2");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "0");
    assert_eq!(restarts(&model), 0);
}

// ── Contention ──────────────────────────────────────────────────────────────

//         ║    A    |       B        |
// ════════╬═════════╪════════════════╪
//    1    ║ 3       | =SEQUENCE(A1)  |
//    2    ║ =SEQUENCE(1,2) |         |
//
// B1 spills B1:B3 and blocks A2. When A1 drops to 1, B1 shrinks and frees B2:
// A2 spills, and nothing of B1's old area is left behind.
#[test]
fn a_shrinking_spill_frees_the_array_it_blocked() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("B1", "=SEQUENCE(A1)");
    model._set("A2", "=SEQUENCE(1,2)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), "#SPILL!");

    model._set("A1", "1");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("A2"), "1");
    assert_eq!(model._get_text("B2"), "2");
    assert_eq!(model._get_text("B3"), "");
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
}

// ── Cycle verdicts ──────────────────────────────────────────────────────────

//         ║       A        |    D    |
// ════════╬════════════════╪═════════╪
//    1    ║                | =A3:A5  |
//    2    ║ =SEQUENCE(2)   |         |
//    4    ║ =SUM(D2:E4)+D5 | =SEQUENCE(3) |
//
// D1's input A4 reads D1's own area, but by the time D1 commits, other anchors
// have legitimately been moved ahead of it (A2 and D4 own cells its inputs
// read). D1 is still the only circular cell, on the first evaluation and on
// the next.
#[test]
fn an_anchor_contradicted_by_its_own_inputs_is_circular_wherever_it_is_in_the_order() {
    let mut model = new_empty_model();
    model._set("D1", "=A3:A5");
    model._set("A2", "=SEQUENCE(2)");
    model._set("A4", "=SUM(D2:E4)+D5");
    model._set("D4", "=SEQUENCE(3)");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("D1"), "#CIRC!");
        assert_eq!(model._get_text("A2"), "1");
        assert_eq!(model._get_text("A3"), "2");
        assert_eq!(model._get_text("D4"), "1");
        assert_eq!(model._get_text("D6"), "3");
        assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
    }
}

//         ║    A    |    B    |
// ════════╬═════════╪═════════╪
//    1    ║ =B2:B3  | =A2:A3  |
//
// Each anchor reads the other's area: no order works. The restarts come back
// to an order already seen, and every anchor moved since is on the loop.
#[test]
fn anchors_reading_each_others_areas_are_all_circular() {
    let mut model = new_empty_model();
    model._set("A1", "=B2:B3");
    model._set("B1", "=A2:A3");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "#CIRC!");
        assert_eq!(model._get_text("B1"), "#CIRC!");
        assert_eq!(model._get_text("A2"), "");
        assert_eq!(model._get_text("B2"), "");
    }
}

// A three-anchor loop, with a fourth anchor that merely reads one of them and
// must not be blamed.
#[test]
fn a_bystander_of_a_loop_is_not_blamed() {
    let mut model = new_empty_model();
    model._set("A1", "=B2:B3");
    model._set("B1", "=C2:C3");
    model._set("C1", "=A2:A3");
    model._set("E1", "=A1:A3");

    for _ in 0..2 {
        model.evaluate();
        assert_eq!(model._get_text("A1"), "#CIRC!");
        assert_eq!(model._get_text("B1"), "#CIRC!");
        assert_eq!(model._get_text("C1"), "#CIRC!");
        assert_eq!(model._get_text("E1"), "#CIRC!");
        assert_eq!(model._get_text("E2"), "0");
        assert_eq!(model._get_text("E3"), "0");
    }
}

// ── Outside a pass ──────────────────────────────────────────────────────────

// Cells are also evaluated on demand outside `evaluate()` (conditional
// formatting at load time, formula helpers). There is no driver there: a
// spill cell whose anchor has not run is read through its anchor, the way a
// CSE cell is. Forgetting the pass's states reproduces a freshly loaded
// workbook, where the cells exist but nothing has been evaluated.
#[test]
fn evaluating_outside_a_pass_reads_spill_cells_through_their_anchor() {
    let mut model = new_empty_model();
    model._set("A5", "3");
    model._set("B1", "=SEQUENCE(A5)");
    model.evaluate();
    assert_eq!(model.evaluate_formula("=B3*2", 0), Some(6.0));

    model.evaluation.cells.clear();
    assert_eq!(model.evaluate_formula("=B3*2", 0), Some(6.0));
}

// ── A blocking scan after a read of the same cell ───────────────────────────

//         ║   A   |                          B                           |       C        |
// ════════╬═══════╪══════════════════════════════════════════════════════╪════════════════╪
//    1    ║ 1     |                                                      | =SEQUENCE(3)   |
//    2    ║       | =IF(A1=1,SEQUENCE(2,2),IF(AND(C2="",C3=""),IF(ISERROR(C1),5,6),7)) |
//
// With A1 = 1, B2 spills B2:C3. Then A1 becomes 0 and C1 is added. B2 runs
// first (remembered order), reads its own leftovers C2 and C3 as empty, then
// reads C1, which is blocked by those very leftovers. B2 shrinks to a scalar
// and removes C2 and C3. Both records of C2 and C3 must be kept: the read as
// empty (root B2) and the blocked scan (also root B2, since C1 ran on B2's
// behalf). With a single record per position the scan was lost and C1 stayed
// #SPILL! over a free area.
//
// The removal contradicts only the scan, and the scan was blocked by cells
// B2 no longer wants: those cells are history, not an input of B2. They are
// dropped for the rest of the evaluation and the pass restarts. B2 then reads
// C2 and C3 as empty while C1, evaluated on demand, spills into them: a
// conflict that moves C1 first. The third pass is the fresh sheet's: C1
// spills, B2 = 7. Before this rule B2 was marked circular, and the same sheet
// gave 7 on the next evaluation, once the leftovers were gone.
#[test]
fn a_blocking_cell_read_as_empty_before_the_scan_keeps_both_records() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set(
        "B2",
        "=IF(A1=1,SEQUENCE(2,2),IF(AND(C2=\"\",C3=\"\"),IF(ISERROR(C1),5,6),7))",
    );
    model.evaluate();
    assert_eq!(model._get_text("C3"), "4");

    model._set("A1", "0");
    model._set("C1", "=SEQUENCE(3)");
    assert_eq!(model._get_text("C2"), "2");
    model.evaluate();
    let violations = crate::test::dynamic_evaluation::oracle::violations(&mut model);
    assert!(violations.is_empty(), "{violations:?}");
    assert_eq!(model._get_text("B2"), "7");
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C3"), "3");
    assert_eq!(restarts(&model), 2);
    assert_eq!(anchor_order(&model), ["C1", "B2"]);

    // The verdict is a fact about the sheet: the next evaluation agrees, and
    // so does a fresh model with the same contents.
    model.evaluate();
    assert_eq!(model._get_text("B2"), "7");
    assert_eq!(restarts(&model), 0);

    let mut fresh = new_empty_model();
    fresh._set("A1", "0");
    fresh._set(
        "B2",
        "=IF(A1=1,SEQUENCE(2,2),IF(AND(C2=\"\",C3=\"\"),IF(ISERROR(C1),5,6),7))",
    );
    fresh._set("C1", "=SEQUENCE(3)");
    fresh.evaluate();
    assert_eq!(fresh._get_text("B2"), "7");
    assert_eq!(fresh._get_text("C3"), "3");
}

//         ║   A   |                 B                  |       C        |
// ════════╬═══════╪════════════════════════════════════╪════════════════╪
//    1    ║ 1     |                                    | =SEQUENCE(3)   |
//    2    ║       | =IF(A1=1,SEQUENCE(2,2),IF(ISERROR(C1),5,SEQUENCE(2,2))) |
//
// The same history, but once C1 spills B2 wants its old area back. There is
// no sheet in which B2 keeps it: with B2 spilled, C1 is blocked and B2 is the
// scalar 5. B2's leftovers go when B2 shrinks, C1 takes the cells, and B2 is
// blocked by C1's spill, which is what a fresh sheet gives. Nothing is
// circular: B2's inputs never depend on B2's output, only on its history.
#[test]
fn a_shrunk_anchor_does_not_get_its_leftovers_back() {
    let formula = "=IF(A1=1,SEQUENCE(2,2),IF(ISERROR(C1),5,SEQUENCE(2,2)))";
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B2", formula);
    model.evaluate();
    assert_eq!(model._get_text("C3"), "4");

    model._set("A1", "0");
    model._set("C1", "=SEQUENCE(3)");
    model.evaluate();
    let violations = crate::test::dynamic_evaluation::oracle::violations(&mut model);
    assert!(violations.is_empty(), "{violations:?}");
    assert_eq!(model._get_text("B2"), "#SPILL!");
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C3"), "3");
    assert_eq!(model._get_text("B3"), "");
    assert_eq!(restarts(&model), 1);

    let mut fresh = new_empty_model();
    fresh._set("A1", "0");
    fresh._set("B2", formula);
    fresh._set("C1", "=SEQUENCE(3)");
    fresh.evaluate();
    assert_eq!(fresh._get_text("B2"), "#SPILL!");
    assert_eq!(fresh._get_text("C3"), "3");
    assert_eq!(restarts(&fresh), 0);
}

// ── The restart budget on a cycle-free sheet ────────────────────────────────

//         ║ A..J (Z group)  | K..T (Y group)                | U..AD (X group)                          |
// ════════╬═════════════════╪═══════════════════════════════╪══════════════════════════════════════════╪
//    1    ║ =SEQUENCE(2)    | =SEQUENCE(2)+A2+B2+...+J2     | =SEQUENCE(2)+K2+L2+...+T2+<next X>2      |
//
// Three groups of dynamic anchors, each spilling two rows. Every Y reads the
// spill cell of every Z, every X reads the spill cell of every Y and of the
// next X. Nothing reads anything that depends on itself: the sheet is cycle
// free and has one consistent state, with no error anywhere.
//
// Each X reads the next X's area before it ran: one restart per link of the
// chain, nine in all, each placing an X just before the one that read it.
// The Y's and Z's, already before the X's, never move.
//
// When a restart moved the anchor to the front instead, an X landed ahead of
// every Y it reads, each Y then moved to the front and landed ahead of every
// Z it reads: about k * m * m restarts, more than the budget of n² + 2 the
// driver had, after which it marked whatever anchor restarted next. With
// 10 + 10 + 10 anchors that was #CIRC! in seventeen cells that are not
// circular, among them plain =SEQUENCE(2) constants.
#[test]
fn a_cycle_free_cascade_is_not_marked_circular() {
    fn column(c: usize) -> String {
        let mut name = String::new();
        let mut n = c;
        loop {
            name.insert(0, (b'A' + (n % 26) as u8) as char);
            if n < 26 {
                break;
            }
            n = n / 26 - 1;
        }
        name
    }
    let m = 10;
    let k = 10;
    let z: Vec<usize> = (0..m).collect();
    let y: Vec<usize> = (m..2 * m).collect();
    let x: Vec<usize> = (2 * m..2 * m + k).collect();
    let mut model = new_empty_model();
    for &c in &z {
        model._set(&format!("{}1", column(c)), "=SEQUENCE(2)");
    }
    let z_cells: Vec<String> = z.iter().map(|&c| format!("{}2", column(c))).collect();
    for &c in &y {
        model._set(
            &format!("{}1", column(c)),
            &format!("=SEQUENCE(2)+{}", z_cells.join("+")),
        );
    }
    let y_cells: Vec<String> = y.iter().map(|&c| format!("{}2", column(c))).collect();
    for (i, &c) in x.iter().enumerate() {
        let next = match x.get(i + 1) {
            Some(&n) => format!("+{}2", column(n)),
            None => String::new(),
        };
        model._set(
            &format!("{}1", column(c)),
            &format!("=SEQUENCE(2)+{}{}", y_cells.join("+"), next),
        );
    }

    model.evaluate();

    // Every Z is 1, 2. Every Y is 1 + 10*2, 2 + 10*2. The last X is
    // 1 + 10*22, 2 + 10*22; the one before it adds the last X's 222.
    let circular: Vec<String> = (0..2 * m + k)
        .map(|c| format!("{}1", column(c)))
        .filter(|cell| model._get_text(cell) == "#CIRC!")
        .collect();
    assert_eq!(
        circular,
        Vec::<String>::new(),
        "cycle-free anchors marked circular"
    );
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("K1"), "21");
    assert_eq!(model._get_text("AD1"), "221");
    assert_eq!(model._get_text("AC1"), "443");
    assert_eq!(super::oracle::violations(&mut model), Vec::<String>::new());
    assert_eq!(restarts(&model), 9);
}
