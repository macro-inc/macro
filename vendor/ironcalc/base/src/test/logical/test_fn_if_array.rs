#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── Scalar cond, array result ─────────────────────────────────────────────────
//
// When cond is a scalar, IF simply evaluates the chosen branch and returns it.
// If that branch is an array/range, the result spills.

#[test]
fn if_scalar_true_inline_array_spills_horizontally() {
    let mut model = new_empty_model();
    model._set("A1", "=IF(TRUE, {1,2,3})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn if_scalar_false_picks_else_array() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IF(FALSE, {10,20,30}, {1,2,3})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn if_scalar_true_range_spills_vertically() {
    let mut model = new_empty_model();
    model._set("B1", "10");
    model._set("B2", "20");
    model._set("B3", "30");
    model._set("A1", "=IF(TRUE, B1:B3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "20");
    assert_eq!(model._get_text("A3"), "30");
}

// ── Array cond, scalar branches ───────────────────────────────────────────────
//
// When cond is an array and the branches are scalars, IF iterates over the cond
// array and applies the scalar to each element. Output size = cond size.

#[test]
fn if_array_cond_scalar_branches_horizontal() {
    let mut model = new_empty_model();
    model._set("A1", "=IF({TRUE,FALSE,TRUE}, 1, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "0");
    assert_eq!(model._get_text("C1"), "1");
}

#[test]
fn if_range_cond_scalar_branches_vertical() {
    // Range cond is vertical: spills downward.
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "0");
    model._set("B3", "1");
    model._set("A1", r#"=IF(B1:B3, "yes", "no")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "yes");
    assert_eq!(model._get_text("A2"), "no");
    assert_eq!(model._get_text("A3"), "yes");
}

// ── Array cond, array branches, same size ─────────────────────────────────────
//
// =IF({TRUE,FALSE,TRUE}, {1,2,3}, {"A","B","C"}) → {1,"B",3}
// At each index i: pick true[i] if cond[i] is true, else false[i].

#[test]
fn if_array_cond_matching_arrays() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IF({TRUE,FALSE,TRUE}, {1,2,3}, {"A","B","C"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "B");
    assert_eq!(model._get_text("C1"), "3");
}

// ── Array cond, if_true array is smaller than cond ────────────────────────────
//
// =IF({TRUE,FALSE,TRUE}, {1,2}, {"A","B","C"})
// Index 0: cond=TRUE  → true[0]=1  → 1
// Index 1: cond=FALSE → false[1]="B" → "B"
// Index 2: cond=TRUE  → true[2] missing → #N/A

#[test]
fn if_array_cond_true_branch_smaller() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IF({TRUE,FALSE,TRUE}, {1,2}, {"A","B","C"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "B");
    assert_eq!(model._get_text("C1"), "#N/A");
}

// ── Array cond, if_false is a length-1 array (broadcasts) ─────────────────────
//
// A length-1 dimension broadcasts to cover the whole extent (Excel's rule), so
// the single-element if_false array repeats across every false position.
// =IF({TRUE,FALSE,TRUE}, {1,2,3}, {"A"})
// Index 0: cond=TRUE  → true[0]=1   → 1
// Index 1: cond=FALSE → false[0]="A" → "A"  (broadcast)
// Index 2: cond=TRUE  → true[2]=3   → 3

#[test]
fn if_array_cond_false_branch_broadcasts() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IF({TRUE,FALSE,TRUE}, {1,2,3}, {"A"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "A");
    assert_eq!(model._get_text("C1"), "3");
}

// ── Column cond × row branches broadcast to a 2-D grid ────────────────────────
//
// A 3×1 cond broadcasts its single column and the 1×2 branches broadcast their
// single row, producing a 3×2 result.
// =IF({TRUE;FALSE;TRUE}, {1,2}, {7,8})
//   1 2   (cond row 0 = TRUE  → true row)
//   7 8   (cond row 1 = FALSE → false row)
//   1 2   (cond row 2 = TRUE  → true row)

#[test]
fn if_column_cond_broadcasts_row_branches() {
    let mut model = new_empty_model();
    model._set("A1", "=IF({TRUE;FALSE;TRUE}, {1,2}, {7,8})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("A2"), "7");
    assert_eq!(model._get_text("B2"), "8");
    assert_eq!(model._get_text("A3"), "1");
    assert_eq!(model._get_text("B3"), "2");
}

// ── All three arguments are arrays; largest determines output size ────────────
//
// =IF({TRUE,FALSE}, {1,2,3}, {"A","B","C"})
// Largest is 3 (from both branch arrays). cond has only 2 elements.
// Index 0: cond[0]=TRUE,  true[0]=1   → 1
// Index 1: cond[1]=FALSE, false[1]="B" → "B"
// Index 2: cond[2] missing             → #N/A

#[test]
fn if_all_arrays_cond_is_smallest() {
    let mut model = new_empty_model();
    model._set("A1", r#"=IF({TRUE,FALSE}, {1,2,3}, {"A","B","C"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "B");
    assert_eq!(model._get_text("C1"), "#N/A");
}

// ── No if_false argument with array cond ─────────────────────────────────────
//
// When if_false is omitted and cond is array-valued, false positions yield FALSE
// (same as the scalar behaviour: =IF(FALSE, x) → FALSE).

#[test]
fn if_array_cond_no_else_branch() {
    let mut model = new_empty_model();
    model._set("A1", "=IF({TRUE,FALSE,TRUE}, {1,2,3})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "FALSE");
    assert_eq!(model._get_text("C1"), "3");
}

// ── Error values inside the cond array ───────────────────────────────────────
//
// When a cond element is itself an error, that error propagates to the
// corresponding output position.
// =IF({TRUE,#N/A,FALSE}, 1, 0) → {1, #N/A, 0}

#[test]
fn if_array_cond_with_error_element() {
    let mut model = new_empty_model();
    model._set("A1", "=IF({TRUE,#N/A,FALSE}, 1, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "#N/A");
    assert_eq!(model._get_text("C1"), "0");
}

// ── 2-D array cond ────────────────────────────────────────────────────────────
//
// Inline arrays use `;` to separate rows.
// =IF({TRUE,FALSE;FALSE,TRUE}, {1,2;3,4}, {"A","B";"C","D"})
// → {{1,"B"},{"C",4}} — a 2×2 result that spills over a 2×2 block.

#[test]
fn if_2d_array_cond() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        r#"=IF({TRUE,FALSE;FALSE,TRUE}, {1,2;3,4}, {"A","B";"C","D"})"#,
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "B");
    assert_eq!(model._get_text("A2"), "C");
    assert_eq!(model._get_text("B2"), "4");
}

#[test]
fn let_calendar_function() {
    let mut model = new_empty_model();
    model._set("B2", "2026");
    model._set("B6", "May");
    let formula = r#"=LET(mo,MONTH(DATEVALUE("1/"&B6&"/2026")),yr,$B$2,anchor,DATE(yr,mo,1),first_mon,anchor-(WEEKDAY(anchor,2)-1),grid,SEQUENCE(6,7,0),d,first_mon+grid,IF(MONTH(d)=mo,DAY(d),""))"#;
    model._set("B9", formula);
    model.evaluate();

    assert_eq!(model._get_text("B10"), "4");
    assert_eq!(model._get_text("C10"), "5");
    assert_eq!(model._get_text("H13"), "31");
}

#[test]
fn let_calendar_function_with_array_cond() {
    let mut model = new_empty_model();
    model._set("B2", "2026");
    let formula = r#"=LET(d,DAY(EOMONTH(DATE($B$2,1,1),0)),n,SEQUENCE(1,31),IF(n<=d,TEXT(DATE($B$2,1,n),"ddd"),""))"#;
    model._set("A10", formula);
    model.evaluate();

    assert_eq!(model._get_text("A10"), "Thu");
    assert_eq!(model._get_text("B10"), "Fri");
    assert_eq!(model._get_text("C10"), "Sat");
    assert_eq!(model._get_text("D10"), "Sun");
}
