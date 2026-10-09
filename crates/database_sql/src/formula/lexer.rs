//! Formula tokens: numbers, column names (a word, or anything in braces),
//! the four operators and parentheses.

use std::ops::Range;

use logos::Logos;

use crate::parse::ParseError;

/// A token kind; a name holds its text, braces removed.
#[derive(Logos, Debug, Clone, PartialEq)]
#[logos(skip r"[ \t\r\n]+")]
pub(super) enum TokenKind {
    #[token("+")]
    Plus,
    #[token("-")]
    Minus,
    #[token("*")]
    Star,
    #[token("/")]
    Slash,
    #[token("(")]
    LeftParen,
    #[token(")")]
    RightParen,
    #[regex(r"([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?", |lexer| lexer.slice().parse().ok())]
    Number(f64),
    #[regex(r"\{[^{}]*\}", |lexer| { let slice = lexer.slice(); slice[1..slice.len() - 1].trim().to_owned() })]
    Braced(String),
    #[regex(r"[\p{L}_][\p{L}\p{N}_]*", |lexer| lexer.slice().to_owned())]
    Word(String),
}

/// A token with the byte range it came from.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Token {
    pub(super) kind: TokenKind,
    pub(super) span: Range<usize>,
}

/// Tokenize the whole formula, failing on the first character no token
/// matches.
pub(super) fn lex(text: &str) -> Result<Vec<Token>, ParseError> {
    let mut lexer = TokenKind::lexer(text);
    let mut tokens = Vec::new();
    while let Some(result) = lexer.next() {
        let span = lexer.span();
        match result {
            Ok(kind) => tokens.push(Token { kind, span }),
            Err(()) if text[span.start..].starts_with('{') => {
                return Err(ParseError {
                    span: span.start..text.len(),
                    message: "A `{` needs a closing `}`.".into(),
                });
            }
            Err(()) => {
                let found = &text[span.clone()];
                return Err(ParseError {
                    span,
                    message: format!("`{found}` can't be used in a formula."),
                });
            }
        }
    }
    Ok(tokens)
}

/// Whether `name` reads back as one bare word, so it needs no braces.
pub(super) fn is_word(name: &str) -> bool {
    let mut lexer = TokenKind::lexer(name);
    matches!(lexer.next(), Some(Ok(TokenKind::Word(_)))) && lexer.span() == (0..name.len())
}
