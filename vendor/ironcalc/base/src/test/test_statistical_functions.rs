#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── FREQUENCY ────────────────────────────────────────────────────────────────

#[test]
fn test_frequency_basic() {
    let mut model = new_empty_model();
    // data: 1,2,3,4,5  bins: 2,4
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("B1", "2");
    model._set("B2", "4");
    model._set("C1", "=FREQUENCY(A1:A5, B1:B2)");
    model.evaluate();
    // ≤2: {1,2}=2, (2,4]: {3,4}=2, >4: {5}=1
    assert_eq!(model._get_text("C1"), "2");
    assert_eq!(model._get_text("C2"), "2");
    assert_eq!(model._get_text("C3"), "1");
}

// ── MODE.SNGL ────────────────────────────────────────────────────────────────

#[test]
fn test_mode_sngl_basic() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "1");
    model._set("A3", "3");
    model._set("A4", "2");
    model._set("B1", "=MODE.SNGL(A1:A4)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
}

#[test]
fn test_mode_sngl_no_mode_returns_na() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=MODE.SNGL(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#N/A");
}

// ── MODE.MULT ────────────────────────────────────────────────────────────────

#[test]
fn test_mode_mult_two_modes() {
    let mut model = new_empty_model();
    // 1,1,2,2,3 → modes are 1 and 2
    model._set("A1", "1");
    model._set("A2", "1");
    model._set("A3", "2");
    model._set("A4", "2");
    model._set("A5", "3");
    model._set("B1", "=MODE.MULT(A1:A5)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "2");
}

// ── PERCENTILE.INC ───────────────────────────────────────────────────────────

#[test]
fn test_percentile_inc_median() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("B1", "=PERCENTILE.INC(A1:A5, 0.5)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
}

#[test]
fn test_percentile_inc_q1() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("B1", "=PERCENTILE.INC(A1:A4, 0.25)");
    model.evaluate();
    // rank = 0.25 * 3 = 0.75 → 1 + 0.75*(2-1) = 1.75
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 1.75).abs() < 1e-10);
}

// ── PERCENTILE.EXC ───────────────────────────────────────────────────────────

#[test]
fn test_percentile_exc_basic() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("B1", "=PERCENTILE.EXC(A1:A4, 0.25)");
    model.evaluate();
    // rank = 0.25*(4+1)-1 = 0.25 → 1 + 0.25*(2-1) = 1.25
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 1.25).abs() < 1e-10);
}

// ── PERCENTRANK.INC ──────────────────────────────────────────────────────────

#[test]
fn test_percentrank_inc_exact_match() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    // rank of 3 in {1,2,3,4,5}: 2/4 = 0.5
    model._set("B1", "=PERCENTRANK.INC(A1:A5, 3)");
    model.evaluate();
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 0.5).abs() < 0.001);
}

// ── PERCENTRANK.EXC ──────────────────────────────────────────────────────────

#[test]
fn test_percentrank_exc_basic() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    // rank of 3: position 2 (0-indexed) → (2+1)/(5+1) = 3/6 = 0.5
    model._set("B1", "=PERCENTRANK.EXC(A1:A5, 3)");
    model.evaluate();
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 0.5).abs() < 0.001);
}

// ── PERMUT ───────────────────────────────────────────────────────────────────

#[test]
fn test_permut_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=PERMUT(6, 2)");
    model.evaluate();
    // 6*5 = 30
    assert_eq!(model._get_text("A1"), "30");
}

#[test]
fn test_permut_invalid() {
    let mut model = new_empty_model();
    model._set("A1", "=PERMUT(2, 6)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#NUM!");
}

// ── PERMUTATIONA ─────────────────────────────────────────────────────────────

#[test]
fn test_permutationa_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=PERMUTATIONA(3, 2)");
    model.evaluate();
    // 3^2 = 9
    assert_eq!(model._get_text("A1"), "9");
}

// ── PROB ─────────────────────────────────────────────────────────────────────

#[test]
fn test_prob_basic() {
    let mut model = new_empty_model();
    // x: 1,2,3,4  prob: 0.1, 0.2, 0.3, 0.4
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("B1", "0.1");
    model._set("B2", "0.2");
    model._set("B3", "0.3");
    model._set("B4", "0.4");
    model._set("C1", "=PROB(A1:A4, B1:B4, 2, 3)");
    model.evaluate();
    // P(2<=x<=3) = 0.2+0.3 = 0.5
    let v: f64 = model._get_text("C1").parse().unwrap();
    assert!((v - 0.5).abs() < 1e-10);
}

// ── QUARTILE.INC ─────────────────────────────────────────────────────────────

#[test]
fn test_quartile_inc_q2_is_median() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("B1", "=QUARTILE.INC(A1:A5, 2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
}

// ── QUARTILE.EXC ─────────────────────────────────────────────────────────────

#[test]
fn test_quartile_exc_q2() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("B1", "=QUARTILE.EXC(A1:A5, 2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
}

// ── TRIMMEAN ─────────────────────────────────────────────────────────────────

#[test]
fn test_trimmean_basic() {
    let mut model = new_empty_model();
    // data: 1,2,3,4,5,6,7,8,9,10  percent=0.2 → trim 1 from each end → mean(2..9)
    for i in 1..=10 {
        model._set(&format!("A{i}"), &i.to_string());
    }
    model._set("B1", "=TRIMMEAN(A1:A10, 0.2)");
    model.evaluate();
    // trim 1 from each end of [1..10]: mean(2,3,4,5,6,7,8,9) = 44/8 = 5.5
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 5.5).abs() < 1e-10);
}

// ── LINEST ───────────────────────────────────────────────────────────────────

#[test]
fn test_linest_slope_intercept() {
    let mut model = new_empty_model();
    // y = 2x + 1: data (1,3), (2,5), (3,7)
    model._set("A1", "3");
    model._set("A2", "5");
    model._set("A3", "7");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("C1", "=LINEST(A1:A3, B1:B3)");
    model.evaluate();
    // slope = 2, intercept = 1
    let slope: f64 = model._get_text("C1").parse().unwrap();
    let intercept: f64 = model._get_text("D1").parse().unwrap();
    assert!((slope - 2.0).abs() < 1e-10);
    assert!((intercept - 1.0).abs() < 1e-10);
}

#[test]
fn test_linest_stats_true() {
    let mut model = new_empty_model();
    // Perfect line y = 2x + 1 → R² = 1
    model._set("A1", "3");
    model._set("A2", "5");
    model._set("A3", "7");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("C1", "=LINEST(A1:A3, B1:B3, TRUE, TRUE)");
    model.evaluate();
    // LINEST stats=TRUE returns 5×2 array at C1:D5; R² is at C3
    let r_sq: f64 = model._get_text("C3").parse().unwrap();
    assert!(
        (r_sq - 1.0).abs() < 1e-10,
        "R² should be 1 for perfect fit, got {r_sq}"
    );
}

// ── TREND ────────────────────────────────────────────────────────────────────

#[test]
fn test_trend_basic() {
    let mut model = new_empty_model();
    // y = 2x + 1
    model._set("A1", "3");
    model._set("A2", "5");
    model._set("A3", "7");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("D1", "4");
    model._set("D2", "5");
    model._set("C1", "=TREND(A1:A3, B1:B3, D1:D2)");
    model.evaluate();
    // TREND(x=4) = 9, TREND(x=5) = 11
    let v1: f64 = model._get_text("C1").parse().unwrap();
    let v2: f64 = model._get_text("C2").parse().unwrap();
    assert!((v1 - 9.0).abs() < 1e-10);
    assert!((v2 - 11.0).abs() < 1e-10);
}

// ── GROWTH ───────────────────────────────────────────────────────────────────

#[test]
fn test_growth_basic() {
    let mut model = new_empty_model();
    // y = 2 * 3^x at x=1,2,3: y = 6, 18, 54
    model._set("A1", "6");
    model._set("A2", "18");
    model._set("A3", "54");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("D1", "4");
    model._set("C1", "=GROWTH(A1:A3, B1:B3, D1)");
    model.evaluate();
    // GROWTH(x=4) ≈ 2 * 3^4 = 162
    let v: f64 = model._get_text("C1").parse().unwrap();
    assert!(
        (v - 162.0).abs() < 0.01,
        "GROWTH(4) should be ~162, got {v}"
    );
}

// ── LOGEST ───────────────────────────────────────────────────────────────────

#[test]
fn test_logest_basic() {
    let mut model = new_empty_model();
    // y = 2 * 3^x: same data as GROWTH test
    model._set("A1", "6");
    model._set("A2", "18");
    model._set("A3", "54");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("C1", "=LOGEST(A1:A3, B1:B3)");
    model.evaluate();
    // Returns {m, b} where y = b * m^x; m ≈ 3, b ≈ 2
    let m: f64 = model._get_text("C1").parse().unwrap();
    let b: f64 = model._get_text("D1").parse().unwrap();
    assert!((m - 3.0).abs() < 0.01, "m should be ≈3, got {m}");
    assert!((b - 2.0).abs() < 0.01, "b should be ≈2, got {b}");
}
