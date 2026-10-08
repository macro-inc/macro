#![allow(clippy::unwrap_used)]

use crate::mock_time;
use crate::model::Model;
use crate::test::util::new_empty_model;

// 14:44 20 Mar 2023 Berlin
const TIMESTAMP_2023: i64 = 1679319865208;

#[test]
fn today_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=TODAY()");
    model._set("A2", "=TEXT(A1, \"yyyy/m/d\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"11/8/2022");
    assert_eq!(model._get_text("A2"), *"2022/11/8");
}

#[test]
fn today_now_wrong_arguments() {
    let mut model = new_empty_model();
    // 1 is an invalid timezone, it returns #VALUE!
    model._set("A1", "=TODAY(1)");
    model._set("A2", "=NOW(1)");

    model._set("A3", "=TODAY(1, 2)");
    model._set("A4", "=NOW(1, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
    assert_eq!(model._get_text("A2"), *"#VALUE!");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

#[test]
fn today_with_wrong_tz() {
    let model = Model::new_empty("model", "en", "Wrong Timezone", "en");
    assert!(model.is_err());
}

#[test]
fn now_basic_utc() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();
    model._set("A1", "=TODAY()");
    model._set("A2", "=NOW()");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3/20/2023");
    // 45005.572511574
    assert_eq!(model._get_text("A2"), *"3/20/2023, 1:44 PM");
}

#[test]
fn now_basic_europe_berlin() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = Model::new_empty("model", "en", "Europe/Berlin", "en").unwrap();
    model._set("A1", "=TODAY()");
    model._set("A2", "=NOW()");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3/20/2023");
    // This is UTC + 1 hour: 45005.572511574 + 1/24
    assert_eq!(model._get_text("A2"), *"3/20/2023, 2:44 PM");
}

#[test]
fn today_with_timezone() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();
    model._set("A1", "=TODAY(\"Pacific/Kiritimati\")");
    model._set("A2", "=NOW(\"Europe/Berlin\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3/21/2023");
    // 45005.572511574
    assert_eq!(model._get_text("A2"), *"3/20/2023, 2:44 PM");
    model.evaluate();
}

#[test]
fn today_with_invalid_timezone() {
    mock_time::set_mock_time(TIMESTAMP_2023);
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();
    model._set("A1", "=TODAY(\"Invalid/Timezone\")");
    model._set("A2", "=NOW(\"Invalid/Timezone\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
    assert_eq!(model._get_text("A2"), *"#VALUE!");
}
