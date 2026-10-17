use super::*;
use crate::expr::{Expr, RelationKind, Statement};

fn parse(src: &str) -> Statement {
    parse_statement(src).unwrap()
}

#[test]
fn parses_explicit_parabola() {
    assert_eq!(
        parse("y=x^2"),
        Statement::Relation {
            left: Some(Expr::Name("y".into())),
            kind: RelationKind::Equal,
            right: Expr::Pow(
                Box::new(Expr::Name("x".into())),
                Box::new(Expr::Number(2.0))
            ),
            restrict: vec![],
        }
    );
}

#[test]
fn implicit_multiply_and_function_call() {
    let stmt = parse("y=2x sin(x)");
    let Statement::Relation { right, .. } = stmt else {
        panic!("expected relation");
    };
    assert!(matches!(right, Expr::Mul(_, _)));
}

#[test]
fn splits_juxtaposed_letters() {
    let Statement::Relation { right, .. } = parse("y=mx+b") else {
        panic!("expected relation");
    };
    assert!(right.uses("m") && right.uses("x") && right.uses("b"));
}

#[test]
fn assignment_without_x_or_y_is_a_slider() {
    assert!(matches!(
        parse("a=3"),
        Statement::Assignment { name, .. } if name == "a"
    ));
}

#[test]
fn function_definition() {
    let Statement::Function { name, params, .. } = parse("f(x)=x^2") else {
        panic!("expected function");
    };
    assert_eq!(name, "f");
    assert_eq!(params, vec!["x"]);
}

#[test]
fn point_and_inequality() {
    assert!(matches!(
        parse("(1, 2)"),
        Statement::Relation {
            right: Expr::Point(_, _),
            ..
        }
    ));
    assert!(matches!(
        parse("y>x"),
        Statement::Relation {
            kind: RelationKind::Gt,
            ..
        }
    ));
}

#[test]
fn rejects_empty_and_junk() {
    assert!(parse_statement("").is_err());
    assert!(parse_statement("y==x").is_err());
}

#[test]
fn abs_factorial_piecewise_and_restriction() {
    assert!(matches!(
        parse("y=|x|"),
        Statement::Relation {
            right: Expr::Abs(_),
            ..
        }
    ));
    assert!(matches!(
        parse("y=5!"),
        Statement::Relation {
            right: Expr::Fact(_),
            ..
        }
    ));
    let Statement::Relation {
        right, restrict, ..
    } = parse(r"y={x<0:-x, x}")
    else {
        panic!();
    };
    assert!(matches!(right, Expr::Piecewise(_)));
    assert!(restrict.is_empty());
    let Statement::Relation { restrict, .. } = parse("y=x^2 {0<x<5}") else {
        panic!();
    };
    assert_eq!(restrict.len(), 2);
}

#[test]
fn latex_frac_and_trig() {
    let Statement::Relation { right, .. } = parse(r"y=\sin(\pi)+\frac{1}{2}") else {
        panic!();
    };
    // sin(pi)+1/2 = 0.5 when evaluated; parse must accept it.
    let env = crate::eval::Env::default();
    assert!((env.eval(&right).unwrap() - 0.5).abs() < 1e-9);
}

#[test]
fn exponent_stops_before_implicit_multiply() {
    let Statement::Relation { right, .. } = parse(r"y=x^{2}y") else {
        panic!();
    };
    // x^(2)*y, not x^(2*y)
    let Expr::Mul(left, _) = right else {
        panic!("expected product, got {right:?}");
    };
    let Expr::Pow(_, exp) = *left else {
        panic!("expected power on the left");
    };
    assert_eq!(*exp, Expr::Number(2.0));
}

#[test]
fn unparenthesized_sin_includes_product() {
    let Statement::Relation { right, .. } = parse(r"y=\sin 2x") else {
        panic!();
    };
    let Expr::Call(name, args) = right else {
        panic!("expected call, got {right:?}");
    };
    assert_eq!(name, "sin");
    assert_eq!(args.len(), 1);
    assert!(matches!(args[0], Expr::Mul(_, _)));
}

#[test]
fn number_does_not_eat_bare_e() {
    let Statement::Relation { right, .. } = parse("y=2e") else {
        panic!();
    };
    let Expr::Mul(coeff, name) = right else {
        panic!("expected 2*e, got {right:?}");
    };
    assert_eq!(*coeff, Expr::Number(2.0));
    assert_eq!(*name, Expr::Name("e".into()));
}
