#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn simple_evaluation() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(x, y, x + y)(1, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
}

#[test]
fn evaluation_in_let() {
    let mut model = new_empty_model();
    model._set("A1", "=LET(x, 1, y, LAMBDA(a, b, a + b), y(x, 22))");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"23");
}

#[test]
fn evaluation_with_defined_name() {
    let mut model = new_empty_model();
    model
        .new_defined_name("MySum", None, "=LAMBDA(x, y, x + y)")
        .unwrap();
    model._set("A1", "=MySum(1, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"3");
}

// Regression: a defined-name LAMBDA that returns an array must spill.
// Calling it (a `NamedFunctionKind`) was statically classified as a scalar,
// so the cell was never marked dynamic and the array result reached a
// scalar context instead of spilling.
#[test]
fn defined_name_lambda_spills_array() {
    let mut model = new_empty_model();
    model
        .new_defined_name("MySeq", None, "=LAMBDA(n, SEQUENCE(n))")
        .unwrap();
    model._set("A1", "=MySeq(3)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"2");
    assert_eq!(model._get_text("A3"), *"3");
}

#[test]
fn wrong_number_of_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(x, y, x + y)(1)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
}

#[test]
fn returns_calculation_error() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(x, y, x + y)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#CALC!");
}

#[test]
fn sheet_local_name_takes_precedence_over_global() {
    // Global MyFn = LAMBDA(x, x * 2)
    // Sheet2-local MyFn = LAMBDA(x, x * 3)
    // Sheet1!A1 calls MyFn(5) => uses global => 10
    // Sheet2!A1 calls MyFn(5) => uses local  => 15
    let mut model = new_empty_model();
    model.new_sheet(); // adds Sheet2 at index 1

    model
        .new_defined_name("MyFn", None, "=LAMBDA(x, x * 2)")
        .unwrap();
    model
        .new_defined_name("MyFn", Some(1), "=LAMBDA(x, x * 3)")
        .unwrap();

    model._set("A1", "=MyFn(5)");
    model._set("Sheet2!A1", "=MyFn(5)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"10");
    assert_eq!(model._get_text("Sheet2!A1"), *"15");
}

#[test]
fn let_bound_variable_captured_in_lambda_body() {
    let mut model = new_empty_model();
    // `a` is bound by LET; the LAMBDA body references `a` as a closure variable.
    // f(2) should return 2 + 1 = 3.
    model._set("A1", "=LET(a, 1, f, LAMBDA(x, x + a), f(2))");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"3");
}

#[test]
fn optional_parameter_omitted() {
    let mut model = new_empty_model();
    // b is optional; calling with one arg should use default (a/2 = 6).
    model._set("A1", "=LAMBDA(a, [b], IF(ISOMITTED(b), a/2, a*b))(12)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"6");
}

#[test]
fn optional_parameter_provided() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], IF(ISOMITTED(b), a/2, a*b))(12, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"36");
}

#[test]
fn optional_parameter_too_many_args_is_error() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], a+1)(1, 2, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#VALUE!");
}

#[test]
fn required_arg_missing_is_error() {
    let mut model = new_empty_model();
    // `a` is required; calling with no args is an error.
    model._set("A1", "=LAMBDA(a, [b], a+1)()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#VALUE!");
}

// A reference given to a LAMBDA, or bound by a LET, stays a reference, also
// when it is a single cell. Where a value is wanted it is the cell's value.
#[test]
fn a_single_cell_is_passed_as_a_reference() {
    let mut model = new_empty_model();
    model._set("A1", "text");
    model._set("A2", "7");
    model._set("B5", "3");
    model._set("C1", "=LAMBDA(x, MAX(x))(A1)");
    model._set("C2", "=LAMBDA(x, MAX(x))(A2)");
    model._set("C3", "=LAMBDA(x, ROW(x))(B5)");
    model._set("C4", "=LAMBDA(x, COLUMN(x))(B5)");
    model._set("C5", "=LAMBDA(x, OFFSET(x, 1, 0))(A1)");
    model._set("C6", "=LAMBDA(x, ROWS(x))(B5)");
    model._set("C9", "=LET(x, A1, MAX(x))");
    model._set("C10", "=LET(x, B5, ROW(x))");
    model._set("C11", "=LET(x, A2, y, B5, OFFSET(x, 0, 0)+y)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"0");
    assert_eq!(model._get_text("C2"), *"7");
    assert_eq!(model._get_text("C3"), *"5");
    assert_eq!(model._get_text("C4"), *"2");
    assert_eq!(model._get_text("C5"), *"7");
    assert_eq!(model._get_text("C6"), *"1");
    assert_eq!(model._get_text("C9"), *"0");
    assert_eq!(model._get_text("C10"), *"5");
    assert_eq!(model._get_text("C11"), *"10");
}

#[test]
fn a_single_cell_parameter_is_a_value_where_a_value_is_wanted() {
    let mut model = new_empty_model();
    model._set("A1", "text");
    model._set("A2", "7");
    model._set("C1", "=LAMBDA(x, x)(A1)");
    model._set("C2", "=LAMBDA(x, x)(A2)");
    model._set("C3", "=LAMBDA(x, x&\"!\")(A1)");
    model._set("C4", "=LAMBDA(x, x+1)(A2)");
    model._set("C5", "=LAMBDA(x, IF(x=\"text\", 1, 2))(A1)");
    model._set("C6", "=LAMBDA(x, ISBLANK(x))(A3)");
    model._set("C7", "=LAMBDA(x, ISTEXT(x))(A1)");
    model._set("C8", "=LAMBDA(x, LEN(x))(A1)");
    model._set("C9", "=LET(x, A2, x*2)");
    model._set("C10", "=LAMBDA(x, TYPE(x))(A2)");
    model.evaluate();

    assert_eq!(model._get_text("C1"), *"text");
    assert_eq!(model._get_text("C2"), *"7");
    assert_eq!(model._get_text("C3"), *"text!");
    assert_eq!(model._get_text("C4"), *"8");
    assert_eq!(model._get_text("C5"), *"1");
    assert_eq!(model._get_text("C6"), *"TRUE");
    assert_eq!(model._get_text("C7"), *"TRUE");
    assert_eq!(model._get_text("C8"), *"4");
    assert_eq!(model._get_text("C9"), *"14");
    assert_eq!(model._get_text("C10"), *"1");
    // Nothing spills from a single cell
    assert_eq!(model._get_text("D1"), *"");
    assert_eq!(model._get_text("C11"), *"");
}

// A defined name that stands for a cell is a reference wherever one is
// wanted, and the cell's value wherever a value is wanted
#[test]
fn a_defined_name_for_a_single_cell_is_a_reference() {
    let mut model = new_empty_model();
    model._set("K1", "text");
    model._set("K2", "7");
    model
        .new_defined_name("TextCell", None, "Sheet1!$K$1")
        .unwrap();
    model
        .new_defined_name("Later", None, "=LAMBDA(x, x+1)")
        .unwrap();
    model._set("A1", "=ROW(TextCell)");
    model._set("A2", "=COLUMN(TextCell)");
    model._set("A3", "=OFFSET(TextCell, 1, 0)");
    model._set("A4", "=ROWS(TextCell)");
    model._set("A5", "=TextCell&\"!\"");
    model._set("A6", "=LEN(TextCell)");
    model._set("A7", "=IF(TextCell=\"text\", 1, 2)");
    model._set("A8", "=TextCell");
    model._set("A9", "=Later(1)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"11");
    assert_eq!(model._get_text("A3"), *"7");
    assert_eq!(model._get_text("A4"), *"1");
    assert_eq!(model._get_text("A5"), *"text!");
    assert_eq!(model._get_text("A6"), *"4");
    assert_eq!(model._get_text("A7"), *"1");
    assert_eq!(model._get_text("A8"), *"text");
    assert_eq!(model._get_text("A9"), *"2");
}
