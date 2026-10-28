#![allow(clippy::unwrap_used)]
#![allow(clippy::expect_used)]

use crate::formatter::lexer::{Compare, Lexer, Token};

#[test]
fn condition() {
    let mut lexer = Lexer::new("[<100]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::Condition(Compare::LessThan, 100.0)));
}

#[test]
fn condition_negative() {
    let mut lexer = Lexer::new("[>-100]");
    let token = lexer.next_token();
    assert!(matches!(
        token,
        Token::Condition(Compare::GreaterThan, -100.0)
    ));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn condition_period() {
    let mut lexer = Lexer::new("[<=.5]");
    let token = lexer.next_token();
    assert!(matches!(
        token,
        Token::Condition(Compare::LessOrEqualThan, 0.5)
    ));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn condition_scientific() {
    let mut lexer = Lexer::new("[<=-1.5E2]");
    let token = lexer.next_token();
    assert!(matches!(
        token,
        Token::Condition(Compare::LessOrEqualThan, -150.0)
    ));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn condition_without_number() {
    let mut lexer = Lexer::new("[>]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::Condition(Compare::GreaterThan, 0.0)));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn condition_largest_number() {
    let mut lexer = Lexer::new("[>1e308]");
    let token = lexer.next_token();
    assert!(matches!(
        token,
        Token::Condition(Compare::GreaterThan, 1e308)
    ));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

// A number too large to hold is not a number, and it is not a missing number
// either: the condition is not `[>0]`, it is wrong.
#[test]
fn condition_number_too_large() {
    for format in ["[>1e400]", "[<-1e400]", "[=1E+999]", "[>=123e400]0"] {
        let mut lexer = Lexer::new(format);
        assert!(matches!(lexer.next_token(), Token::ILLEGAL), "{format}");
    }
}

#[test]
fn condition_number_unfinished() {
    for format in ["[>-]", "[<.]", "[>-.]"] {
        let mut lexer = Lexer::new(format);
        assert!(matches!(lexer.next_token(), Token::ILLEGAL), "{format}");
    }
}

#[test]
fn condition_invalid() {
    let mut lexer = Lexer::new("[<abc]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ILLEGAL));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_time() {
    let mut lexer = Lexer::new("[hh]:mm:ss");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedHourPadded));
    let token = lexer.next_token();
    assert!(matches!(token, Token::Literal(':')));
    let token = lexer.next_token();
    // We can't distinguish between minute and month here
    assert!(matches!(token, Token::MonthPadded));
    let token = lexer.next_token();
    assert!(matches!(token, Token::Literal(':')));
    let token = lexer.next_token();
    assert!(matches!(token, Token::SecondPadded));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_hour() {
    let mut lexer = Lexer::new("[H]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedHour));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_minute() {
    let mut lexer = Lexer::new("[M]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedMinute));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_second() {
    let mut lexer = Lexer::new("[S]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedSecond));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_minute_padded() {
    let mut lexer = Lexer::new("[MM]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedMinutePadded));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn elapsed_second_padded() {
    let mut lexer = Lexer::new("[SS]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ElapsedSecondPadded));
    assert!(matches!(lexer.next_token(), Token::EOF));
}

#[test]
fn too_many_h() {
    let mut lexer = Lexer::new("[HHH]");
    let token = lexer.next_token();
    assert!(matches!(token, Token::ILLEGAL));
    assert!(matches!(lexer.next_token(), Token::EOF));
}
