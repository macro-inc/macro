// [$$-en-US]#,##0.00_);[Red]([$$-en-US]#,##0.00)

#![allow(clippy::unwrap_used)]
#![allow(clippy::expect_used)]

use crate::formatter::lexer::{Lexer, Token};

#[test]
fn dollar_en_us() {
    let mut lexer = Lexer::new("[$$-en-US]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::Currency('$')));
}

#[test]
fn dollar_409() {
    let mut lexer = Lexer::new("[$$-409]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::Currency('$')));
}
