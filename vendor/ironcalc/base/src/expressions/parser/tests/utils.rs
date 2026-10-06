use std::collections::HashMap;

use crate::{
    expressions::{
        parser::{DefinedNameS, Node, Parser},
        types::CellReferenceRC,
    },
    language::get_default_language,
    locale::get_default_locale,
    types::Table,
};

use crate::expressions::parser::stringify::to_localized_string;

pub fn to_english_localized_string(t: &Node, cell_reference: &CellReferenceRC) -> String {
    let locale = get_default_locale();
    let language = get_default_language();
    to_localized_string(t, cell_reference, locale, language)
}

pub fn new_parser<'a>(
    worksheets: Vec<String>,
    defined_names: Vec<DefinedNameS>,
    tables: HashMap<String, Table>,
) -> Parser<'a> {
    let locale = get_default_locale();
    let language = get_default_language();
    Parser::new(worksheets, defined_names, tables, locale, language)
}
