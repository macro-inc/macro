#![allow(clippy::panic)]

use crate::expressions::parser::Node;
use crate::expressions::types::CellReferenceRC;
use std::collections::HashMap;

use crate::expressions::parser::tests::utils::new_parser;

#[test]
fn simple() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!B3
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 3,
        column: 2,
    };
    let t = parser.parse("@A1:A10", &cell_reference);
    let child = Node::RangeKind {
        sheet_name: None,
        sheet_index: 0,
        absolute_row1: false,
        absolute_column1: false,
        row1: -2,
        column1: -1,
        absolute_row2: false,
        absolute_column2: false,
        row2: 7,
        column2: -1,
    };
    assert_eq!(
        t,
        Node::ImplicitIntersection {
            automatic: false,
            child: Box::new(child)
        }
    )
}

#[test]
fn simple_add() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!B3
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 3,
        column: 2,
    };
    let t = parser.parse("@A1:A10+12", &cell_reference);
    let child = Node::RangeKind {
        sheet_name: None,
        sheet_index: 0,
        absolute_row1: false,
        absolute_column1: false,
        row1: -2,
        column1: -1,
        absolute_row2: false,
        absolute_column2: false,
        row2: 7,
        column2: -1,
    };
    assert_eq!(
        t,
        Node::OpSumKind {
            kind: crate::expressions::token::OpSum::Add,
            left: Box::new(Node::ImplicitIntersection {
                automatic: false,
                child: Box::new(child)
            }),
            right: Box::new(Node::NumberKind(12.0))
        }
    )
}
