//! Tokens. Keywords win over identifiers; identifiers keep their case.

use std::ops::Range;

use logos::Logos;

use super::ParseError;

/// A token kind. String-carrying variants hold the decoded text (quotes and
/// escapes removed).
#[derive(Logos, Debug, Clone, PartialEq, strum::IntoStaticStr)]
#[logos(skip r"[ \t\r\n]+")]
#[strum(serialize_all = "UPPERCASE")]
pub enum TokenKind {
    #[regex("(?i)select")]
    Select,
    #[regex("(?i)distinct")]
    Distinct,
    #[regex("(?i)from")]
    From,
    #[regex("(?i)as")]
    As,
    #[regex("(?i)join")]
    Join,
    #[regex("(?i)inner")]
    Inner,
    #[regex("(?i)left")]
    Left,
    #[regex("(?i)outer")]
    Outer,
    #[regex("(?i)on")]
    On,
    // Reserved so `FROM t LIMIT 5` never reads `LIMIT` as an alias.
    #[regex("(?i)limit")]
    Limit,
    #[regex("(?i)offset")]
    Offset,
    #[regex("(?i)default")]
    Default,
    #[regex("(?i)where")]
    Where,
    #[regex("(?i)group")]
    Group,
    #[regex("(?i)order")]
    Order,
    #[regex("(?i)by")]
    By,
    #[regex("(?i)asc")]
    Asc,
    #[regex("(?i)desc")]
    Desc,
    #[regex("(?i)and")]
    And,
    #[regex("(?i)or")]
    Or,
    #[regex("(?i)not")]
    Not,
    #[regex("(?i)in")]
    In,
    #[regex("(?i)has")]
    Has,
    #[regex("(?i)is")]
    Is,
    #[regex("(?i)null")]
    Null,
    #[regex("(?i)like")]
    Like,
    #[regex("(?i)true")]
    True,
    #[regex("(?i)false")]
    False,
    #[regex("(?i)insert")]
    Insert,
    #[regex("(?i)into")]
    Into,
    #[regex("(?i)values")]
    Values,
    #[regex("(?i)update")]
    Update,
    #[regex("(?i)set")]
    Set,
    #[regex("(?i)delete")]
    Delete,
    #[regex("(?i)count")]
    Count,
    #[regex("(?i)sum")]
    Sum,
    #[regex("(?i)avg")]
    Avg,
    #[regex("(?i)min")]
    Min,
    #[regex("(?i)max")]
    Max,

    #[token("<=")]
    #[strum(serialize = "<=")]
    LessOrEqual,
    #[token(">=")]
    #[strum(serialize = ">=")]
    GreaterOrEqual,
    #[token("!=")]
    #[token("<>")]
    #[strum(serialize = "!=")]
    NotEqual,
    #[token("=")]
    #[strum(serialize = "=")]
    Equal,
    #[token("<")]
    #[strum(serialize = "<")]
    Less,
    #[token(">")]
    #[strum(serialize = ">")]
    Greater,
    #[token("(")]
    #[strum(serialize = "(")]
    LeftParen,
    #[token("[")]
    #[strum(serialize = "[")]
    LeftBracket,
    #[token("]")]
    #[strum(serialize = "]")]
    RightBracket,
    #[token(")")]
    #[strum(serialize = ")")]
    RightParen,
    #[token(",")]
    #[strum(serialize = ",")]
    Comma,
    #[token(".")]
    #[strum(serialize = ".")]
    Dot,
    #[token("*")]
    #[strum(serialize = "*")]
    Star,
    #[token("-")]
    #[strum(serialize = "-")]
    Minus,
    #[token(";")]
    #[strum(serialize = ";")]
    Semicolon,

    #[regex(r"[A-Za-z_][A-Za-z0-9_]*", |lexer| lexer.slice().to_owned())]
    Identifier(String),
    #[regex(r#""([^"]|"")*""#, |lex| unquote(lex.slice(), '"'))]
    QuotedIdentifier(String),
    #[regex(r"'([^']|'')*'", |lex| unquote(lex.slice(), '\''))]
    StringLiteral(String),
    #[regex(r"([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?", |lexer| lexer.slice().parse().ok())]
    NumberLiteral(f64),
}

/// Strip the surrounding quotes and collapse doubled quotes.
fn unquote(slice: &str, quote: char) -> String {
    let inner = &slice[1..slice.len() - 1];
    let doubled = format!("{quote}{quote}");
    inner.replace(&doubled, &quote.to_string())
}

/// A token with the byte range it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Range<usize>,
}

/// Tokenize the whole input, failing on the first character no token matches.
pub fn lex(sql: &str) -> Result<Vec<Token>, ParseError> {
    let mut lexer = TokenKind::lexer(sql);
    let mut tokens = Vec::new();
    while let Some(result) = lexer.next() {
        let span = lexer.span();
        match result {
            Ok(kind) => tokens.push(Token { kind, span }),
            Err(()) => {
                let found = &sql[span.clone()];
                let message = match found.chars().next() {
                    Some(quote @ ('"' | '\'')) => {
                        format!("unterminated quote starting at {quote}")
                    }
                    _ => format!("unexpected character {found:?}"),
                };
                return Err(ParseError { span, message });
            }
        }
    }
    Ok(tokens)
}

impl TokenKind {
    /// The keyword's name in lower case, for a keyword used as a name after
    /// `AS`; `None` for every other token.
    pub fn keyword_name(&self) -> Option<String> {
        match self {
            TokenKind::Identifier(_)
            | TokenKind::QuotedIdentifier(_)
            | TokenKind::StringLiteral(_)
            | TokenKind::NumberLiteral(_) => None,
            // Punctuation spells itself with symbols, keywords with letters.
            other => {
                let spelling: &'static str = other.into();
                spelling
                    .chars()
                    .all(|character| character.is_ascii_alphabetic())
                    .then(|| spelling.to_lowercase())
            }
        }
    }

    /// How the token reads in an error message.
    pub fn describe(&self) -> String {
        match self {
            TokenKind::Identifier(name) | TokenKind::QuotedIdentifier(name) => {
                format!("\"{name}\"")
            }
            TokenKind::StringLiteral(text) => format!("'{text}'"),
            TokenKind::NumberLiteral(number) => number.to_string(),
            other => <&'static str>::from(other).into(),
        }
    }
}
