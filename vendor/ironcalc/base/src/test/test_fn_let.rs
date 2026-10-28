#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_let_wrong_arg_count() {
    let mut model = new_empty_model();
    // Too few args
    model._set("A1", "=LET(x,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");

    // Even number of args
    model._set("A2", "=LET(x,1,y,2)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), "#ERROR!");
}

#[test]
fn test_let_two_variables() {
    let mut model = new_empty_model();
    // LET(x, 2, y, 4, x+y) → 6
    model._set("A1", "=LET(x,2,y,4,x+y)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "6");
}

#[test]
fn test_let_with_cell_reference() {
    let mut model = new_empty_model();
    model._set("A1", "5");
    // LET(x, A1, SUM(x*3, x)) → SUM(15, 5) = 20
    model._set("B1", "=LET(x,A1,SUM(x*3,x))");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "20");
}

#[test]
fn test_let_nested() {
    let mut model = new_empty_model();
    // LET(x, 3, LET(x, 4, x*5)*x) → inner x=4: 4*5=20, outer x=3: 20*3=60
    model._set("A1", "=LET(x,3,LET(x,4,x*5)*x)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "60");
}

#[test]
fn test_let_inner_binding_references_outer_value() {
    let mut model = new_empty_model();
    // LET(x,1,LET(x,x+1,x)) → inner x is bound from outer x+1 = 2, result = 2
    model._set("A1", "=LET(x,1,LET(x,x+1,x))");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
}
#[test]
fn test_let_rebind_same_name_within_single_let() {
    let mut model = new_empty_model();
    model._set("A1", "=LET(x,1,x,2,x)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

#[test]
fn test_let_r_and_c_variables() {
    let mut model = new_empty_model();
    // r and c must work as LET variable names
    model._set("A1", "=LET(r,3,c,4,r+c)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "7");
}

#[test]
fn test_lambda_r_and_c_parameters() {
    let mut model = new_empty_model();
    // r and c must work as LAMBDA parameter names
    model._set("A1", "=LAMBDA(r,c,r+c)(3,4)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "7");
}
