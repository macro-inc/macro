#![allow(clippy::unwrap_used)]

use std::collections::HashMap;

use crate::expressions::parser::{DefinedNameS, Parser};
use crate::expressions::types::CellReferenceRC;

use crate::expressions::parser::stringify::{to_localized_string, to_rc_format};
use crate::language::get_language;
use crate::locale::get_locale;
use crate::types::Table;

pub fn new_parser<'a>(
    worksheets: Vec<String>,
    defined_names: Vec<DefinedNameS>,
    tables: HashMap<String, Table>,
) -> Parser<'a> {
    let locale = get_locale("fr").unwrap();
    let language = get_language("en").unwrap();
    Parser::new(worksheets, defined_names, tables, locale, language)
}

#[test]
fn simple_locale() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("1,123", &cell_reference);
    assert_eq!(to_rc_format(&t), "1.123");
    assert_eq!(
        to_localized_string(&t, &cell_reference, parser.locale, parser.language),
        "1,123"
    );

    let t = parser.parse("{1 ;2 ; 3,34}", &cell_reference);
    assert_eq!(to_rc_format(&t), "{1,2,3.34}");
    assert_eq!(
        to_localized_string(&t, &cell_reference, parser.locale, parser.language),
        "{1;2;3,34}"
    );

    let t = parser.parse("SUM(1,5; 2,5)", &cell_reference);
    assert_eq!(to_rc_format(&t), "SUM(1.5,2.5)");
    assert_eq!(
        to_localized_string(&t, &cell_reference, parser.locale, parser.language),
        "SUM(1,5;2,5)"
    );
}
