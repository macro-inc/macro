use super::*;

#[test]
fn a_hex_color_is_kept_lowercase() {
    assert_eq!(CalendarColor::parse("#5C8AEE").unwrap().as_str(), "#5c8aee");
}

#[test]
fn anything_but_six_hex_digits_is_refused() {
    for value in ["5c8aee", "#5c8ae", "#5c8aeef", "#5c8aeg", "#fff", "", "#"] {
        assert_eq!(
            CalendarColor::parse(value),
            Err(InvalidCalendarColor),
            "{value}"
        );
    }
}
