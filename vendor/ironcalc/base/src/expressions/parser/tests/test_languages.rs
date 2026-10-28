#![allow(clippy::unwrap_used)]

use std::collections::HashMap;

use crate::expressions::parser::{DefinedNameS, Node, Parser};
use crate::expressions::types::CellReferenceRC;

use crate::expressions::parser::stringify::{to_localized_string, to_rc_format};
use crate::functions::Function;
use crate::language::get_language;
use crate::locale::get_locale;
use crate::types::Table;

pub fn to_string(t: &Node, cell_reference: &CellReferenceRC) -> String {
    let locale = get_locale("en").unwrap();
    let language = get_language("es").unwrap();
    to_localized_string(t, cell_reference, locale, language)
}

pub fn new_parser<'a>(
    worksheets: Vec<String>,
    defined_names: Vec<DefinedNameS>,
    tables: HashMap<String, Table>,
) -> Parser<'a> {
    let locale = get_locale("en").unwrap();
    let language = get_language("es").unwrap();
    Parser::new(worksheets, defined_names, tables, locale, language)
}

#[test]
fn simple_language() {
    let worksheets = vec!["Sheet1".to_string(), "Second Sheet".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());
    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("FALSO", &cell_reference);
    assert!(matches!(t, Node::BooleanKind(false)));
    assert_eq!(to_rc_format(&t), "FALSE");

    let t = parser.parse("VERDADERO", &cell_reference);
    assert!(matches!(t, Node::BooleanKind(true)));
    assert_eq!(to_rc_format(&t), "TRUE");

    let t = parser.parse("TRUE()", &cell_reference);
    assert!(matches!(t, Node::NamedFunctionKind { ref name, args: _, id: _ } if name == "TRUE"));

    let t = parser.parse("VERDADERO()", &cell_reference);
    assert!(matches!(
        t,
        Node::FunctionKind {
            kind: Function::True,
            args: _
        }
    ));
    assert_eq!(to_string(&t, &cell_reference), "VERDADERO()".to_string());
    assert_eq!(to_rc_format(&t), "TRUE()");
}
