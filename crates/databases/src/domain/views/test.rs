use super::*;

fn filter(value: &str) -> ViewFilter {
    ViewFilter {
        column_id: Uuid::now_v7(),
        operator: FilterOperator::Equals,
        value: value.into(),
    }
}

#[test]
fn checkbox_filters_use_the_numeric_spelling_the_grid_compares() {
    for (input, expected) in [("true", "1"), ("FALSE", "0"), ("1", "1"), ("0", "0")] {
        assert_eq!(
            filter_value(DataType::Boolean, &filter(input)).unwrap(),
            expected
        );
    }
    assert!(filter_value(DataType::Boolean, &filter("checked")).is_err());
}

#[test]
fn invalid_numeric_and_empty_filter_values_cannot_silently_disable_a_filter() {
    for value in ["abc", "NaN", "inf", "-inf", "", " "] {
        assert!(
            filter_value(DataType::Number, &filter(value)).is_err(),
            "{value}"
        );
    }
    assert_eq!(
        filter_value(DataType::Number, &filter("12.5")).unwrap(),
        "12.5"
    );
    let mut empty = filter("");
    empty.operator = FilterOperator::IsEmpty;
    assert_eq!(filter_value(DataType::Number, &empty).unwrap(), "");
}

#[test]
fn date_filters_use_valid_calendar_days_without_truncating_invalid_text() {
    assert_eq!(
        filter_value(DataType::Date, &filter("2026-09-19T10:00:00Z")).unwrap(),
        "2026-09-19"
    );
    assert!(filter_value(DataType::Date, &filter("2026-02-30")).is_err());
    assert!(filter_value(DataType::Date, &filter("tomorrow")).is_err());
}
