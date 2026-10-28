use crate::expressions::parser::tests::utils::new_parser;
use crate::expressions::parser::{NamedVariable, Node};
use crate::expressions::token;
use crate::expressions::types::CellReferenceRC;
use crate::functions::Function;
use std::collections::HashMap;

fn cell() -> CellReferenceRC {
    CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    }
}

fn parser() -> crate::expressions::parser::Parser<'static> {
    new_parser(vec!["Sheet1".to_string()], vec![], HashMap::new())
}

// Helper that builds the SQRT(a*a + b*b) node used in several tests.
fn sqrt_aa_bb() -> Node {
    Node::FunctionKind {
        kind: Function::Sqrt,
        args: vec![Node::OpSumKind {
            kind: token::OpSum::Add,
            left: Box::new(Node::OpProductKind {
                kind: token::OpProduct::Times,
                left: Box::new(Node::NamedVariableKind {
                    name: "a".to_string(),
                    id: None,
                }),
                right: Box::new(Node::NamedVariableKind {
                    name: "a".to_string(),
                    id: None,
                }),
            }),
            right: Box::new(Node::OpProductKind {
                kind: token::OpProduct::Times,
                left: Box::new(Node::NamedVariableKind {
                    name: "b".to_string(),
                    id: None,
                }),
                right: Box::new(Node::NamedVariableKind {
                    name: "b".to_string(),
                    id: None,
                }),
            }),
        }],
    }
}

#[test]
fn lambda_simple() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a,b, SQRT(a*a+b*b))", &cell());
    let expected = Node::LambdaDefKind {
        parameters: vec![
            NamedVariable {
                name: "a".to_string(),
                id: None,
                is_optional: false,
            },
            NamedVariable {
                name: "b".to_string(),
                id: None,
                is_optional: false,
            },
        ],
        body: Box::new(sqrt_aa_bb()),
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_simple_optional() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a, [b], SQRT(a*a+b*b))", &cell());
    let expected = Node::LambdaDefKind {
        parameters: vec![
            NamedVariable {
                name: "a".to_string(),
                id: None,
                is_optional: false,
            },
            NamedVariable {
                name: "b".to_string(),
                id: None,
                is_optional: true,
            },
        ],
        body: Box::new(sqrt_aa_bb()),
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_called_immediately() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a,b, SQRT(a*a+b*b))(3,4)", &cell());
    let expected = Node::LambdaCallKind {
        lambda: Box::new(Node::LambdaDefKind {
            parameters: vec![
                NamedVariable {
                    name: "a".to_string(),
                    id: None,
                    is_optional: false,
                },
                NamedVariable {
                    name: "b".to_string(),
                    id: None,
                    is_optional: false,
                },
            ],
            body: Box::new(sqrt_aa_bb()),
        }),
        args: vec![Node::NumberKind(3.0), Node::NumberKind(4.0)],
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_called_immediately_with_lambda_as_parameter() {
    let mut p = parser();
    let t = p.parse("LAMBDA(f, f(3,4))(LAMBDA(a,b, SQRT(a*a+b*b)))", &cell());
    let expected = Node::LambdaCallKind {
        lambda: Box::new(Node::LambdaDefKind {
            parameters: vec![NamedVariable {
                name: "f".to_string(),
                id: None,
                is_optional: false,
            }],
            body: Box::new(Node::NamedFunctionKind {
                id: None,
                name: "f".to_string(),
                args: vec![Node::NumberKind(3.0), Node::NumberKind(4.0)],
            }),
        }),
        args: vec![Node::LambdaDefKind {
            parameters: vec![
                NamedVariable {
                    name: "a".to_string(),
                    id: None,
                    is_optional: false,
                },
                NamedVariable {
                    name: "b".to_string(),
                    id: None,
                    is_optional: false,
                },
            ],
            body: Box::new(sqrt_aa_bb()),
        }],
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_in_let() {
    let mut p = parser();
    let t = p.parse("LET(x, LAMBDA(a, a*a), x(2))", &cell());
    let expected = Node::FunctionKind {
        kind: Function::Let,
        args: vec![
            Node::NamedVariableKind {
                name: "x".to_string(),
                id: None,
            },
            Node::LambdaDefKind {
                parameters: vec![NamedVariable {
                    name: "a".to_string(),
                    id: None,
                    is_optional: false,
                }],
                body: Box::new(Node::OpProductKind {
                    kind: token::OpProduct::Times,
                    left: Box::new(Node::NamedVariableKind {
                        name: "a".to_string(),
                        id: None,
                    }),
                    right: Box::new(Node::NamedVariableKind {
                        name: "a".to_string(),
                        id: None,
                    }),
                }),
            },
            Node::NamedFunctionKind {
                id: None,
                name: "x".to_string(),
                args: vec![Node::NumberKind(2.0)],
            },
        ],
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_no_params_just_body() {
    // LAMBDA with a single argument: 0 params, the argument is the body.
    let mut p = parser();
    let t = p.parse("LAMBDA(42)", &cell());
    let expected = Node::LambdaDefKind {
        parameters: vec![],
        body: Box::new(Node::NumberKind(42.0)),
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_empty_is_parse_error() {
    let mut p = parser();
    let t = p.parse("LAMBDA()", &cell());
    assert!(
        matches!(t, Node::ParseErrorKind { .. }),
        "LAMBDA() should be a parse error, got {t:?}"
    );
}

#[test]
fn lambda_non_name_parameter_is_parse_error() {
    // LAMBDA(1, 2, 1+2) — the first param is a number literal, not a name.
    let mut p = parser();
    let t = p.parse("LAMBDA(1, 2, 1+2)", &cell());
    assert!(
        matches!(t, Node::ParseErrorKind { .. }),
        "LAMBDA with numeric param should be a parse error, got {t:?}"
    );
}

// LAMBDA with optional param, immediately invoked with one arg.
#[test]
fn lambda_optional_called_with_one_arg() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a, [b], a+1)(12)", &cell());
    let expected = Node::LambdaCallKind {
        lambda: Box::new(Node::LambdaDefKind {
            parameters: vec![
                NamedVariable {
                    name: "a".to_string(),
                    id: None,
                    is_optional: false,
                },
                NamedVariable {
                    name: "b".to_string(),
                    id: None,
                    is_optional: true,
                },
            ],
            body: Box::new(Node::OpSumKind {
                kind: token::OpSum::Add,
                left: Box::new(Node::NamedVariableKind {
                    name: "a".to_string(),
                    id: None,
                }),
                right: Box::new(Node::NumberKind(1.0)),
            }),
        }),
        args: vec![Node::NumberKind(12.0)],
    };
    assert_eq!(t, expected);
}

#[test]
fn lambda_r_and_c_parameters() {
    // r and c must be valid LAMBDA parameter names (they are not restricted
    // to R1C1 notation in A1 mode when used as formula identifiers).
    let mut p = parser();
    let t = p.parse("LAMBDA(r, c, r+c)", &cell());
    let expected = Node::LambdaDefKind {
        parameters: vec![
            NamedVariable {
                name: "r".to_string(),
                id: None,
                is_optional: false,
            },
            NamedVariable {
                name: "c".to_string(),
                id: None,
                is_optional: false,
            },
        ],
        body: Box::new(Node::OpSumKind {
            kind: token::OpSum::Add,
            left: Box::new(Node::NamedVariableKind {
                name: "r".to_string(),
                id: None,
            }),
            right: Box::new(Node::NamedVariableKind {
                name: "c".to_string(),
                id: None,
            }),
        }),
    };
    assert_eq!(t, expected);
}

// SIN(x) is a fully-resolved function call, not a lambda — calling it with (3)
// afterwards is syntactically invalid per the grammar.  The parser returns just
// SIN(x) and the trailing (3) is left unconsumed (no parse error is raised at
// the primary level).
#[test]
fn sin_is_not_immediately_invocable() {
    let mut p = parser();
    let t = p.parse("SIN(x)(3)", &cell());
    // The result should be a plain SIN call, not a LambdaCallKind.
    assert!(
        matches!(
            t,
            Node::FunctionKind {
                kind: Function::Sin,
                ..
            }
        ),
        "SIN(x)(3) should parse as SIN(x), got {t:?}"
    );
    // Confirm it is NOT treated as a lambda call.
    assert!(
        !matches!(t, Node::LambdaCallKind { .. }),
        "SIN(x)(3) must not produce a LambdaCallKind"
    );
}

// Regression: a LAMBDA whose parameter is the single-char name `c` (or `r`) must
// round-trip through the internal R1C1 representation. These names are valid LAMBDA
// parameters in A1 mode, get stored in R1C1 format on save, and must re-parse as
// identifiers (not be rejected as invalid R1C1 references) on reload. Otherwise the
// formula becomes a ParseError that displays the raw R1C1 string to the user.
#[test]
fn lambda_single_char_rc_param_roundtrips_in_r1c1_mode() {
    use crate::expressions::lexer::LexerMode;
    let mut p = parser();
    p.set_lexer_mode(LexerMode::R1C1);
    let t = p.parse("BYROW(R[-21]C[-1]:R[-21]C[1],LAMBDA(c,MAX(c)))", &cell());
    assert!(
        !matches!(t, Node::ParseErrorKind { .. }),
        "R1C1 reload should not be a parse error, got {t:?}"
    );
    assert!(
        matches!(
            t,
            Node::FunctionKind {
                kind: crate::functions::Function::Byrow,
                ..
            }
        ),
        "expected a BYROW call, got {t:?}"
    );

    // Same with `r`.
    let t = p.parse("LAMBDA(r,r+1)", &cell());
    assert!(
        matches!(t, Node::LambdaDefKind { .. }),
        "LAMBDA(r,...) should parse in R1C1 mode, got {t:?}"
    );
}
