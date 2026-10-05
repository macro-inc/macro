#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// Test data: Jan 1-10, 2023 week
const JAN_1_2023: i32 = 44927; // Sunday
const JAN_2_2023: i32 = 44928; // Monday
const JAN_6_2023: i32 = 44932; // Friday
const JAN_9_2023: i32 = 44935; // Monday
const JAN_10_2023: i32 = 44936; // Tuesday

#[test]
fn networkdays_calculates_weekdays_excluding_weekends() {
    let mut model = new_empty_model();

    model._set("A1", &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023})"));
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "7",
        "Should count 7 weekdays in 10-day span"
    );
}

#[test]
fn networkdays_handles_reverse_date_order() {
    let mut model = new_empty_model();

    model._set("A1", &format!("=NETWORKDAYS({JAN_10_2023},{JAN_1_2023})"));
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "-7",
        "Reversed dates should return negative count"
    );
}

#[test]
fn networkdays_excludes_holidays_from_weekdays() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},{JAN_9_2023})"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "6",
        "Should exclude Monday holiday from 7 weekdays"
    );
}

#[test]
fn networkdays_handles_same_start_end_date() {
    let mut model = new_empty_model();

    model._set("A1", &format!("=NETWORKDAYS({JAN_9_2023},{JAN_9_2023})"));
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "1",
        "Same weekday date should count as 1 workday"
    );
}

#[test]
fn networkdays_accepts_holiday_ranges() {
    let mut model = new_empty_model();

    model._set("B1", &JAN_2_2023.to_string());
    model._set("B2", &JAN_6_2023.to_string());
    model._set(
        "A1",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},B1:B2)"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "5",
        "Should exclude 2 holidays from 7 weekdays"
    );
}

#[test]
fn networkdays_intl_uses_standard_weekend_by_default() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023})"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "7",
        "Default should be Saturday-Sunday weekend"
    );
}

#[test]
fn networkdays_intl_supports_numeric_weekend_patterns() {
    let mut model = new_empty_model();

    // Pattern 2 = Sunday-Monday weekend
    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023},2)"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "6",
        "Sunday-Monday weekend should give 6 workdays"
    );
}

#[test]
fn networkdays_intl_supports_single_day_weekends() {
    let mut model = new_empty_model();

    // Pattern 11 = Sunday only weekend
    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023},11)"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "8",
        "Sunday-only weekend should give 8 workdays"
    );
}

#[test]
fn networkdays_intl_supports_string_weekend_patterns() {
    let mut model = new_empty_model();

    // "0000110" = Friday-Saturday weekend
    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023},\"0000110\")"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "8",
        "Friday-Saturday weekend should give 8 workdays"
    );
}

#[test]
fn networkdays_intl_no_weekends_counts_all_days() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023},\"0000000\")"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "10",
        "No weekends should count all 10 days"
    );
}

#[test]
fn networkdays_intl_combines_custom_weekends_with_holidays() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        &format!("=NETWORKDAYS.INTL({JAN_1_2023},{JAN_10_2023},\"0000110\",{JAN_9_2023})"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "7",
        "Should exclude both weekend and holiday"
    );
}

#[test]
fn networkdays_validates_argument_count() {
    let mut model = new_empty_model();

    model._set("A1", "=NETWORKDAYS()");
    model._set("A2", "=NETWORKDAYS(1,2,3,4)");
    model._set("A3", "=NETWORKDAYS.INTL()");
    model._set("A4", "=NETWORKDAYS.INTL(1,2,3,4,5)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
    assert_eq!(model._get_text("A3"), "#ERROR!");
    assert_eq!(model._get_text("A4"), "#ERROR!");
}

#[test]
fn networkdays_rejects_invalid_dates() {
    let mut model = new_empty_model();

    model._set("A1", "=NETWORKDAYS(-1,100)");
    model._set("A2", "=NETWORKDAYS(1,3000000)");
    model._set("A3", "=NETWORKDAYS(\"text\",100)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "#NUM!");
    assert_eq!(model._get_text("A2"), "#NUM!");
    assert_eq!(model._get_text("A3"), "#VALUE!");
}

#[test]
fn networkdays_intl_rejects_invalid_weekend_patterns() {
    let mut model = new_empty_model();

    model._set("A1", "=NETWORKDAYS.INTL(1,10,99)");
    model._set("A2", "=NETWORKDAYS.INTL(1,10,\"111110\")");
    model._set("A3", "=NETWORKDAYS.INTL(1,10,\"11111000\")");
    model._set("A4", "=NETWORKDAYS.INTL(1,10,\"1111102\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "#NUM!");
    assert_eq!(model._get_text("A2"), "#VALUE!");
    assert_eq!(model._get_text("A3"), "#VALUE!");
    assert_eq!(model._get_text("A4"), "#VALUE!");
}

#[test]
fn networkdays_rejects_invalid_holidays() {
    let mut model = new_empty_model();

    model._set("B1", "invalid");
    model._set(
        "A1",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},B1)"),
    );
    model._set(
        "A2",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},-1)"),
    );

    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "#VALUE!",
        "Should reject non-numeric holidays"
    );
    assert_eq!(
        model._get_text("A2"),
        "#NUM!",
        "Should reject out-of-range holidays"
    );
}

#[test]
fn networkdays_handles_weekend_only_periods() {
    let mut model = new_empty_model();

    let saturday = JAN_1_2023 - 1;
    model._set("A1", &format!("=NETWORKDAYS({saturday},{JAN_1_2023})"));
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "0",
        "Weekend-only period should count 0 workdays"
    );
}

#[test]
fn networkdays_ignores_holidays_outside_date_range() {
    let mut model = new_empty_model();

    let future_holiday = JAN_10_2023 + 100;
    model._set(
        "A1",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},{future_holiday})"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "7",
        "Out-of-range holidays should be ignored"
    );
}

#[test]
fn networkdays_handles_empty_holiday_ranges() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        &format!("=NETWORKDAYS({JAN_1_2023},{JAN_10_2023},B1:B3)"),
    );
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "7",
        "Empty holiday range should be treated as no holidays"
    );
}

#[test]
fn networkdays_handles_minimum_valid_dates() {
    let mut model = new_empty_model();

    model._set("A1", "=NETWORKDAYS(1,7)");
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "5",
        "Should handle earliest Excel dates correctly"
    );
}

#[test]
fn networkdays_handles_large_date_ranges_efficiently() {
    let mut model = new_empty_model();

    model._set("A1", "=NETWORKDAYS(1,365)");
    model.evaluate();

    assert!(
        !model._get_text("A1").starts_with('#'),
        "Large ranges should not error"
    );
}
