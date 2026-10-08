#![allow(clippy::unwrap_used)]
use crate::types::Color;

// All tests use Excel date-formula expressions (TODAY(), DATE(), YEAR()) so that
// the cell values are always relative to "today" at evaluation time.  This makes
// every assertion deterministic regardless of when the tests run.

use crate::{
    cf_types::{CfRuleInput, PeriodType},
    test::util::new_empty_model,
};

fn period_rule(period: PeriodType) -> CfRuleInput {
    CfRuleInput::TimePeriod {
        time_period: period,
        date1: None,
        date2: None,
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn is_red(model: &crate::Model<'static>, row: i32) -> bool {
    model
        .get_extended_style_for_cell(0, row, 1)
        .unwrap()
        .style
        .fill
        .color
        == Color::Rgb("#FF0000".to_string())
}

// Sets a formula in A{row} and returns the model after evaluating it.
fn set_formula(model: &mut crate::Model<'static>, row: i32, formula: &str) {
    model
        .set_user_input(0, row, 1, formula.to_string())
        .unwrap();
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

#[test]
fn test_today_matches_only_today() {
    let mut model = new_empty_model();
    set_formula(&mut model, 1, "=TODAY()"); // today       → match
    set_formula(&mut model, 2, "=TODAY()-1"); // yesterday   → no match
    set_formula(&mut model, 3, "=TODAY()+1"); // tomorrow    → no match
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", period_rule(PeriodType::Today))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "today should match PeriodType::Today");
    assert!(
        !is_red(&model, 2),
        "yesterday should not match PeriodType::Today"
    );
    assert!(
        !is_red(&model, 3),
        "tomorrow should not match PeriodType::Today"
    );
}

// ---------------------------------------------------------------------------
// Yesterday
// ---------------------------------------------------------------------------

#[test]
fn test_yesterday_matches_only_yesterday() {
    let mut model = new_empty_model();
    set_formula(&mut model, 1, "=TODAY()-1"); // yesterday   → match
    set_formula(&mut model, 2, "=TODAY()"); // today       → no match
    set_formula(&mut model, 3, "=TODAY()-2"); // 2 days ago  → no match
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", period_rule(PeriodType::Yesterday))
        .unwrap();
    model.evaluate();

    assert!(
        is_red(&model, 1),
        "yesterday should match PeriodType::Yesterday"
    );
    assert!(
        !is_red(&model, 2),
        "today should not match PeriodType::Yesterday"
    );
    assert!(
        !is_red(&model, 3),
        "2 days ago should not match PeriodType::Yesterday"
    );
}

// ---------------------------------------------------------------------------
// Tomorrow
// ---------------------------------------------------------------------------

#[test]
fn test_tomorrow_matches_only_tomorrow() {
    let mut model = new_empty_model();
    set_formula(&mut model, 1, "=TODAY()+1"); // tomorrow    → match
    set_formula(&mut model, 2, "=TODAY()"); // today       → no match
    set_formula(&mut model, 3, "=TODAY()+2"); // day after   → no match
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A3", period_rule(PeriodType::Tomorrow))
        .unwrap();
    model.evaluate();

    assert!(
        is_red(&model, 1),
        "tomorrow should match PeriodType::Tomorrow"
    );
    assert!(
        !is_red(&model, 2),
        "today should not match PeriodType::Tomorrow"
    );
    assert!(
        !is_red(&model, 3),
        "day after tomorrow should not match PeriodType::Tomorrow"
    );
}

// ---------------------------------------------------------------------------
// Last7Days  [today-6, today]
// ---------------------------------------------------------------------------

#[test]
fn test_last_7_days_includes_endpoints() {
    let mut model = new_empty_model();
    set_formula(&mut model, 1, "=TODAY()"); // today (right endpoint)   → match
    set_formula(&mut model, 2, "=TODAY()-3"); // 3 days ago               → match
    set_formula(&mut model, 3, "=TODAY()-6"); // 6 days ago (left endpoint) → match
    set_formula(&mut model, 4, "=TODAY()-7"); // 7 days ago (outside)     → no match
    set_formula(&mut model, 5, "=TODAY()+1"); // tomorrow                 → no match
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::Last7Days))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "today is within last 7 days");
    assert!(is_red(&model, 2), "3 days ago is within last 7 days");
    assert!(
        is_red(&model, 3),
        "6 days ago is the left boundary of last 7 days"
    );
    assert!(!is_red(&model, 4), "7 days ago is outside last 7 days");
    assert!(!is_red(&model, 5), "tomorrow is outside last 7 days");
}

// ---------------------------------------------------------------------------
// Next7Days  [today, today+6]
// ---------------------------------------------------------------------------

#[test]
fn test_next_7_days_includes_endpoints() {
    let mut model = new_empty_model();
    set_formula(&mut model, 1, "=TODAY()"); // today (left endpoint)     → match
    set_formula(&mut model, 2, "=TODAY()+3"); // 3 days from now           → match
    set_formula(&mut model, 3, "=TODAY()+6"); // 6 days from now (right endpoint) → match
    set_formula(&mut model, 4, "=TODAY()+7"); // 7 days from now (outside) → no match
    set_formula(&mut model, 5, "=TODAY()-1"); // yesterday                 → no match
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::Next7Days))
        .unwrap();
    model.evaluate();

    assert!(
        is_red(&model, 1),
        "today is the left boundary of next 7 days"
    );
    assert!(is_red(&model, 2), "3 days from now is within next 7 days");
    assert!(
        is_red(&model, 3),
        "6 days from now is the right boundary of next 7 days"
    );
    assert!(!is_red(&model, 4), "7 days from now is outside next 7 days");
    assert!(!is_red(&model, 5), "yesterday is outside next 7 days");
}

// ---------------------------------------------------------------------------
// ThisYear  [Jan 1 this year, Dec 31 this year]
// ---------------------------------------------------------------------------

#[test]
fn test_this_year_includes_endpoints() {
    let mut model = new_empty_model();
    // Jan 1 of this year
    set_formula(&mut model, 1, "=DATE(YEAR(TODAY()),1,1)");
    // Mid-year
    set_formula(&mut model, 2, "=DATE(YEAR(TODAY()),6,15)");
    // Dec 31 of this year
    set_formula(&mut model, 3, "=DATE(YEAR(TODAY()),12,31)");
    // Dec 31 of last year (outside)
    set_formula(&mut model, 4, "=DATE(YEAR(TODAY())-1,12,31)");
    // Jan 1 of next year (outside)
    set_formula(&mut model, 5, "=DATE(YEAR(TODAY())+1,1,1)");
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::ThisYear))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "Jan 1 this year should match ThisYear");
    assert!(is_red(&model, 2), "mid-year date should match ThisYear");
    assert!(is_red(&model, 3), "Dec 31 this year should match ThisYear");
    assert!(
        !is_red(&model, 4),
        "Dec 31 last year should not match ThisYear"
    );
    assert!(
        !is_red(&model, 5),
        "Jan 1 next year should not match ThisYear"
    );
}

// ---------------------------------------------------------------------------
// LastYear  [Jan 1 last year, Dec 31 last year]
// ---------------------------------------------------------------------------

#[test]
fn test_last_year_includes_endpoints() {
    let mut model = new_empty_model();
    // Jan 1 of last year
    set_formula(&mut model, 1, "=DATE(YEAR(TODAY())-1,1,1)");
    // Mid last year
    set_formula(&mut model, 2, "=DATE(YEAR(TODAY())-1,6,15)");
    // Dec 31 of last year
    set_formula(&mut model, 3, "=DATE(YEAR(TODAY())-1,12,31)");
    // Dec 31 two years ago (outside)
    set_formula(&mut model, 4, "=DATE(YEAR(TODAY())-2,12,31)");
    // Jan 1 this year (outside)
    set_formula(&mut model, 5, "=DATE(YEAR(TODAY()),1,1)");
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::LastYear))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "Jan 1 last year should match LastYear");
    assert!(is_red(&model, 2), "mid last year should match LastYear");
    assert!(is_red(&model, 3), "Dec 31 last year should match LastYear");
    assert!(
        !is_red(&model, 4),
        "two years ago should not match LastYear"
    );
    assert!(
        !is_red(&model, 5),
        "Jan 1 this year should not match LastYear"
    );
}

// ---------------------------------------------------------------------------
// NextYear  [Jan 1 next year, Dec 31 next year]
// ---------------------------------------------------------------------------

#[test]
fn test_next_year_includes_endpoints() {
    let mut model = new_empty_model();
    // Jan 1 of next year
    set_formula(&mut model, 1, "=DATE(YEAR(TODAY())+1,1,1)");
    // Mid next year
    set_formula(&mut model, 2, "=DATE(YEAR(TODAY())+1,6,15)");
    // Dec 31 of next year
    set_formula(&mut model, 3, "=DATE(YEAR(TODAY())+1,12,31)");
    // Dec 31 this year (outside)
    set_formula(&mut model, 4, "=DATE(YEAR(TODAY()),12,31)");
    // Jan 1 two years from now (outside)
    set_formula(&mut model, 5, "=DATE(YEAR(TODAY())+2,1,1)");
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::NextYear))
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "Jan 1 next year should match NextYear");
    assert!(is_red(&model, 2), "mid next year should match NextYear");
    assert!(is_red(&model, 3), "Dec 31 next year should match NextYear");
    assert!(
        !is_red(&model, 4),
        "Dec 31 this year should not match NextYear"
    );
    assert!(
        !is_red(&model, 5),
        "two years from now should not match NextYear"
    );
}

// ---------------------------------------------------------------------------
// Between / NotBetween  [date1, date2] (issue #1221)
// ---------------------------------------------------------------------------

// The dates below are fixed, so assertions are deterministic:
// DATE(2025,4,25) = 45772 and DATE(2025,4,30) = 45777.

fn between_rule(period: PeriodType, date1: &str, date2: &str) -> CfRuleInput {
    CfRuleInput::TimePeriod {
        time_period: period,
        date1: Some(date1.to_string()),
        date2: Some(date2.to_string()),
        format: super::red_fill(),
        stop_if_true: false,
    }
}

fn set_between_test_dates(model: &mut crate::Model<'static>) {
    set_formula(model, 1, "=DATE(2025,4,23)"); // before the interval
    set_formula(model, 2, "=DATE(2025,4,25)"); // left endpoint
    set_formula(model, 3, "=DATE(2025,4,27)"); // inside
    set_formula(model, 4, "=DATE(2025,4,30)"); // right endpoint
    set_formula(model, 5, "=DATE(2025,5,2)"); // after the interval
    model.evaluate();
}

fn assert_between_highlights(model: &crate::Model<'static>, negated: bool) {
    for (row, inside) in [(1, false), (2, true), (3, true), (4, true), (5, false)] {
        assert_eq!(
            is_red(model, row),
            inside != negated,
            "row {row} (inside interval: {inside})"
        );
    }
}

#[test]
fn test_between_iso_dates() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::Between, "2025-04-25", "2025-04-30"),
        )
        .unwrap();
    model.evaluate();

    assert_between_highlights(&model, false);
}

#[test]
fn test_not_between_iso_dates() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::NotBetween, "2025-04-25", "2025-04-30"),
        )
        .unwrap();
    model.evaluate();

    assert_between_highlights(&model, true);
}

#[test]
fn test_between_serial_numbers() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::Between, "45772", "45777"),
        )
        .unwrap();
    model.evaluate();

    assert_between_highlights(&model, false);
}

#[test]
fn test_between_locale_dates() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::Between, "4/25/2025", "4/30/2025"),
        )
        .unwrap();
    model.evaluate();

    assert_between_highlights(&model, false);
}

#[test]
fn test_between_reversed_bounds() {
    // Bounds given in the "wrong" order behave the same as the right order,
    // matching the CellIs Between behavior.
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::Between, "2025-04-30", "2025-04-25"),
        )
        .unwrap();
    model.evaluate();

    assert_between_highlights(&model, false);
}

#[test]
fn test_between_ignores_time_component() {
    let mut model = new_empty_model();
    // Noon on the left endpoint day: the date part is inside the interval.
    set_formula(&mut model, 1, "=DATE(2025,4,25)+0.5");
    model.evaluate();
    model
        .add_conditional_formatting(
            0,
            "A1",
            between_rule(PeriodType::Between, "2025-04-25", "2025-04-30"),
        )
        .unwrap();
    model.evaluate();

    assert!(is_red(&model, 1), "time of day should be ignored");
}

#[test]
fn test_between_missing_dates_highlights_nothing() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(0, "A1:A5", period_rule(PeriodType::Between))
        .unwrap();
    model.evaluate();

    for row in 1..=5 {
        assert!(!is_red(&model, row), "row {row} should not be highlighted");
    }
}

#[test]
fn test_between_invalid_dates_highlight_nothing() {
    let mut model = new_empty_model();
    set_between_test_dates(&mut model);
    model
        .add_conditional_formatting(
            0,
            "A1:A5",
            between_rule(PeriodType::Between, "not a date", "2025-04-30"),
        )
        .unwrap();
    model.evaluate();

    for row in 1..=5 {
        assert!(!is_red(&model, row), "row {row} should not be highlighted");
    }
}

// ---------------------------------------------------------------------------
// Non-date numbers are not matched
// ---------------------------------------------------------------------------

#[test]
fn test_today_does_not_match_arbitrary_numbers() {
    // A number like 42 is not a date that could equal today's serial.
    let mut model = new_empty_model();
    model.set_user_input(0, 1, 1, "42".to_string()).unwrap();
    model.evaluate();
    model
        .add_conditional_formatting(0, "A1", period_rule(PeriodType::Today))
        .unwrap();
    model.evaluate();

    assert!(
        !is_red(&model, 1),
        "an arbitrary number should not match Today"
    );
}
