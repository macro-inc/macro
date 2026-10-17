use super::*;
use crate::expr::Statement;
use crate::parse::parse_statement;

fn eval_rhs(src: &str, x: f64) -> f64 {
    let Statement::Relation { right, .. } = parse_statement(src).unwrap() else {
        panic!("{src}");
    };
    let mut env = Env::default();
    env.set("x", x);
    env.eval(&right).unwrap()
}

#[test]
fn evaluates_trig_and_power() {
    assert!((eval_rhs("y=x^2", 3.0) - 9.0).abs() < 1e-9);
    assert!((eval_rhs("y=sin(0)", 0.0)).abs() < 1e-9);
    assert!((eval_rhs("y=2pi", 0.0) - std::f64::consts::TAU).abs() < 1e-9);
}

#[test]
fn user_function() {
    let Statement::Function { name, params, body } = parse_statement("f(x)=x^2+1").unwrap() else {
        panic!();
    };
    let mut env = Env::default();
    env.fns.insert(name, (params, body));
    let Statement::Relation { right, .. } = parse_statement("y=f(3)").unwrap() else {
        panic!();
    };
    assert!((env.eval(&right).unwrap() - 10.0).abs() < 1e-9);
}

#[test]
fn abs_factorial_and_piecewise() {
    assert!((eval_rhs("y=|x|", -3.0) - 3.0).abs() < 1e-9);
    assert!((eval_rhs("y=5!", 0.0) - 120.0).abs() < 1e-9);
    assert!((eval_rhs("y={x<0:-x, x}", -4.0) - 4.0).abs() < 1e-9);
    assert!((eval_rhs("y={x<0:-x, x}", 3.0) - 3.0).abs() < 1e-9);
    assert!((eval_rhs("y=nCr(5,2)", 0.0) - 10.0).abs() < 1e-9);
}

#[test]
fn recursive_user_function_errors_instead_of_overflowing() {
    let Statement::Function { name, params, body } = parse_statement("f(x)=f(x)+1").unwrap() else {
        panic!();
    };
    let mut env = Env::default();
    env.fns.insert(name, (params, body));
    let Statement::Relation { right, .. } = parse_statement("y=f(1)").unwrap() else {
        panic!();
    };
    assert!(env.eval(&right).is_err());
}
