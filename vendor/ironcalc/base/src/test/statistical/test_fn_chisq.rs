#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_chisq_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: CDF
    model._set("A1", "=CHISQ.DIST(0.5, 4, TRUE)");

    // Valid: PDF
    model._set("A2", "=CHISQ.DIST(0.5, 4, FALSE)");

    // Valid: CDF with numeric cumulative (1 -> TRUE)
    model._set("A3", "=CHISQ.DIST(0.5, 4, 1)");

    // Wrong number of args -> #ERROR!
    model._set("A4", "=CHISQ.DIST(0.5, 4)");
    model._set("A5", "=CHISQ.DIST(0.5, 4, TRUE, FALSE)");

    // Domain errors
    // x < 0 -> #NUM!
    model._set("A6", "=CHISQ.DIST(-1, 4, TRUE)");
    // deg_freedom < 1 or > 10^10 -> #NUM!
    model._set("A7", "=CHISQ.DIST(0.5, 0, TRUE)");
    model._set("A8", "=CHISQ.DIST(10, 10000000000, TRUE)");
    model._set("A9", "=CHISQ.DIST(10, 10000000001, TRUE)");

    model.evaluate();

    // Values for df = 4
    // CDF(0.5) ≈ 0.026499021, PDF(0.5) ≈ 0.097350098
    assert_eq!(model._get_text("A1"), *"0.026499021");
    assert_eq!(model._get_text("A2"), *"0.097350098");
    assert_eq!(model._get_text("A3"), *"0.026499021");

    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"#NUM!");
}

#[test]
fn test_fn_chisq_dist_rt_smoke() {
    let mut model = new_empty_model();

    // Valid calls
    model._set("A1", "=CHISQ.DIST.RT(0.5, 4)");
    model._set("A2", "=CHISQ.DIST.RT(5, 4)");

    // Too few / too many args -> #ERROR!
    model._set("A3", "=CHISQ.DIST.RT(0.5)");
    model._set("A4", "=CHISQ.DIST.RT(0.5, 4, 1)");

    // Domain errors
    // x < 0 -> #NUM!
    model._set("A5", "=CHISQ.DIST.RT(-1, 4)");
    // deg_freedom < 1 or > 10^10 -> #NUM!
    model._set("A6", "=CHISQ.DIST.RT(0.5, 0)");
    model._set("A7", "=CHISQ.DIST.RT(0, 10000000000)");
    model._set("A8", "=CHISQ.DIST.RT(0, 10000000001)");

    model.evaluate();

    // For df = 4:
    // right tail at 0.5 ≈ 0.973500979
    // right tail at 5.0 ≈ 0.287297495
    assert_eq!(model._get_text("A1"), *"0.973500979");
    assert_eq!(model._get_text("A2"), *"0.287297495");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"1");
    assert_eq!(model._get_text("A8"), *"#NUM!");
}

#[test]
fn test_fn_chisq_inv_smoke() {
    let mut model = new_empty_model();

    // Valid calls
    model._set("A1", "=CHISQ.INV(0.95, 4)");
    model._set("A2", "=CHISQ.INV(0.1, 10)");

    // Wrong number of args -> #ERROR!
    model._set("A3", "=CHISQ.INV(0.95)");
    model._set("A4", "=CHISQ.INV(0.95, 4, 1)");

    // Domain errors
    // probability < 0 or > 1 -> #NUM!
    model._set("A5", "=CHISQ.INV(-0.1, 4)");
    model._set("A6", "=CHISQ.INV(1.1, 4)");
    // deg_freedom < 1 or > 10^10 -> #NUM!
    model._set("A7", "=CHISQ.INV(0.5, 0)");
    model._set("A8", "=CHISQ.INV(0, 10000000000)");
    model._set("A9", "=CHISQ.INV(0, 10000000001)");

    model.evaluate();

    // Standard critical values:
    // CHISQ.INV(0.95, 4) ≈ 9.487729037
    // CHISQ.INV(0.1, 10) ≈ 4.865182052
    assert_eq!(model._get_text("A1"), *"9.487729037");
    assert_eq!(model._get_text("A2"), *"4.865182052");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"#NUM!");
}

#[test]
fn test_fn_chisq_inv_rt_smoke() {
    let mut model = new_empty_model();

    // Valid calls
    model._set("A1", "=CHISQ.INV.RT(0.05, 4)");
    model._set("A2", "=CHISQ.INV.RT(0.9, 10)");

    // Wrong number of args -> #ERROR!
    model._set("A3", "=CHISQ.INV.RT(0.05)");
    model._set("A4", "=CHISQ.INV.RT(0.05, 4, 1)");

    // Domain errors
    // probability < 0 or > 1 -> #NUM!
    model._set("A5", "=CHISQ.INV.RT(-0.1, 4)");
    model._set("A6", "=CHISQ.INV.RT(1.1, 4)");
    // deg_freedom < 1 or > 10^10 -> #NUM!
    model._set("A7", "=CHISQ.INV.RT(0.5, 0)");
    model._set("A8", "=CHISQ.INV.RT(1, 10000000000)");
    model._set("A9", "=CHISQ.INV.RT(1, 10000000001)");

    model.evaluate();

    // For chi-square:
    // CHISQ.INV.RT(0.05, 4) = CHISQ.INV(0.95, 4) ≈ 9.487729037
    // CHISQ.INV.RT(0.9, 10)  = CHISQ.INV(0.1, 10) ≈ 4.865182052
    assert_eq!(model._get_text("A1"), *"9.487729037");
    assert_eq!(model._get_text("A2"), *"4.865182052");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
    assert_eq!(model._get_text("A8"), *"0");
    assert_eq!(model._get_text("A9"), *"#NUM!");
}

#[test]
fn test_booleans() {
    let mut model = new_empty_model();

    model._set("A1", "=CHISQ.DIST(7, TRUE, TRUE)");
    model._set("A2", "=CHISQ.INV(A1, TRUE)");
    model._set("A3", "=CHISQ.DIST.RT(7, TRUE)");
    model._set("A4", "=CHISQ.INV.RT(A3, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "0.991849028");
    assert_eq!(model._get_text("A2"), "7");
    assert_eq!(model._get_text("A3"), "0.008150972");
    assert_eq!(model._get_text("A4"), "7");
}

#[test]
fn test_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=CHISQ.DIST()");
    model._set("A2", "=CHISQ.DIST(8)");
    model._set("A3", "=CHISQ.DIST(8, 3)");
    model._set("A4", "=CHISQ.DIST(8, 3, TRUE)");
    model._set("A5", "=CHISQ.DIST(8, 3, TRUE, 2)");

    model._set("B1", "=CHISQ.INV()");
    model._set("B2", "=CHISQ.INV(0)");
    model._set("B3", "=CHISQ.INV(A4, 3)");
    model._set("B4", "=CHISQ.INV(0, 1, 2)");

    model._set("C1", "=CHISQ.DIST.RT()");
    model._set("C2", "=CHISQ.DIST.RT(8)");
    model._set("C3", "=CHISQ.DIST.RT(8, 3)");
    model._set("C4", "=CHISQ.DIST.RT(8, 3, 2)");

    model._set("D1", "=CHISQ.INV.RT()");
    model._set("D2", "=CHISQ.INV.RT(0)");
    model._set("D3", "=CHISQ.INV.RT(C3, 3)");
    model._set("D4", "=CHISQ.INV.RT(0, 1, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
    assert_eq!(model._get_text("A3"), "#ERROR!");
    assert_eq!(model._get_text("A4"), "0.953988294");
    assert_eq!(model._get_text("A5"), "#ERROR!");

    assert_eq!(model._get_text("B1"), "#ERROR!");
    assert_eq!(model._get_text("B2"), "#ERROR!");
    assert_eq!(model._get_text("B3"), "8");
    assert_eq!(model._get_text("B4"), "#ERROR!");

    assert_eq!(model._get_text("C1"), "#ERROR!");
    assert_eq!(model._get_text("C2"), "#ERROR!");
    assert_eq!(model._get_text("C3"), "0.046011706");
    assert_eq!(model._get_text("C4"), "#ERROR!");

    assert_eq!(model._get_text("D1"), "#ERROR!");
    assert_eq!(model._get_text("D2"), "#ERROR!");
    assert_eq!(model._get_text("D3"), "8");
    assert_eq!(model._get_text("D4"), "#ERROR!");
}
