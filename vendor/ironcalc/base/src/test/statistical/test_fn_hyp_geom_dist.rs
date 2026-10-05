#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_hyp_geom_dist_smoke() {
    let mut model = new_empty_model();

    // Valid: PDF (non-cumulative)
    model._set("A1", "=HYPGEOM.DIST(1, 4, 12, 20, FALSE)");

    // Valid: CDF (cumulative)
    model._set("A2", "=HYPGEOM.DIST(1, 4, 12, 20, TRUE)");

    // Wrong number of arguments -> #ERROR!
    model._set("A3", "=HYPGEOM.DIST(1, 4, 12, 20)");
    model._set("A4", "=HYPGEOM.DIST(1, 4, 12, 20, TRUE, FALSE)");

    // Domain errors:
    // sample_s > number_sample -> #NUM!
    model._set("A5", "=HYPGEOM.DIST(5, 4, 12, 20, TRUE)");

    // population_s > number_pop -> #NUM!
    model._set("A6", "=HYPGEOM.DIST(1, 4, 25, 20, TRUE)");

    // number_sample > number_pop -> #NUM!
    model._set("A7", "=HYPGEOM.DIST(1, 25, 12, 20, TRUE)");

    model.evaluate();

    // PDF: P(X = 1)
    assert_eq!(model._get_text("A1"), *"0.13869969");

    // CDF: P(X <= 1)
    assert_eq!(model._get_text("A2"), *"0.153147575");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#NUM!");
}
