#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn references_and_values() {
    let mut model = new_empty_model();
    model._set("K1", "text");
    model._set("K2", "7");
    model._set("A1", "=ISREF(K1)");
    model._set("A2", "=ISREF(K1:K2)");
    model._set("A3", "=ISREF(K:K)");
    model._set("A4", "=ISREF(OFFSET(K1, 1, 0))");
    model._set("A5", "=ISREF(INDIRECT(\"K1\"))");
    model._set("A6", "=ISREF(5)");
    // INDEX gives a reference when what it indexes is one
    model._set("A13", "=ISREF(INDEX(K1:K2, 1))");
    model._set("A14", "=ISREF(INDEX({1,2}, 1))");
    model._set("A15", "=ISREF(INDEX(K1:K2, 1, 1))");
    model._set("A16", "=ISREF(INDEX(K1:K2, 0))");
    model._set("A17", "=ISREF(INDEX(OFFSET(K1, 0, 0, 2, 1), 2))");
    model._set("A18", "=ISREF(INDEX(SEQUENCE(2), 1))");
    // Not when INDEX fails
    model._set("A19", "=ISREF(INDEX(K1:K2, 3))");
    model._set("A20", "=ISREF(INDEX(K1, 1, 2, 2))");
    model._set("A7", "=ISREF(\"K1\")");
    model._set("A8", "=ISREF(TRUE)");
    model._set("A9", "=ISREF(K1+1)");
    model._set("A10", "=ISREF({1,2})");
    model._set("A11", "=ISREF(NA())");
    model._set("A12", "=ISREF(SUM(K1:K2))");
    model.evaluate();

    for (cell, expected) in [
        ("A1", "TRUE"),
        ("A2", "TRUE"),
        ("A3", "TRUE"),
        ("A4", "TRUE"),
        ("A5", "TRUE"),
        ("A6", "FALSE"),
        ("A7", "FALSE"),
        ("A8", "FALSE"),
        ("A9", "FALSE"),
        ("A10", "FALSE"),
        ("A11", "FALSE"),
        ("A12", "FALSE"),
        ("A13", "TRUE"),
        ("A14", "FALSE"),
        ("A15", "TRUE"),
        ("A16", "TRUE"),
        ("A17", "TRUE"),
        ("A18", "FALSE"),
        ("A19", "FALSE"),
        ("A20", "FALSE"),
    ] {
        assert_eq!(model._get_text(cell), expected, "{cell}");
    }
}

// A defined name, a LAMBDA parameter or a LET variable is a reference if
// what it stands for is one
#[test]
fn defined_names_and_variables() {
    let mut model = new_empty_model();
    model._set("K1", "text");
    model._set("K2", "7");
    model
        .new_defined_name("TextCell", None, "Sheet1!$K$1")
        .unwrap();
    model
        .new_defined_name("Cells", None, "Sheet1!$K$1:$K$2")
        .unwrap();
    model
        .new_defined_name("Twice", None, "=LAMBDA(x, 2*x)")
        .unwrap();
    model._set("A1", "=ISREF(TextCell)");
    model._set("A2", "=ISREF(Cells)");
    model._set("A3", "=ISREF(Twice)");
    model._set("A4", "=ISREF(NoSuchName)");
    model._set("A5", "=LAMBDA(x, ISREF(x))(K1)");
    model._set("A6", "=LAMBDA(x, ISREF(x))(K1:K2)");
    model._set("A7", "=LAMBDA(x, ISREF(x))(5)");
    model._set("A8", "=LAMBDA(x, ISREF(x))(K1+1)");
    model._set("A9", "=LET(x, K1, ISREF(x))");
    model._set("A10", "=LET(x, K1:K2, ISREF(x))");
    model._set("A11", "=LET(x, \"K1\", ISREF(x))");
    model._set("A12", "=LET(x, TextCell, ISREF(x))");
    model.evaluate();

    for (cell, expected) in [
        ("A1", "TRUE"),
        ("A2", "TRUE"),
        ("A3", "FALSE"),
        ("A4", "FALSE"),
        ("A5", "TRUE"),
        ("A6", "TRUE"),
        ("A7", "FALSE"),
        ("A8", "FALSE"),
        ("A9", "TRUE"),
        ("A10", "TRUE"),
        ("A11", "FALSE"),
        ("A12", "TRUE"),
    ] {
        assert_eq!(model._get_text(cell), expected, "{cell}");
    }
}

#[test]
fn wrong_number_of_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=ISREF()");
    model._set("A2", "=ISREF(K1, K2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}
