#![allow(clippy::unwrap_used)]
#![allow(clippy::expect_used)]

use crate::{
    formatter::format::format_number,
    locale::{get_locale, Locale},
};

fn get_default_locale() -> &'static Locale {
    get_locale("en").unwrap()
}

#[test]
fn scientific_minus_negative() {
    let locale = get_default_locale();
    let b = format_number(0.000002, "0.00E-00", locale);
    assert_eq!(b.text, "2.00E-06");
}

#[test]
fn scientific_minus_positive() {
    let locale = get_default_locale();
    let b = format_number(2_000_000.0, "0.00E-00", locale);
    assert_eq!(b.text, "2.00E06");
}

#[test]
fn scientific_positive() {
    let locale = get_default_locale();
    let b = format_number(2_000_000.0, "0.00E+00", locale);
    assert_eq!(b.text, "2.00E+06");
}

#[test]
fn scientific_negative() {
    let locale = get_default_locale();
    let b = format_number(0.000002, "0.00E+00", locale);
    assert_eq!(b.text, "2.00E-06");
}
