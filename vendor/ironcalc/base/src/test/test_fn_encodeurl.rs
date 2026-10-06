#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_encodeurl_args_number() {
    let mut model = new_empty_model();

    model._set("A1", "=ENCODEURL()");
    model._set("A2", r#"=ENCODEURL("a", "b")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

#[test]
fn fn_encodeurl() {
    let mut model = new_empty_model();

    model._set(
        "A1",
        r#"=ENCODEURL("http://contoso.sharepoint.com/Finance/Profit and Loss Statement.xlsx")"#,
    );
    model._set("A2", r#"=ENCODEURL("AZaz09-._~")"#);
    model._set("A3", r#"=ENCODEURL("a b+c&d=e?f/g:h")"#);
    model._set("A4", r#"=ENCODEURL("")"#);

    model.evaluate();

    assert_eq!(
        model._get_text("A1"),
        *"http%3A%2F%2Fcontoso.sharepoint.com%2FFinance%2FProfit%20and%20Loss%20Statement.xlsx"
    );
    // Unreserved characters are not encoded
    assert_eq!(model._get_text("A2"), *"AZaz09-._~");
    assert_eq!(model._get_text("A3"), *"a%20b%2Bc%26d%3De%3Ff%2Fg%3Ah");
    assert_eq!(model._get_text("A4"), *"");
}

#[test]
fn fn_encodeurl_utf8() {
    let mut model = new_empty_model();

    // Non-ASCII characters are encoded byte by byte in UTF-8
    model._set("A1", r#"=ENCODEURL("ü")"#);
    model._set("A2", r#"=ENCODEURL("€")"#);
    model._set("A3", r#"=ENCODEURL("日本")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"%C3%BC");
    assert_eq!(model._get_text("A2"), *"%E2%82%AC");
    assert_eq!(model._get_text("A3"), *"%E6%97%A5%E6%9C%AC");
}

#[test]
fn fn_encodeurl_casts_arguments() {
    let mut model = new_empty_model();

    model._set("A1", "=ENCODEURL(12.5)");
    model._set("A2", "=ENCODEURL(TRUE)");
    model._set("A3", "=ENCODEURL(1/0)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"12.5");
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert_eq!(model._get_text("A3"), *"#DIV/0!");
}
