#![allow(clippy::unwrap_used)]

// Property test for the evaluation algorithm.
//
// Random small sheets mixing constants, scalar formulas, dynamic arrays
// (`SEQUENCE`, range spills, `#`) and computed references (`OFFSET`) must
// satisfy, whatever their layout:
//
// 1. Fixed point: evaluating a second time changes nothing.
// 2. Insertion-order independence: entering the same cells in a different
//    order gives the same sheet.
// 3. Nothing is left `Unevaluated`.
//
// 4. Consistency: every formula, re-run against the final sheet, gives its
//    stored value (see `oracle`).
//
// Volatile functions are deliberately excluded (they break 1 by design).
//
// One exception to 1 and 2: a sheet where a cycle through a spill area and
// contention for the same cells meet. Whether the anchor is reported circular
// or blocked then depends on which array got there first, which is history
// by design. When the states differ and one of them
// shows a #CIRC! or a #SPILL!, only 3 and 4 are required.

use crate::test::util::new_empty_model;
use crate::types::{Cell, FormulaValue};
use crate::Model;

const ROWS: i32 = 5;
const COLS: i32 = 5;
const CELLS_PER_SHEET: usize = 12;
const SEEDS: u64 = 1000;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn column_name(column: i32) -> String {
    ((b'A' + (column - 1) as u8) as char).to_string()
}

fn cell_name(row: i32, column: i32) -> String {
    format!("{}{}", column_name(column), row)
}

fn random_ref(rng: &mut Rng) -> String {
    let row = 1 + rng.below(ROWS as u64) as i32;
    let column = 1 + rng.below(COLS as u64) as i32;
    cell_name(row, column)
}

fn random_content(rng: &mut Rng) -> String {
    match rng.below(15) {
        0 | 1 => format!("{}", 1 + rng.below(4)),
        2 => format!("={}+1", random_ref(rng)),
        3 => format!("={}*2", random_ref(rng)),
        4 => {
            let r = random_ref(rng);
            format!("=SUM({r}:{})", random_ref(rng))
        }
        5 => {
            let row = 1 + rng.below(ROWS as u64) as i32;
            let column = 1 + rng.below(COLS as u64) as i32;
            format!("={}:{}", cell_name(row, column), cell_name(row + 2, column))
        }
        6 => format!("=SEQUENCE({})", 1 + rng.below(3)),
        7 => format!("=SEQUENCE({})", random_ref(rng)),
        8 => format!("={}#", random_ref(rng)),
        9 => format!("=SUM({}#)", random_ref(rng)),
        10 => format!("=SUM(OFFSET({},1,0,2,1))", random_ref(rng)),
        11 => format!("=SUM(OFFSET({},0,1,1,2))", random_ref(rng)),
        // Two references in an arbitrary order: a spill position may be read
        // before the anchor that writes it.
        12 => format!("={}+{}", random_ref(rng), random_ref(rng)),
        13 => format!("=SEQUENCE({}+{})", random_ref(rng), random_ref(rng)),
        _ => {
            let r = random_ref(rng);
            let r2 = random_ref(rng);
            format!("=SUM({r}:{r2})+{}", random_ref(rng))
        }
    }
}

pub(super) fn random_sheet(seed: u64) -> Vec<(String, String)> {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut cells: Vec<(String, String)> = Vec::new();
    while cells.len() < CELLS_PER_SHEET {
        let reference = random_ref(&mut rng);
        if cells.iter().any(|(r, _)| *r == reference) {
            continue;
        }
        let content = random_content(&mut rng);
        cells.push((reference, content));
    }
    cells
}

fn shuffled(cells: &[(String, String)], seed: u64) -> Vec<(String, String)> {
    let mut rng = Rng(seed.wrapping_mul(0xD1B5_4A32_D192_ED03) | 1);
    let mut result = cells.to_vec();
    for i in (1..result.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        result.swap(i, j);
    }
    result
}

pub(super) fn build(cells: &[(String, String)]) -> Model<'static> {
    let mut model = new_empty_model();
    for (reference, content) in cells {
        model._set(reference, content);
    }
    model
}

/// Text of every cell in a generous area (spills can extend past the input grid),
/// plus a check that no formula was left unevaluated.
pub(super) fn snapshot(model: &Model) -> Vec<String> {
    let mut lines = Vec::new();
    let worksheet = model.workbook.worksheet(0).unwrap();
    for row in 1..=(ROWS + 6) {
        for column in 1..=(COLS + 6) {
            if let Some(Cell::CellFormula {
                v: FormulaValue::Unevaluated,
                ..
            })
            | Some(Cell::ArrayFormula {
                v: FormulaValue::Unevaluated,
                ..
            }) = worksheet.cell(row, column)
            {
                lines.push(format!("{}: UNEVALUATED", cell_name(row, column)));
                continue;
            }
            let text = model._get_text_at(0, row, column);
            if !text.is_empty() {
                lines.push(format!("{}: {text}", cell_name(row, column)));
            }
        }
    }
    lines
}

pub(super) fn describe(cells: &[(String, String)]) -> String {
    cells
        .iter()
        .map(|(r, c)| format!("  {r} = {c}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn random_sheets_are_order_independent_fixed_points() {
    let mut failures = Vec::new();
    for seed in 1..=SEEDS {
        let cells = random_sheet(seed);

        let mut model = build(&cells);
        model.evaluate();
        let first = snapshot(&model);
        let mut inconsistencies = super::oracle::violations(&mut model);
        model.evaluate();
        let second = snapshot(&model);

        let mut other = build(&shuffled(&cells, seed));
        other.evaluate();
        let other_first = snapshot(&other);
        inconsistencies.extend(super::oracle::violations(&mut other));

        let unevaluated = first.iter().any(|l| l.ends_with("UNEVALUATED"));
        let history_dependent = first
            .iter()
            .chain(second.iter())
            .chain(other_first.iter())
            .any(|l| l.ends_with("#SPILL!") || l.ends_with("#CIRC!"));
        let same_state = history_dependent || (first == second && first == other_first);
        if !same_state || unevaluated || !inconsistencies.is_empty() {
            failures.push(format!(
                "seed {seed}\n{}\nfirst evaluation:\n  {}\nsecond evaluation:\n  {}\nshuffled insertion:\n  {}\ninconsistencies:\n  {}",
                describe(&cells),
                first.join("\n  "),
                second.join("\n  "),
                other_first.join("\n  "),
                inconsistencies.join("\n  "),
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {SEEDS} random sheets failed:\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
}
