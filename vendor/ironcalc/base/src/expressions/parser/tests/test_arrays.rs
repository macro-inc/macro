#![allow(clippy::panic)]

use std::collections::HashMap;

use crate::expressions::parser::stringify::to_rc_format;
use crate::expressions::parser::tests::utils::{new_parser, to_english_localized_string};
use crate::expressions::parser::{ArrayNode, Node};
use crate::expressions::types::CellReferenceRC;

#[test]
fn simple_horizontal() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let horizontal = parser.parse("{1, 2, 3}", &cell_reference);
    assert_eq!(
        horizontal,
        Node::ArrayKind(vec![vec![
            ArrayNode::Number(1.0),
            ArrayNode::Number(2.0),
            ArrayNode::Number(3.0)
        ]])
    );

    assert_eq!(to_rc_format(&horizontal), "{1,2,3}");
    assert_eq!(
        to_english_localized_string(&horizontal, &cell_reference),
        "{1,2,3}"
    );
}

#[test]
fn simple_vertical() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let vertical = parser.parse("{1;2; 3}", &cell_reference);
    assert_eq!(
        vertical,
        Node::ArrayKind(vec![
            vec![ArrayNode::Number(1.0)],
            vec![ArrayNode::Number(2.0)],
            vec![ArrayNode::Number(3.0)]
        ])
    );
    assert_eq!(to_rc_format(&vertical), "{1;2;3}");
    assert_eq!(
        to_english_localized_string(&vertical, &cell_reference),
        "{1;2;3}"
    );
}

#[test]
fn simple_matrix() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let matrix = parser.parse("{1,2,3; 4, 5, 6; 7,8,9}", &cell_reference);
    assert_eq!(
        matrix,
        Node::ArrayKind(vec![
            vec![
                ArrayNode::Number(1.0),
                ArrayNode::Number(2.0),
                ArrayNode::Number(3.0)
            ],
            vec![
                ArrayNode::Number(4.0),
                ArrayNode::Number(5.0),
                ArrayNode::Number(6.0)
            ],
            vec![
                ArrayNode::Number(7.0),
                ArrayNode::Number(8.0),
                ArrayNode::Number(9.0)
            ]
        ])
    );
    assert_eq!(to_rc_format(&matrix), "{1,2,3;4,5,6;7,8,9}");
    assert_eq!(
        to_english_localized_string(&matrix, &cell_reference),
        "{1,2,3;4,5,6;7,8,9}"
    );
}
