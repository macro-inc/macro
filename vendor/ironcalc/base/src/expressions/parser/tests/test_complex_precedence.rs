#![allow(clippy::panic)]

use crate::expressions::parser::Node;
use crate::expressions::token::{OpCompare, OpSum};
use crate::expressions::types::CellReferenceRC;
use std::collections::HashMap;

use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};

#[test]
fn precedence_ast() {
    // Verify the AST structure: (A1:A3="Finance") + (B1:B3="HR") should parse as
    // OpSumKind(CompareKind(A1:A3, "Finance"), CompareKind(B1:B3, "HR"))
    let formula = r#"(A1:A3="Finance") + (B1:B3="HR")"#;
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 3,
        column: 3,
    };
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let parsed = parser.parse(formula, &cell_reference);

    match &parsed {
        Node::OpSumKind { kind, left, right } => {
            assert!(
                matches!(kind, OpSum::Add),
                "root should be Add, got {:?}",
                kind
            );
            assert!(
                matches!(
                    left.as_ref(),
                    Node::CompareKind {
                        kind: OpCompare::Equal,
                        ..
                    }
                ),
                "left of + should be CompareKind(=), got {:?}",
                left
            );
            assert!(
                matches!(
                    right.as_ref(),
                    Node::CompareKind {
                        kind: OpCompare::Equal,
                        ..
                    }
                ),
                "right of + should be CompareKind(=), got {:?}",
                right
            );
        }
        other => panic!("Expected OpSumKind at root, got {:?}", other),
    }
}

#[test]
fn precedence() {
    let formula = r#"(A1:A3="Finance") + (B1:B3="HR")"#;
    let expected = r#"(A1:A3="Finance")+(B1:B3="HR")"#;
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 3,
        column: 3,
    };

    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    let parsed = parser.parse(formula, &cell_reference);
    let result = to_english_localized_string(&parsed, &cell_reference);
    assert_eq!(result, expected, "Failed for formula '{}'", formula);
}
