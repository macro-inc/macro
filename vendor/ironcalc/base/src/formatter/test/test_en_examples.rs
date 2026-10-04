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
fn format_0() {
    let locale = get_default_locale();
    let r1 = format_number(5.6, "0", locale);
    let r2 = format_number(0.2, "0", locale);
    let r3 = format_number(123.0, "0", locale);

    assert_eq!(r1.text, "6");
    assert_eq!(r2.text, "0");
    assert_eq!(r3.text, "123");
}

#[test]
fn format_0_00() {
    let locale = get_default_locale();
    let r1 = format_number(5.6, "0.00", locale);
    let r2 = format_number(0.2, "0.00", locale);
    let r3 = format_number(123.456, "0.00", locale);

    assert_eq!(r1.text, "5.60");
    assert_eq!(r2.text, "0.20");
    assert_eq!(r3.text, "123.46");
}

#[test]
fn format_hash_group_0() {
    let locale = get_default_locale();
    let r1 = format_number(1234.0, "#,##0", locale);
    let r2 = format_number(12.0, "#,##0", locale);
    let r3 = format_number(0.4, "#,##0", locale);

    assert_eq!(r1.text, "1,234");
    assert_eq!(r2.text, "12");
    assert_eq!(r3.text, "0");
}

#[test]
fn format_hash_group_0_00() {
    let locale = get_default_locale();
    let r1 = format_number(1234.5, "#,##0.00", locale);
    let r2 = format_number(12.0, "#,##0.00", locale);
    let r3 = format_number(0.456, "#,##0.00", locale);

    assert_eq!(r1.text, "1,234.50");
    assert_eq!(r2.text, "12.00");
    assert_eq!(r3.text, "0.46");
}

#[test]
fn format_hash_group_0_hashhashhash() {
    let locale = get_default_locale();
    let r1 = format_number(1234.5678, "#,##0.###", locale);
    let r2 = format_number(12.3, "#,##0.###", locale);
    let r3 = format_number(0.5, "#,##0.###", locale);

    assert_eq!(r1.text, "1,234.568");
    assert_eq!(r2.text, "12.3");
    assert_eq!(r3.text, "0.5");
}

#[test]
fn format_0_percent() {
    let locale = get_default_locale();
    let r1 = format_number(0.256, "0%", locale);
    let r2 = format_number(1.0, "0%", locale);
    let r3 = format_number(0.004, "0%", locale);

    assert_eq!(r1.text, "26%");
    assert_eq!(r2.text, "100%");
    assert_eq!(r3.text, "0%");
}

#[test]
fn format_0_00_percent() {
    let locale = get_default_locale();
    let r1 = format_number(0.256, "0.00%", locale);
    let r2 = format_number(1.0, "0.00%", locale);
    let r3 = format_number(0.004, "0.00%", locale);

    assert_eq!(r1.text, "25.60%");
    assert_eq!(r2.text, "100.00%");
    assert_eq!(r3.text, "0.40%");
}

#[test]
fn format_thousands_scale() {
    let locale = get_default_locale();
    let r1 = format_number(1_234_567.0, "#,##0,", locale);
    let r2 = format_number(1_500.0, "#,##0,", locale);
    let r3 = format_number(999.0, "#,##0,", locale);

    assert_eq!(r1.text, "1,235");
    assert_eq!(r2.text, "2");
    assert_eq!(r3.text, "1");
}

#[test]
fn format_millions_scale_integer() {
    let locale = get_default_locale();
    let r1 = format_number(1_234_567.0, "#,##0,,", locale);
    let r2 = format_number(2_510_000.0, "#,##0,,", locale);
    let r3 = format_number(12_345_678.0, "#,##0,,", locale);

    assert_eq!(r1.text, "1");
    assert_eq!(r2.text, "3");
    assert_eq!(r3.text, "12");
}

// skip this test: not implemented yet
#[test]
#[ignore]
fn format_fraction_simple() {
    let locale = get_default_locale();
    let r1 = format_number(1.25, "# ?/?", locale);
    let r2 = format_number(2.5, "# ?/?", locale);
    let r3 = format_number(0.5, "# ?/?", locale);

    assert_eq!(r1.text, "1 1/4");
    assert_eq!(r2.text, "2 1/2");
    assert_eq!(r3.text, " 1/2");
}

#[test]
fn format_hash_only() {
    let locale = get_default_locale();
    let r1 = format_number(0.0, "#", locale);
    let r2 = format_number(12.0, "#", locale);
    let r3 = format_number(0.6, "#", locale);

    assert_eq!(r1.text, ""); // blank for zero
    assert_eq!(r2.text, "12");
    assert_eq!(r3.text, "1");
}

#[test]
fn format_aaa0() {
    let locale = get_default_locale();
    let r1 = format_number(7.0, "###0", locale);
    let r2 = format_number(0.4, "###0", locale);
    let r3 = format_number(1234.0, "###0", locale);

    assert_eq!(r1.text, "7");
    assert_eq!(r2.text, "0");
    assert_eq!(r3.text, "1234");
}

#[test]
fn format_0_hashhashhash() {
    let locale = get_default_locale();
    let r1 = format_number(1.2346, "0.###", locale);
    let r2 = format_number(1.2, "0.###", locale);
    let r3 = format_number(0.05, "0.###", locale);

    assert_eq!(r1.text, "1.235");
    assert_eq!(r2.text, "1.2");
    assert_eq!(r3.text, "0.05");
}

#[test]
fn format_hash_group_0_0hash() {
    let locale = get_default_locale();
    let r1 = format_number(1234.567, "#,##0.0#", locale);
    let r2 = format_number(1234.5, "#,##0.0#", locale);
    let r3 = format_number(12.0, "#,##0.0#", locale);

    assert_eq!(r1.text, "1,234.57");
    assert_eq!(r2.text, "1,234.5");
    assert_eq!(r3.text, "12.0");
}

// skip: not implemented yet
#[ignore]
#[test]
fn format_group_with_leading_hashes() {
    let locale = get_default_locale();
    let r1 = format_number(1234.5, "###,##0.00", locale);
    let r2 = format_number(12.0, "###,##0.00", locale);
    let r3 = format_number(0.2, "###,##0.00", locale);

    assert_eq!(r1.text, "1,234.50");
    assert_eq!(r2.text, "12.00");
    assert_eq!(r3.text, "0.20");
}

#[test]
fn format_scientific() {
    let locale = get_default_locale();
    let r1 = format_number(12_345.1, "0.###E+00", locale);
    let r2 = format_number(0.0123, "0.###E+00", locale);
    let r3 = format_number(1_000.0, "0.###E+00", locale);

    assert_eq!(r1.text, "1.235E+04");
    assert_eq!(r2.text, "1.23E-02");
    assert_eq!(r3.text, "1.E+03");
}

// skip test: Wrong rounding
#[test]
#[ignore]
fn format_scientific_failing() {
    let locale = get_default_locale();
    let r1 = format_number(12_345.0, "0.###E+00", locale);

    assert_eq!(r1.text, "1.235E+04");
}

// skip this test: not implemented yet
#[test]
#[ignore]
fn format_fraction_two_digit_den() {
    let locale = get_default_locale();
    let r1 = format_number(1.333, "# ?/??", locale);
    let r2 = format_number(1.2, "# ?/??", locale);
    let r3 = format_number(0.75, "# ?/??", locale);

    assert_eq!(r1.text, "1 1/3");
    assert_eq!(r2.text, "1 1/5");
    assert_eq!(r3.text, " 3/4");
}

// skip this test: not implemented yet
#[test]
#[ignore]
fn format_fraction_eighths() {
    let locale = get_default_locale();
    let r1 = format_number(1.25, "# ?/8", locale);
    let r2 = format_number(0.5, "# ?/8", locale);
    let r3 = format_number(2.75, "# ?/8", locale);

    assert_eq!(r1.text, "1 2/8");
    assert_eq!(r2.text, " 4/8");
    assert_eq!(r3.text, "2 6/8");
}

#[test]
fn format_0_hashhash_percent() {
    let locale = get_default_locale();
    let r1 = format_number(0.256, "0.##%", locale);
    let r2 = format_number(1.0, "0.##%", locale);
    let r3 = format_number(0.0043, "0.##%", locale);

    assert_eq!(r1.text, "25.6%");
    assert_eq!(r2.text, "100.%");
    assert_eq!(r3.text, "0.43%");
}

#[test]
fn format_millions_scale_decimal() {
    let locale = get_default_locale();
    let r1 = format_number(1_234_567.0, "#,##0,,.0#", locale);
    let r2 = format_number(12_000_000.0, "#,##0,,.0#", locale);
    let r3 = format_number(987_654_321.0, "#,##0,,.0#", locale);

    assert_eq!(r1.text, "1.23");
    assert_eq!(r2.text, "12.0");
    assert_eq!(r3.text, "987.65");
}
