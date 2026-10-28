#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// Excel date-format tokens are case-insensitive: M/D/YYYY behaves like
// m/d/yyyy, including the month-vs-minute disambiguation.
#[test]
fn test_text_uppercase_date_tokens() {
    let mut model = new_empty_model();
    model._set("A1", r#"=TEXT(45000,"m/d/yyyy")"#);
    model._set("A2", r#"=TEXT(45000,"M/D/YYYY")"#);
    model._set("A3", r#"=TEXT(45000,"MM/DD/YYYY")"#);
    model._set("A4", r#"=TEXT(45000,"YYYY")"#);
    model._set("A5", r#"=TEXT(45000,"MMM")"#);
    model._set("A6", r#"=TEXT(45000,"D")"#);
    model._set("A7", r#"=TEXT(45000,"MMM-YY")"#);
    model._set("B3", r#"=TEXT(45000,"mm/dd/yyyy")"#);
    model._set("B4", r#"=TEXT(45000,"yyyy")"#);
    model._set("B5", r#"=TEXT(45000,"mmm")"#);
    model._set("B6", r#"=TEXT(45000,"d")"#);
    model._set("B7", r#"=TEXT(45000,"mmm-yy")"#);
    model.evaluate();
    let lower = model._get_text("A1");
    assert_eq!(model._get_text("A2"), lower);
    assert!(!model._get_text("A3").starts_with('#'));
    assert_eq!(model._get_text("A4"), "2023");
    assert_eq!(model._get_text("A5"), "Mar");
    assert_eq!(model._get_text("A6"), "15");
    assert_eq!(model._get_text("A7"), "Mar-23");
    // Each upper-case format must match its lower-case counterpart.
    assert_eq!(model._get_text("B3"), model._get_text("A3"));
    assert_eq!(model._get_text("B4"), model._get_text("A4"));
    assert_eq!(model._get_text("B5"), model._get_text("A5"));
    assert_eq!(model._get_text("B6"), model._get_text("A6"));
    assert_eq!(model._get_text("B7"), model._get_text("A7"));
}

#[test]
fn test_text_uppercase_minutes_disambiguation() {
    let mut model = new_empty_model();
    model._set("A1", r#"=TEXT(45000.526,"hh:mm:ss")"#);
    model._set("A2", r#"=TEXT(45000.526,"hh:MM:SS")"#);
    model._set("A3", r#"=TEXT(45000.526,"MM/DD/YYYY hh:MM:SS")"#);
    model.evaluate();
    let lower = model._get_text("A1");
    assert_eq!(model._get_text("A2"), lower);
    let combined = model._get_text("A3");
    assert!(combined.ends_with(&lower), "got {combined}");
}
