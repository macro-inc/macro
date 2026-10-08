#![allow(clippy::unwrap_used)]

use crate::{
    expressions::{
        lexer::{Lexer, LexerMode},
        token::TokenType,
    },
    language::get_language,
    locale::get_locale,
};

fn new_language_lexer<'a>(formula: &str, locale: &str, language: &str) -> Lexer<'a> {
    let locale = get_locale(locale).unwrap();
    let language = get_language(language).unwrap();
    Lexer::new(formula, LexerMode::A1, locale, language)
}

#[test]
fn test_german_locale() {
    let mut lx = new_language_lexer("2,34e-3", "de", "en");
    assert_eq!(lx.next_token(), TokenType::Number(2.34e-3));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_german_locale_does_not_parse() {
    let mut lx = new_language_lexer("2.34e-3", "de", "en");
    assert_eq!(lx.next_token(), TokenType::Number(2.0));
    assert!(matches!(lx.next_token(), TokenType::Illegal { .. }));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_english_locale() {
    let mut lx = new_language_lexer("2.34e-3", "en", "en");
    assert_eq!(lx.next_token(), TokenType::Number(2.34e-3));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_english_locale_does_not_parse() {
    // a comma is a separator
    let mut lx = new_language_lexer("2,34e-3", "en", "en");
    assert_eq!(lx.next_token(), TokenType::Number(2.0));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Number(34e-3));
    assert_eq!(lx.next_token(), TokenType::EOF);
}
