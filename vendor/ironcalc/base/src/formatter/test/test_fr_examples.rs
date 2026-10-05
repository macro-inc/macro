#![allow(clippy::unwrap_used)]
#![allow(clippy::expect_used)]

use crate::{
    formatter::format::format_number,
    locale::{get_locale, Locale},
};

fn get_fr_locale() -> &'static Locale {
    get_locale("fr").unwrap()
}

#[test]
fn format_hash_group_0_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(1234.0, "#,##0", locale);
    let r2 = format_number(12.0, "#,##0", locale);
    let r3 = format_number(0.4, "#,##0", locale);

    assert_eq!(r1.text, "1\u{202f}234");
    assert_eq!(r2.text, "12");
    assert_eq!(r3.text, "0");
}

#[test]
fn format_hash_group_0_00_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(1234.5, "#,##0.00", locale);
    let r2 = format_number(12.0, "#,##0.00", locale);
    let r3 = format_number(0.456, "#,##0.00", locale);

    assert_eq!(r1.text, "1\u{202f}234,50");
    assert_eq!(r2.text, "12,00");
    assert_eq!(r3.text, "0,46");
}

#[test]
fn format_hash_group_0_hashhashhash_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(1234.5678, "#,##0.###", locale);
    let r2 = format_number(12.3, "#,##0.###", locale);
    let r3 = format_number(0.5, "#,##0.###", locale);

    assert_eq!(r1.text, "1\u{202f}234,568");
    assert_eq!(r2.text, "12,3");
    assert_eq!(r3.text, "0,5");
}

#[test]
fn format_0_00_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(5.6, "0.00", locale);
    let r2 = format_number(0.2, "0.00", locale);
    let r3 = format_number(123.456, "0.00", locale);

    assert_eq!(r1.text, "5,60");
    assert_eq!(r2.text, "0,20");
    assert_eq!(r3.text, "123,46");
}

#[test]
fn format_thousands_scale_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(1_234_567.0, "#,##0,", locale);
    let r2 = format_number(1_510.0, "#,##0,", locale);
    let r3 = format_number(999.0, "#,##0,", locale);

    assert_eq!(r1.text, "1\u{202f}235"); // 1 234 567 / 1000 → 1 235
    assert_eq!(r2.text, "2");
    assert_eq!(r3.text, "1");
}

#[test]
fn format_millions_scale_integer_fr() {
    let locale = get_fr_locale();
    let r1 = format_number(1_234_567.0, "#,##0,,", locale);
    let r2 = format_number(2_510_000.0, "#,##0,,", locale);
    let r3 = format_number(12_345_678.0, "#,##0,,", locale);

    assert_eq!(r1.text, "1");
    assert_eq!(r2.text, "3");
    assert_eq!(r3.text, "12");
}
