#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// Data used by most tests:
//   A1:A5 = 1,2,3,4,5     (criteria range)
//   B1:B5 = 10,20,30,40,50 (sum range)
fn numeric_model() -> crate::model::Model<'static> {
    let mut model = new_empty_model();
    for (i, (a, b)) in [(1, 10), (2, 20), (3, 30), (4, 40), (5, 50)]
        .iter()
        .enumerate()
    {
        let row = i + 1;
        model._set(&format!("A{row}"), &a.to_string());
        model._set(&format!("B{row}"), &b.to_string());
    }
    model
}

// ── Scalar criterion still returns a scalar (regression) ──────────────────────

#[test]
fn sumif_scalar_criterion_is_unchanged() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,">2",B1:B5)"#);
    model.evaluate();
    // A3,A4,A5 > 2 → 30+40+50
    assert_eq!(model._get_text("D1"), "120");
}

// ── Inline array criteria spill horizontally ──────────────────────────────────

#[test]
fn sumif_inline_array_criteria_horizontal() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,{">2","<=2"},B1:B5)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "120"); // >2  → 30+40+50
    assert_eq!(model._get_text("E1"), "30"); //  <=2 → 10+20
}

// ── Inline array criteria spill vertically ────────────────────────────────────

#[test]
fn sumif_inline_array_criteria_vertical() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,{">2";"<=2"},B1:B5)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "120");
    assert_eq!(model._get_text("D2"), "30");
}

// ── Range criteria spill one sum per criterion cell ───────────────────────────

#[test]
fn sumif_range_criteria() {
    let mut model = numeric_model();
    model._set("G1", ">2");
    model._set("G2", "<=2");
    model._set("D1", "=SUMIF(A1:A5,G1:G2,B1:B5)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "120");
    assert_eq!(model._get_text("D2"), "30");
}

// ── 2-argument form (sum_range omitted → criteria_range is summed) ────────────

#[test]
fn sumif_array_criteria_without_sum_range() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,{">2","<=2"})"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "12"); // 3+4+5
    assert_eq!(model._get_text("E1"), "3"); //  1+2
}

// ── Text criteria matching ────────────────────────────────────────────────────

#[test]
fn sumif_array_text_criteria() {
    let mut model = new_empty_model();
    for (i, (a, b)) in [
        ("apple", 1),
        ("banana", 2),
        ("apple", 3),
        ("cherry", 4),
        ("banana", 5),
    ]
    .iter()
    .enumerate()
    {
        let row = i + 1;
        model._set(&format!("A{row}"), a);
        model._set(&format!("B{row}"), &b.to_string());
    }
    model._set("D1", r#"=SUMIF(A1:A5,{"apple","banana"},B1:B5)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "4"); // apple → 1+3
    assert_eq!(model._get_text("E1"), "7"); // banana → 2+5
}

// ── 2-D array criteria preserve their shape ──────────────────────────────────

#[test]
fn sumif_2d_array_criteria() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,{">2","<=2";">=4","=1"},B1:B5)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "120"); // >2  → 30+40+50
    assert_eq!(model._get_text("E1"), "30"); //  <=2 → 10+20
    assert_eq!(model._get_text("D2"), "90"); //  >=4 → 40+50
    assert_eq!(model._get_text("E2"), "10"); //  =1  → 10
}

// ── A non-matching criterion sums to zero ─────────────────────────────────────

#[test]
fn sumif_array_criteria_with_no_match() {
    let mut model = numeric_model();
    model._set("D1", r#"=SUMIF(A1:A5,{">2",">100"},B1:B5)"#);
    model.evaluate();
    assert_eq!(model._get_text("D1"), "120");
    assert_eq!(model._get_text("E1"), "0");
}
