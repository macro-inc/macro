use crate::test::util::new_empty_model;

#[test]
fn test_datedif_yd_leap_year_edge_cases() {
    let mut model = new_empty_model();

    // 29 Feb 2020 → 28 Feb 2021   (should be 0 days)
    model._set("A1", "=DATEDIF(\"29/2/2020\", \"28/2/2021\", \"YD\")");

    // 29 Feb 2020 → 1 Mar 2021    (should be 1 day)
    model._set("A2", "=DATEDIF(\"29/2/2020\", \"2021-03-01\", \"YD\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A2"), *"1");
}

#[test]
fn test_datedif_md_month_end_edge_cases() {
    let mut model = new_empty_model();

    // 31 Jan 2021 → 28 Feb 2021 (non-leap) => 28
    model._set("B1", "=DATEDIF(\"31/1/2021\", \"28/2/2021\", \"MD\")");

    // 31 Jan 2020 → 29 Feb 2020 (leap) => 29
    model._set("B2", "=DATEDIF(\"31/1/2020\", \"29/2/2020\", \"MD\")");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"28");
    assert_eq!(model._get_text("B2"), *"29");
}
