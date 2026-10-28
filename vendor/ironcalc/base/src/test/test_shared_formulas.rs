#![allow(clippy::unwrap_used)]

// The formulas of a sheet are kept once each, in `Worksheet::shared_formulas`,
// in R1C1 form, and the cells hold an index into that list. The index of a
// formula is found through `Model::shared_formula_lookup`, not by comparing the
// formula with every other one: a sheet with many different formulas would
// otherwise take a time quadratic in their number to build or to load.
//
// These tests are about the lookup staying in step with the list.

use crate::test::util::new_empty_model;
use crate::Model;

/// The list and the lookup of a sheet say the same thing.
#[track_caller]
fn assert_in_step(model: &Model, sheet: usize) {
    let shared_formulas = &model.workbook.worksheets[sheet].shared_formulas;
    let lookup = &model.shared_formula_lookup[sheet];
    for (index, formula) in shared_formulas.iter().enumerate() {
        let found = lookup.index.get(formula).copied();
        // a formula that is in the list twice is found at its first place
        let first = shared_formulas.iter().position(|f| f == formula).unwrap();
        assert_eq!(found, Some(first as i32), "formula {index}: {formula}");
    }
    assert!(lookup.index.len() <= shared_formulas.len());
    assert_eq!(lookup.built_from, shared_formulas.len());
}

#[test]
fn the_same_formula_is_kept_once() {
    let mut model = new_empty_model();
    // the same in R1C1: each reads the cell on its left
    model._set("B1", "=A1+1");
    model._set("B2", "=A2+1");
    model._set("B3", "=A3+1");
    // different ones
    model._set("C1", "=$A$1+1");
    model._set("C2", "=$A$2+1");
    model._set("A1", "10");
    model._set("A2", "20");
    model.evaluate();

    assert_eq!(model.workbook.worksheets[0].shared_formulas.len(), 3);
    assert_in_step(&model, 0);
    assert_eq!(model._get_text("B2"), "21");
    assert_eq!(model._get_text("C1"), "11");
    assert_eq!(model._get_text("C2"), "21");
}

// Every formula is different from the others. With the list searched from the
// start for each of them this took about a minute for 100,000 formulas in a
// release build, and far longer in a debug one; it is now linear.
#[test]
fn many_different_formulas() {
    let mut model = new_empty_model();
    let n = 20_000;
    for row in 1..=n {
        model
            .set_user_input(0, row, 1, format!("=$B${row}*2"))
            .unwrap();
    }
    model._set("B7", "21");
    model.evaluate();
    assert_eq!(
        model.workbook.worksheets[0].shared_formulas.len(),
        n as usize
    );
    assert_eq!(model.shared_formula_lookup[0].index.len(), n as usize);
    assert_eq!(model._get_text("A7"), "42");
    assert_eq!(model._get_text("A8"), "0");
}

// Deleting a sheet and giving its name to another can leave the same formula
// twice in the list. The lookup then has fewer entries than the list, which
// must not make it look out of step: it would be rebuilt for every new
// formula, and adding many would be quadratic again.
#[test]
fn a_formula_twice_in_the_list_does_not_slow_down_adding_formulas() {
    let mut model = new_empty_model();
    model.new_sheet();
    model.new_sheet();
    model._set("A1", "=Sheet2!A1");
    model._set("B2", "=Sheet3!B2");
    model.delete_sheet(1).unwrap();
    model.rename_sheet_by_index(1, "Sheet2").unwrap();
    let shared_formulas = &model.workbook.worksheets[0].shared_formulas;
    assert_eq!(shared_formulas.len(), 2);
    assert_eq!(shared_formulas[0], shared_formulas[1]);
    assert_in_step(&model, 0);

    let n = 20_000;
    for row in 1..=n {
        model
            .set_user_input(0, row, 3, format!("=$B${row}*2"))
            .unwrap();
    }
    model._set("B7", "21");
    model.evaluate();
    assert_eq!(
        model.workbook.worksheets[0].shared_formulas.len(),
        n as usize + 2
    );
    assert_eq!(model.shared_formula_lookup[0].index.len(), n as usize + 1);
    assert_in_step(&model, 0);
    assert_eq!(model._get_text("C7"), "42");
}

// Renaming a sheet rewrites the text of every formula that mentions it, in
// place: the list keeps its length and changes its contents.
#[test]
fn renaming_a_sheet_keeps_the_lookup_in_step() {
    let mut model = new_empty_model();
    model.new_sheet();
    model._set("Sheet2!A1", "5");
    model._set("Sheet2!A2", "6");
    model._set("B1", "=Sheet2!A1+1");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "6");

    model.rename_sheet("Sheet2", "Data").unwrap();
    assert_in_step(&model, 0);

    // The same formula again, under the new name: it is found, not added.
    let before = model.workbook.worksheets[0].shared_formulas.len();
    model._set("B2", "=Data!A2+1");
    model.evaluate();
    assert_eq!(model.workbook.worksheets[0].shared_formulas.len(), before);
    assert_in_step(&model, 0);
    assert_eq!(model._get_text("B1"), "6");
    assert_eq!(model._get_text("B2"), "7");
}

// Adding and deleting sheets moves the sheets that follow: the lookup of a
// sheet has to move with it.
#[test]
fn adding_and_deleting_sheets_keeps_the_lookups_in_step() {
    let mut model = new_empty_model();
    model.new_sheet();
    model.new_sheet();
    model._set("Sheet1!B1", "=A1+1");
    model._set("Sheet2!B1", "=A1*2");
    model._set("Sheet3!B1", "=A1*3");
    model._set("Sheet3!B2", "=$A$1*3");
    model.evaluate();

    model.delete_sheet(1).unwrap();
    for sheet in 0..2 {
        assert_in_step(&model, sheet);
    }
    // what was the third sheet is now the second
    let before = model.workbook.worksheets[1].shared_formulas.len();
    assert_eq!(before, 2);
    model._set("Sheet3!B5", "=A5*3");
    model._set("Sheet3!A5", "4");
    model.evaluate();
    assert_eq!(model.workbook.worksheets[1].shared_formulas.len(), before);
    assert_eq!(model._get_text("Sheet3!B5"), "12");

    model.duplicate_sheet(1).unwrap();
    for sheet in 0..3 {
        assert_in_step(&model, sheet);
    }
}

// Nothing is expected to put the lookup out of step, but the list is a public
// field and the lookup is only an aid. A lookup that disagrees with the list
// is not believed.
#[test]
fn a_lookup_out_of_step_is_not_believed() {
    let mut model = new_empty_model();
    model._set("B1", "=A1+1");
    model._set("C1", "=$A$1*2");
    model._set("A1", "3");
    let formula = model.workbook.worksheets[0].shared_formulas[0].clone();

    // it names the wrong place for a formula that is in the list
    model.shared_formula_lookup[0].index.insert(formula, 1);
    model._set("B2", "=A2+1");
    // it was built from nothing
    model.shared_formula_lookup[0] = Default::default();
    model._set("B3", "=A3+1");
    // it has never heard of the sheet
    model.shared_formula_lookup.clear();
    model._set("B4", "=A4+1");

    model._set("A2", "4");
    model.evaluate();
    assert_eq!(model.workbook.worksheets[0].shared_formulas.len(), 2);
    assert_in_step(&model, 0);
    assert_eq!(model._get_text("B1"), "4");
    assert_eq!(model._get_text("B2"), "5");
    assert_eq!(model._get_text("C1"), "6");
}
