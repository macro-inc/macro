#![allow(clippy::unwrap_used)]

use crate::expressions::{
    lexer::{Lexer, LexerMode},
    token::TokenType::*,
};
use crate::language::get_language;
use crate::locale::get_locale;

fn new_lexer(formula: &str) -> Lexer<'_> {
    let locale = get_locale("en").unwrap();
    let language = get_language("en").unwrap();
    Lexer::new(formula, LexerMode::A1, locale, language)
}

#[test]
fn sum_implicit_intersection() {
    let mut lx = new_lexer("sum(@A1:A3)");
    assert_eq!(lx.next_token(), Ident("sum".to_string()));
    assert_eq!(lx.next_token(), LeftParenthesis);
    assert_eq!(lx.next_token(), At);
    assert!(matches!(lx.next_token(), Range { .. }));
    assert_eq!(lx.next_token(), RightParenthesis);
    assert_eq!(lx.next_token(), EOF);
}
