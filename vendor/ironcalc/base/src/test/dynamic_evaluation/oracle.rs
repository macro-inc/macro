#![allow(clippy::unwrap_used)]

// The consistency oracle of evaluation.
//
// A sheet is consistent when every formula cell that does not hold #CIRC!
// stores what its formula gives when evaluated against the sheet itself, and
// every array result either occupies its area as spill cells of the anchor or
// is blocked and the anchor holds #SPILL!. The oracle re-runs every formula
// against the final sheet and reports every violation. It also reports spill
// cells whose anchor does not cover them (orphans).
//
// It must only be called on a fully evaluated model: every formula cell is
// then `Evaluated`, so re-running a formula reads stored values only and does
// not modify the sheet. Volatile functions would trip it by design.

use crate::calc_result::CalcResult;
use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::parser::ArrayNode;
use crate::expressions::token::Error;
use crate::expressions::types::CellReferenceIndex;
use crate::types::{ArrayKind, Cell, FormulaValue, SpillValue};
use crate::Model;

fn name(sheet: u32, row: i32, column: i32) -> String {
    let mut col = String::new();
    let mut c = column;
    while c > 0 {
        let rem = (c - 1) % 26;
        col.insert(0, (b'A' + rem as u8) as char);
        c = (c - 1) / 26;
    }
    format!("{sheet}:{col}{row}")
}

fn scalar_matches(stored: &FormulaValue, result: &CalcResult) -> bool {
    match (stored, result) {
        (FormulaValue::Number(a), CalcResult::Number(b)) => a == b,
        (FormulaValue::Number(a), CalcResult::EmptyCell | CalcResult::EmptyArg) => *a == 0.0,
        (FormulaValue::Text(a), CalcResult::String(b)) => a == b,
        (FormulaValue::Boolean(a), CalcResult::Boolean(b)) => a == b,
        (FormulaValue::Error { ei, .. }, CalcResult::Error { error, .. }) => ei == error,
        _ => false,
    }
}

fn spill_matches(stored: &SpillValue, node: &ArrayNode) -> bool {
    match (stored, node) {
        (SpillValue::Number(a), ArrayNode::Number(b)) => a == b,
        (SpillValue::Number(a), ArrayNode::Empty) => *a == 0.0,
        (SpillValue::Text(a), ArrayNode::String(b)) => a == b,
        (SpillValue::Boolean(a), ArrayNode::Boolean(b)) => a == b,
        (SpillValue::Error(a), ArrayNode::Error(b)) => a == b,
        _ => false,
    }
}

fn anchor_matches(stored: &FormulaValue, node: &ArrayNode) -> bool {
    match (stored, node) {
        (FormulaValue::Number(a), ArrayNode::Number(b)) => a == b,
        (FormulaValue::Number(a), ArrayNode::Empty) => *a == 0.0,
        (FormulaValue::Text(a), ArrayNode::String(b)) => a == b,
        (FormulaValue::Boolean(a), ArrayNode::Boolean(b)) => a == b,
        (FormulaValue::Error { ei, .. }, ArrayNode::Error(b)) => ei == b,
        _ => false,
    }
}

fn describe(result: &CalcResult) -> String {
    match result {
        CalcResult::Number(n) => format!("{n}"),
        CalcResult::String(s) => format!("{s:?}"),
        CalcResult::Boolean(b) => format!("{b}"),
        CalcResult::Error { error, .. } => format!("{error:?}"),
        CalcResult::EmptyCell | CalcResult::EmptyArg => "empty".to_string(),
        CalcResult::Range { .. } => "range".to_string(),
        CalcResult::Array(a) => format!("array {}x{}", a.len(), a.first().map_or(0, |r| r.len())),
        CalcResult::Lambda(_) => "lambda".to_string(),
    }
}

/// Returns every inconsistency between the stored values and what the
/// formulas give against the final sheet. Empty means consistent.
pub(crate) fn violations(model: &mut Model) -> Vec<String> {
    let mut out = Vec::new();
    let cells = model.get_all_cells();
    for index in cells {
        let (sheet, row, column) = (index.index, index.row, index.column);
        let cell_ref = CellReferenceIndex { sheet, row, column };
        let cell = model
            .workbook
            .worksheet(sheet)
            .unwrap()
            .cell(row, column)
            .unwrap()
            .clone();

        // Orphan spill cells.
        if let Cell::SpillCell { a, .. } = &cell {
            let covered = matches!(
                model.workbook.worksheet(sheet).unwrap().cell(a.0, a.1),
                Some(Cell::ArrayFormula { r: (width, height), .. })
                    if row >= a.0 && row < a.0 + height && column >= a.1 && column < a.1 + width
            );
            if !covered {
                out.push(format!(
                    "{}: spill cell whose anchor {} does not cover it",
                    name(sheet, row, column),
                    name(sheet, a.0, a.1)
                ));
            }
            continue;
        }

        let (formula, stored) = match &cell {
            Cell::CellFormula { f, v, .. } | Cell::ArrayFormula { f, v, .. } => (*f, v.clone()),
            _ => continue,
        };
        if matches!(stored, FormulaValue::Unevaluated) {
            out.push(format!("{}: unevaluated", name(sheet, row, column)));
            continue;
        }
        if matches!(
            &stored,
            FormulaValue::Error {
                ei: Error::CIRC,
                ..
            }
        ) {
            continue;
        }

        let node = model.parsed_formulas[sheet as usize][formula as usize]
            .0
            .clone();
        let mut result = model.evaluate_node_in_context(&node, cell_ref);
        if let CalcResult::Range { left, right } = result {
            result = if left == right {
                model.evaluate_cell(left)
            } else {
                CalcResult::Array(model.evaluate_range(left, right))
            };
        }
        if matches!(result, CalcResult::Lambda(_)) {
            result = CalcResult::new_error(Error::CALC, cell_ref, String::new());
        }

        match (&cell, &result) {
            (_, CalcResult::Array(array)) if array.is_empty() || array[0].is_empty() => {
                if !matches!(
                    &stored,
                    FormulaValue::Error {
                        ei: Error::CALC,
                        ..
                    }
                ) {
                    out.push(format!(
                        "{}: zero-size array, stored {stored:?}",
                        name(sheet, row, column)
                    ));
                }
            }
            (
                Cell::ArrayFormula {
                    kind: ArrayKind::Dynamic,
                    ..
                },
                CalcResult::Array(array),
            ) => {
                let height = array.len() as i32;
                let width = array[0].len() as i32;
                let ws = model.workbook.worksheet(sheet).unwrap();
                let out_of_bounds = row + height - 1 > LAST_ROW || column + width - 1 > LAST_COLUMN;
                let blocked = out_of_bounds
                    || (0..height).any(|i| {
                        (0..width).any(|j| {
                            (i, j) != (0, 0)
                                && (ws.merged_cell_containing(row + i, column + j).is_some()
                                    || match ws.cell(row + i, column + j) {
                                        None | Some(Cell::EmptyCell { .. }) => false,
                                        Some(Cell::SpillCell { a, .. }) => *a != (row, column),
                                        Some(_) => true,
                                    })
                        })
                    });
                if blocked {
                    if !matches!(
                        &stored,
                        FormulaValue::Error {
                            ei: Error::SPILL,
                            ..
                        }
                    ) {
                        out.push(format!(
                            "{}: spill area is blocked but stored {stored:?}",
                            name(sheet, row, column)
                        ));
                    }
                    continue;
                }
                if !anchor_matches(&stored, &array[0][0]) {
                    out.push(format!(
                        "{}: anchor stores {stored:?}, formula gives {:?}",
                        name(sheet, row, column),
                        array[0][0]
                    ));
                }
                for i in 0..height {
                    for j in 0..width {
                        if (i, j) == (0, 0) {
                            continue;
                        }
                        let expected = &array[i as usize][j as usize];
                        match ws.cell(row + i, column + j) {
                            Some(Cell::SpillCell { a, v, .. })
                                if *a == (row, column) && spill_matches(v, expected) => {}
                            other => out.push(format!(
                                "{}: expected spill cell of {} holding {expected:?}, found {other:?}",
                                name(sheet, row + i, column + j),
                                name(sheet, row, column)
                            )),
                        }
                    }
                }
            }
            (
                Cell::ArrayFormula {
                    kind: ArrayKind::Cse,
                    r: (width, height),
                    ..
                },
                CalcResult::Array(array),
            ) => {
                let ws = model.workbook.worksheet(sheet).unwrap();
                for i in 0..*height {
                    for j in 0..*width {
                        let expected = array
                            .get(i as usize)
                            .and_then(|r| r.get(j as usize))
                            .cloned()
                            .unwrap_or(ArrayNode::Error(Error::VALUE));
                        if (i, j) == (0, 0) {
                            if !anchor_matches(&stored, &expected) {
                                out.push(format!(
                                    "{}: CSE anchor stores {stored:?}, formula gives {expected:?}",
                                    name(sheet, row, column)
                                ));
                            }
                            continue;
                        }
                        match ws.cell(row + i, column + j) {
                            Some(Cell::SpillCell { a, v, .. })
                                if *a == (row, column) && spill_matches(v, &expected) => {}
                            other => out.push(format!(
                                "{}: expected CSE cell of {} holding {expected:?}, found {other:?}",
                                name(sheet, row + i, column + j),
                                name(sheet, row, column)
                            )),
                        }
                    }
                }
            }
            (Cell::CellFormula { .. }, CalcResult::Array(array)) => {
                let ok = if array.len() == 1 && array[0].len() == 1 {
                    anchor_matches(&stored, &array[0][0])
                } else {
                    matches!(
                        &stored,
                        FormulaValue::Error {
                            ei: Error::VALUE,
                            ..
                        }
                    )
                };
                if !ok {
                    out.push(format!(
                        "{}: scalar cell stores {stored:?}, formula gives {}",
                        name(sheet, row, column),
                        describe(&result)
                    ));
                }
            }
            (
                Cell::ArrayFormula {
                    kind: ArrayKind::Cse,
                    r: (width, height),
                    ..
                },
                scalar,
            ) => {
                // A scalar is broadcast over the CSE area.
                if !scalar_matches(&stored, scalar) {
                    out.push(format!(
                        "{}: CSE anchor stores {stored:?}, formula gives {}",
                        name(sheet, row, column),
                        describe(scalar)
                    ));
                }
                let ws = model.workbook.worksheet(sheet).unwrap();
                for i in 0..*height {
                    for j in 0..*width {
                        if (i, j) == (0, 0) {
                            continue;
                        }
                        let ok = matches!(
                            ws.cell(row + i, column + j),
                            Some(Cell::SpillCell { a, v, .. })
                                if *a == (row, column) && spill_matches(v, &match scalar {
                                    CalcResult::Number(n) => ArrayNode::Number(*n),
                                    CalcResult::String(s) => ArrayNode::String(s.clone()),
                                    CalcResult::Boolean(b) => ArrayNode::Boolean(*b),
                                    CalcResult::Error { error, .. } => ArrayNode::Error(error.clone()),
                                    _ => ArrayNode::Empty,
                                })
                        );
                        if !ok {
                            out.push(format!(
                                "{}: CSE cell of {} does not hold the broadcast value {}",
                                name(sheet, row + i, column + j),
                                name(sheet, row, column),
                                describe(scalar)
                            ));
                        }
                    }
                }
            }
            (_, scalar) => {
                // Dynamic anchor with a scalar result, or a plain formula.
                let expected_nan =
                    matches!(scalar, CalcResult::Number(n) if n.is_nan() || n.is_infinite());
                let ok = if expected_nan {
                    matches!(&stored, FormulaValue::Error { ei: Error::NUM, .. })
                } else {
                    scalar_matches(&stored, scalar)
                };
                if !ok {
                    out.push(format!(
                        "{}: stores {stored:?}, formula gives {}",
                        name(sheet, row, column),
                        describe(scalar)
                    ));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::violations;
    use crate::test::util::new_empty_model;
    use crate::types::{Cell, FormulaValue, SpillValue};

    #[test]
    fn consistent_sheet_has_no_violations() {
        let mut model = new_empty_model();
        model._set("A1", "=SEQUENCE(3)");
        model._set("B1", "=A3*2");
        model._set("C1", "=SUM(A1#)");
        model
            .set_user_array_formula(0, 1, 4, 1, 2, "=B1+1")
            .unwrap();
        model._set("E1", "=E1+1");
        model.evaluate();
        assert_eq!(violations(&mut model), Vec::<String>::new());
    }

    #[test]
    fn tampered_scalar_is_reported() {
        let mut model = new_empty_model();
        model._set("A1", "5");
        model._set("B1", "=A1*2");
        model.evaluate();
        let ws = model.workbook.worksheet_mut(0).unwrap();
        if let Some(Cell::CellFormula { v, .. }) = ws.cell_mut(1, 2) {
            *v = FormulaValue::Number(11.0);
        }
        let found = violations(&mut model);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].starts_with("0:B1: stores"), "{found:?}");
    }

    #[test]
    fn tampered_spill_cell_is_reported() {
        let mut model = new_empty_model();
        model._set("A1", "=SEQUENCE(3)");
        model.evaluate();
        let ws = model.workbook.worksheet_mut(0).unwrap();
        if let Some(Cell::SpillCell { v, .. }) = ws.cell_mut(2, 1) {
            *v = SpillValue::Number(99.0);
        }
        let found = violations(&mut model);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            found[0].starts_with("0:A2: expected spill cell of 0:A1"),
            "{found:?}"
        );
    }

    #[test]
    fn orphan_spill_cell_is_reported() {
        let mut model = new_empty_model();
        model._set("A1", "=SEQUENCE(2)");
        model.evaluate();
        let ws = model.workbook.worksheet_mut(0).unwrap();
        ws.update_cell(
            5,
            5,
            Cell::SpillCell {
                s: 0,
                a: (1, 1),
                v: SpillValue::Number(1.0),
            },
        )
        .unwrap();
        let found = violations(&mut model);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            found[0].starts_with("0:E5: spill cell whose anchor 0:A1"),
            "{found:?}"
        );
    }

    #[test]
    fn missing_spill_cell_is_reported() {
        let mut model = new_empty_model();
        model._set("A1", "=SEQUENCE(3)");
        model.evaluate();
        model
            .workbook
            .worksheet_mut(0)
            .unwrap()
            .remove_cell(3, 1)
            .unwrap();
        let found = violations(&mut model);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            found[0].starts_with("0:A3: expected spill cell"),
            "{found:?}"
        );
    }
}
