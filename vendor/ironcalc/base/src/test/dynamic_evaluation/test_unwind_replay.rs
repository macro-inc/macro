#![allow(clippy::unwrap_used)]

// The recursion is not allowed to go deeper than `max_depth` formulas. When it
// would, it unwinds to the outermost formula, which runs the cells left on the
// stack from the top (see `evaluate_formula_cell` and `replay`). The limit
// changes how many times formulas run, never what is stored.

use crate::expressions::types::CellReferenceIndex;
use crate::test::util::new_empty_model;
use crate::Model;

use super::test_order_independence::{build, describe, random_sheet, snapshot};

/// `column(i) = column(i+1) + 0` for rows `1..n`, and `last` in row `n`.
fn reverse_chain(model: &mut Model, column: &str, n: i32, last: &str) {
    for row in 1..n {
        model._set(
            &format!("{column}{row}"),
            &format!("={column}{}+0", row + 1),
        );
    }
    model._set(&format!("{column}{n}"), last);
}

// A1 = A2+1, A2 = A3+1, ..., A(n) = 1. Natural order meets A1 first, so the
// recursion wants to go n deep.
#[test]
fn reverse_chain_with_a_tiny_limit() {
    for max_depth in [1, 2, 3, 7] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        let n = 50;
        for row in 1..n {
            model._set(&format!("A{row}"), &format!("=A{}+1", row + 1));
        }
        model._set(&format!("A{n}"), "1");
        model.evaluate();
        assert_eq!(model._get_text("A1"), "50", "max_depth = {max_depth}");
        assert_eq!(model._get_text("A25"), "26", "max_depth = {max_depth}");
        assert_eq!(model._get_text("A49"), "2", "max_depth = {max_depth}");
    }
}

// A ring longer than the limit: the read that closes it meets a cell that is
// on the stack but no longer running. It is a cycle all the same.
#[test]
fn ring_longer_than_the_limit() {
    for max_depth in [1, 2, 3] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        let n = 10;
        for row in 1..n {
            model._set(&format!("A{row}"), &format!("=A{}+1", row + 1));
        }
        model._set(&format!("A{n}"), "=A1+1");
        model.evaluate();
        for row in 1..=n {
            assert_eq!(
                model._get_text(&format!("A{row}")),
                "#CIRC!",
                "A{row}, max_depth = {max_depth}"
            );
        }
    }
}

#[test]
fn the_limit_can_be_set() {
    let mut model = new_empty_model();
    model.set_max_evaluation_depth(5);
    assert_eq!(model.get_max_evaluation_depth(), 5);
    // Zero would not let the outermost formula run.
    model.set_max_evaluation_depth(0);
    assert_eq!(model.get_max_evaluation_depth(), 1);
}

// `IRONCALC_MAX_DEPTH=1 cargo test` runs the whole crate through the replay.
// This checks that the switch is wired: when it is set, a new model has it.
#[test]
fn the_limit_of_a_new_model_follows_the_environment_under_test() {
    let model = new_empty_model();
    match std::env::var("IRONCALC_MAX_DEPTH")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
    {
        Some(max_depth) => assert_eq!(model.get_max_evaluation_depth(), max_depth),
        None => assert_eq!(model.get_max_evaluation_depth(), 64),
    }
}

// The point of it all. With the default limits, on the 2 MB stack of a test
// thread, in a debug build: without the unwind the plain chain overflows the
// stack at about 120 cells and the nested one at about 35.
#[test]
fn long_reverse_chains_with_the_default_limits() {
    let n = 20_000;
    let mut model = new_empty_model();
    for row in 1..n {
        model._set(&format!("A{row}"), &format!("=A{}+1", row + 1));
        model._set(
            &format!("B{row}"),
            &format!("=IF(TRUE,SUM(1,IF(TRUE,B{}+0,0)),0)", row + 1),
        );
    }
    model._set(&format!("A{n}"), "1");
    model._set(&format!("B{n}"), "1");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "20000");
    assert_eq!(model._get_text("B1"), "20000");
}

// The stack limit alone, with the number of formulas unbounded.
#[test]
fn the_stack_limit_alone_is_enough() {
    let mut model = new_empty_model();
    model.set_max_evaluation_depth(usize::MAX);
    reverse_chain(&mut model, "A", 5_000, "7");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "7");
}

// A chain that leads into a ring: the ring is circular, and the chain carries
// the error, as it does without a limit.
#[test]
fn chain_into_a_ring() {
    for max_depth in [1, 2, 3, usize::MAX] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        reverse_chain(&mut model, "A", 12, "=B1");
        model._set("B1", "=B2+1");
        model._set("B2", "=B3+1");
        model._set("B3", "=B1+1");
        model.evaluate();
        for cell in ["B1", "B2", "B3", "A12", "A1"] {
            assert_eq!(model._get_text(cell), "#CIRC!", "{cell}, {max_depth}");
        }
    }
}

// One formula at the head of three deep chains. It is abandoned once per
// chain and then runs to the end.
#[test]
fn three_deep_branches() {
    for max_depth in [1, 2, 5] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        reverse_chain(&mut model, "B", 30, "1");
        reverse_chain(&mut model, "C", 30, "10");
        reverse_chain(&mut model, "D", 30, "100");
        model._set("A1", "=B1+C1+D1");
        model.evaluate();
        assert_eq!(model._get_text("A1"), "111", "max_depth = {max_depth}");
    }
}

// An anchor reads an empty cell and then a deep chain; a later anchor spills
// into that cell. The record made by the run that was abandoned to the unwind
// stands, and the conflict is found: one restart, with or without a limit.
#[test]
fn conflict_restart_through_a_deep_chain() {
    for max_depth in [1, 2, usize::MAX] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        model._set("A1", "=SEQUENCE(1,1,B3+D1)");
        model._set("B1", "=SEQUENCE(3)");
        reverse_chain(&mut model, "D", 40, "0");
        model.evaluate();
        assert_eq!(model._get_text("A1"), "3", "max_depth = {max_depth}");
        assert_eq!(
            model.evaluation.restarts_in_last_evaluation, 1,
            "max_depth = {max_depth}"
        );
    }
}

// A leftover spill cell read at the bottom of a deep chain, on behalf of an
// anchor that runs before the owner: one stale-read restart either way.
#[test]
fn stale_read_at_the_bottom_of_a_deep_chain() {
    for max_depth in [1, 2, usize::MAX] {
        let mut model = new_empty_model();
        model.set_max_evaluation_depth(max_depth);
        model._set("A1", "=SEQUENCE(1,1,5)");
        model._set("B1", "=SEQUENCE(3)");
        reverse_chain(&mut model, "D", 40, "=B3");
        model.evaluate();
        assert_eq!(model._get_text("D1"), "3", "max_depth = {max_depth}");
        assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);

        model._set("A1", "=SEQUENCE(1,1,D1)");
        model.evaluate();
        assert_eq!(model._get_text("A1"), "3", "max_depth = {max_depth}");
        assert_eq!(
            model.evaluation.restarts_in_last_evaluation, 1,
            "max_depth = {max_depth}"
        );
    }
}

// Outside a pass there is no driver, and a cell is evaluated on demand. The
// replay belongs to the outermost formula, not to the pass, so it works there
// too.
#[test]
fn deep_chain_outside_a_pass() {
    let mut model = new_empty_model();
    model.set_max_evaluation_depth(2);
    reverse_chain(&mut model, "A", 50, "9");
    let a1 = CellReferenceIndex {
        sheet: 0,
        row: 1,
        column: 1,
    };
    model.evaluate_cell(a1);
    assert_eq!(model._get_text("A1"), "9");
    assert_eq!(model._get_text("A49"), "9");
    assert!(model.evaluation.stack.is_empty());
}

// A link is attached while HYPERLINK runs. A run abandoned to the unwind sees
// its friendly name as empty rather than as the error it is, and attaches a
// link that the real run must not leave behind.
#[test]
fn an_abandoned_run_leaves_no_link() {
    let mut model = new_empty_model();
    model.set_max_evaluation_depth(1);
    model._set("A1", "=HYPERLINK(\"https://www.ironcalc.com/\", B1)");
    model._set("B1", "=1/0");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#DIV/0!");
    assert!(model.links.is_empty());
}

// The limit changes how many times formulas run and nothing else: the same
// sheet, the same number of restarts, and a consistent result, whatever it is.
#[test]
fn random_sheets_do_not_depend_on_the_limit() {
    let mut failures = Vec::new();
    for seed in 1..=300 {
        let cells = random_sheet(seed);
        let mut reference = build(&cells);
        reference.set_max_evaluation_depth(usize::MAX);
        reference.set_max_evaluation_stack(usize::MAX);
        reference.evaluate();
        let expected = snapshot(&reference);
        let expected_restarts = reference.evaluation.restarts_in_last_evaluation;
        for max_depth in [1, 2, 3] {
            let mut model = build(&cells);
            model.set_max_evaluation_depth(max_depth);
            model.evaluate();
            let got = snapshot(&model);
            let restarts = model.evaluation.restarts_in_last_evaluation;
            let inconsistencies = super::oracle::violations(&mut model);
            if got != expected || restarts != expected_restarts || !inconsistencies.is_empty() {
                failures.push(format!(
                    "seed {seed}, max_depth {max_depth}\n{}\nwithout a limit ({expected_restarts} restarts):\n  {}\nwith it ({restarts} restarts):\n  {}\ninconsistencies:\n  {}",
                    describe(&cells),
                    expected.join("\n  "),
                    got.join("\n  "),
                    inconsistencies.join("\n  "),
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
