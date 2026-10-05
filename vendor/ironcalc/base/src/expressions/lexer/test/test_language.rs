#![allow(clippy::unwrap_used)]

use crate::{
    expressions::{
        lexer::{Lexer, LexerMode},
        token::{Error, TokenType},
    },
    language::get_language,
    locale::get_default_locale,
};

fn new_language_lexer<'a>(formula: &str, language: &str) -> Lexer<'a> {
    let locale = get_default_locale();
    let language = get_language(language).unwrap();
    Lexer::new(formula, LexerMode::A1, locale, language)
}

// Spanish

#[test]
fn test_verdadero_falso() {
    let mut lx = new_language_lexer("IF(A1, VERDADERO, FALSO)", "es");
    assert_eq!(lx.next_token(), TokenType::Ident("IF".to_string()));
    assert_eq!(lx.next_token(), TokenType::LeftParenthesis);
    assert!(matches!(lx.next_token(), TokenType::Reference { .. }));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(true));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(false));
    assert_eq!(lx.next_token(), TokenType::RightParenthesis);
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_spanish_errors_ref() {
    let mut lx = new_language_lexer("#¡REF!", "es");
    assert_eq!(lx.next_token(), TokenType::Error(Error::REF));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

// German

#[test]
fn test_wahr_falsch() {
    let mut lx = new_language_lexer("IF(A1, WAHR, FALSCH)", "de");
    assert_eq!(lx.next_token(), TokenType::Ident("IF".to_string()));
    assert_eq!(lx.next_token(), TokenType::LeftParenthesis);
    assert!(matches!(lx.next_token(), TokenType::Reference { .. }));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(true));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(false));
    assert_eq!(lx.next_token(), TokenType::RightParenthesis);
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_german_errors_ref() {
    let mut lx = new_language_lexer("#BEZUG!", "de");
    assert_eq!(lx.next_token(), TokenType::Error(Error::REF));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

// French

#[test]
fn test_vrai_faux() {
    let mut lx = new_language_lexer("IF(A1, VRAI, FAUX)", "fr");
    assert_eq!(lx.next_token(), TokenType::Ident("IF".to_string()));
    assert_eq!(lx.next_token(), TokenType::LeftParenthesis);
    assert!(matches!(lx.next_token(), TokenType::Reference { .. }));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(true));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Boolean(false));
    assert_eq!(lx.next_token(), TokenType::RightParenthesis);
    assert_eq!(lx.next_token(), TokenType::EOF);
}

#[test]
fn test_french_errors_ref() {
    let mut lx = new_language_lexer("#REF!", "fr");
    assert_eq!(lx.next_token(), TokenType::Error(Error::REF));
    assert_eq!(lx.next_token(), TokenType::EOF);
}

// English with errors

#[test]
fn test_english_with_spanish_words() {
    let mut lx = new_language_lexer("IF(A1, VERDADERO, FALSO)", "en");
    assert_eq!(lx.next_token(), TokenType::Ident("IF".to_string()));
    assert_eq!(lx.next_token(), TokenType::LeftParenthesis);
    assert!(matches!(lx.next_token(), TokenType::Reference { .. }));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Ident("VERDADERO".to_string()));
    assert_eq!(lx.next_token(), TokenType::Comma);
    assert_eq!(lx.next_token(), TokenType::Ident("FALSO".to_string()));
    assert_eq!(lx.next_token(), TokenType::RightParenthesis);
    assert_eq!(lx.next_token(), TokenType::EOF);
}
