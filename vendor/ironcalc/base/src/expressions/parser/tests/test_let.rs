use crate::expressions::parser::tests::utils::new_parser;
use crate::expressions::parser::Node;
use crate::expressions::token;
use crate::expressions::types::CellReferenceRC;
use std::collections::HashMap;

#[test]
fn names_are_parsed_correctly() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("LET(x,1,adam,2,x+adam)", &cell_reference);
    let expected = Node::FunctionKind {
        kind: crate::functions::Function::Let,
        args: vec![
            Node::NamedVariableKind {
                name: "x".to_string(),
                id: None,
            },
            Node::NumberKind(1.0),
            Node::NamedVariableKind {
                name: "adam".to_string(),
                id: None,
            },
            Node::NumberKind(2.0),
            Node::OpSumKind {
                kind: token::OpSum::Add,
                left: Box::new(Node::NamedVariableKind {
                    name: "x".to_string(),
                    id: None,
                }),
                right: Box::new(Node::NamedVariableKind {
                    name: "adam".to_string(),
                    id: None,
                }),
            },
        ],
    };
    assert_eq!(t, expected);
}
