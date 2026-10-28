#![allow(clippy::unwrap_used)]

use crate::{mock_time, test::util::new_empty_model};

// 14:44 20 Mar 2023 Berlin
const TIMESTAMP_2023: i64 = 1679319865208;

#[test]
fn arguments() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = new_empty_model();

    model._set("A1", "=NOW(1, 1)");
    model._set("A2", "=NOW(\"Europe/Berlin\")");
    model._set("A3", "=NOW(\"faketimezone\")");
    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        "#ERROR!",
        "Wrong number of arguments"
    );
    assert_eq!(model._get_text("A2"), *"3/20/2023, 2:44 PM");
    assert_eq!(
        model._get_text("A3"),
        "#VALUE!",
        "Invalid timezone: faketimezone"
    );
}

#[test]
fn returns_date_time() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = new_empty_model();
    model._set("A1", "=NOW()");
    model.evaluate();
    let text = model._get_text("A1");
    assert_eq!(text, *"3/20/2023, 1:44 PM");
}
