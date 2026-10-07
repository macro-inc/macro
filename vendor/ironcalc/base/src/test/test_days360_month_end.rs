use crate::test::util::new_empty_model;

#[test]
fn test_days360_month_end_us() {
    let mut model = new_empty_model();

    // 31 Jan 2021 -> 28 Feb 2021 (non-leap). Excel's DAYS360 only adjusts the
    // end date when its day-of-month is 31, so 28 Feb is left untouched: the
    // start 31 -> 30 gives 30*(2-1) + (28-30) = 28. (Excel does NOT promote a
    // last-day-of-February end date to 30, despite the Microsoft docs.)
    model._set("A1", "=DAYS360(DATE(2021,1,31),DATE(2021,2,28))");

    // 31 Jan 2020 -> 28 Feb 2020 (leap year – not last day of Feb)
    model._set("A2", "=DAYS360(DATE(2020,1,31),DATE(2020,2,28))");

    // 28 Feb 2020 -> 31 Mar 2020 (leap year span crossing month ends)
    model._set("A3", "=DAYS360(DATE(2020,2,28),DATE(2020,3,31))");

    // 30 Apr 2021 -> 31 May 2021 (end-of-month adjustment rule)
    model._set("A4", "=DAYS360(DATE(2021,4,30),DATE(2021,5,31))");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"28");
    assert_eq!(model._get_text("A2"), *"28");
    assert_eq!(model._get_text("A3"), *"33");
    assert_eq!(model._get_text("A4"), *"30");
}

#[test]
fn test_days360_month_end_european() {
    let mut model = new_empty_model();

    // European basis = TRUE (or 1)
    model._set("B1", "=DAYS360(DATE(2021,1,31),DATE(2021,2,28),TRUE)");

    model._set("B2", "=DAYS360(DATE(2020,1,31),DATE(2020,2,29),TRUE)");

    model._set("B3", "=DAYS360(DATE(2021,8,31),DATE(2021,9,30),TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"28");
    assert_eq!(model._get_text("B2"), *"29");
    assert_eq!(model._get_text("B3"), *"30");
}
