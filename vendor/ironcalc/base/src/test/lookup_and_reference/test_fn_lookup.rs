#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_lookup_range_vector_only() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("B1", "=LOOKUP(20,A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "20");
}

#[test]
fn test_lookup_range_with_result_vector() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C1", "a");
    model._set("C2", "b");
    model._set("C3", "c");
    model._set("B1", "=LOOKUP(20,A1:A3,C1:C3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "b");
}

#[test]
fn test_lookup_range_result_vector_different_orientation() {
    let mut model = new_empty_model();
    // lookup vector is a column, result vector is a row of the same length
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("C1", "a");
    model._set("D1", "b");
    model._set("E1", "c");
    model._set("B5", "=LOOKUP(30,A1:A3,C1:E1)");
    model.evaluate();
    assert_eq!(model._get_text("B5"), "c");
}

#[test]
fn test_lookup_array_vector_only() {
    let mut model = new_empty_model();
    model._set("A1", "=LOOKUP(20,{10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "20");
}

#[test]
fn test_lookup_array_with_result_array() {
    let mut model = new_empty_model();
    model._set("A1", r#"=LOOKUP(20,{10,20,30},{"a","b","c"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "b");
}

#[test]
fn test_lookup_array_column_vectors() {
    let mut model = new_empty_model();
    model._set("A1", r#"=LOOKUP(30,{10;20;30},{"a";"b";"c"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "c");
}

#[test]
fn test_lookup_array_largest_smaller() {
    let mut model = new_empty_model();
    // 25 is absent, returns the value matching the largest entry <= 25, i.e. 20 -> "b"
    model._set("A1", r#"=LOOKUP(25,{10,20,30},{"a","b","c"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "b");
}

#[test]
fn test_lookup_array_not_found() {
    let mut model = new_empty_model();
    model._set("A1", "=LOOKUP(5,{10,20,30})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#N/A");
}

#[test]
fn test_lookup_array_form_wide_searches_first_row() {
    let mut model = new_empty_model();
    // 2 rows x 3 columns: wider than tall, so search the first row for "b"
    // (index 1) and return from the last row at that index -> 2.
    model._set("A1", r#"=LOOKUP("b",{"a","b","c";1,2,3})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
}

#[test]
fn test_lookup_array_form_tall_searches_first_column() {
    let mut model = new_empty_model();
    // 3 rows x 2 columns: taller than wide, so search the first column for 20
    // (index 1) and return from the last column at that index -> "b".
    model._set("A1", r#"=LOOKUP(20,{10,"a";20,"b";30,"c"})"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "b");
}

#[test]
fn test_lookup_array_form_square_searches_first_column() {
    let mut model = new_empty_model();
    // 2x2 square: not wider than tall, so search first column [1;3] for 1
    // (index 0) and return from the last column at that row -> 2.
    model._set("A1", "=LOOKUP(1,{1,2;3,4})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
}

#[test]
fn test_lookup_array_form_range_wide() {
    let mut model = new_empty_model();
    // Same as the wide array-form case, but with a range reference.
    model._set("A1", "10");
    model._set("B1", "20");
    model._set("C1", "30");
    model._set("A2", "x");
    model._set("B2", "y");
    model._set("C2", "z");
    model._set("E1", "=LOOKUP(20,A1:C2)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "y");
}
