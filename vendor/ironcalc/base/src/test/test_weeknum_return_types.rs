use crate::test::util::new_empty_model;

#[test]
fn test_weeknum_return_types_11_to_17_and_21() {
    let mut model = new_empty_model();

    // Date 44561 -> 2021-12-31 (Friday). Previously verified as week 53 (Sunday/Monday start).
    // We verify that custom week-start codes 11-17 all map to week 53 and ISO variant (21) maps to 52.
    let formulas = [
        ("A1", "=WEEKNUM(44561,11)"),
        ("A2", "=WEEKNUM(44561,12)"),
        ("A3", "=WEEKNUM(44561,13)"),
        ("A4", "=WEEKNUM(44561,14)"),
        ("A5", "=WEEKNUM(44561,15)"),
        ("A6", "=WEEKNUM(44561,16)"),
        ("A7", "=WEEKNUM(44561,17)"),
        ("A8", "=WEEKNUM(44561,21)"), // ISO week numbering
    ];
    for (cell, formula) in formulas {
        model._set(cell, formula);
    }

    model.evaluate();

    // All 11-17 variations should yield 53
    for cell in ["A1", "A2", "A3", "A4", "A5", "A6", "A7"] {
        assert_eq!(model._get_text(cell), *"53", "{cell} should be 53");
    }
    // ISO week (return_type 21)
    assert_eq!(model._get_text("A8"), *"52");
}
