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
fn simple_test() {
    let locale = get_default_locale();
    let bond_james_bond = format_number(7.0, "000", locale);
    assert_eq!(bond_james_bond.text, "007");
}

#[test]
fn test_general() {
    let locale = get_default_locale();
    assert_eq!(format_number(7.0, "General", locale).text, "7");
}

#[test]
fn simple_test_comma() {
    let locale = get_default_locale();
    assert_eq!(format_number(1007.0, "000", locale).text, "1007");
    assert_eq!(format_number(1008.0, "#", locale).text, "1008");
    assert_eq!(format_number(1009.0, "#,#", locale).text, "1,009");
    assert_eq!(
        format_number(12_345_678.0, "#,#", locale).text,
        "12,345,678"
    );
    assert_eq!(
        format_number(12_345_678.0, "0,0", locale).text,
        "12,345,678"
    );
    assert_eq!(format_number(1005.0, "00-00", locale).text, "10-05");
    assert_eq!(format_number(7.0, "0?0", locale).text, "0 7");
    assert_eq!(format_number(7.0, "0#0", locale).text, "07");
    assert_eq!(
        format_number(1234.0, "000 \"Millions\"", locale).text,
        "1234 Millions"
    );
    assert_eq!(
        format_number(1235.0, "#,000 \"Millions\"", locale).text,
        "1,235 Millions"
    );
    assert_eq!(format_number(1007.0, "0,00", locale).text, "1,007");
    assert_eq!(
        format_number(10_000_007.0, "0,00", locale).text,
        "10,000,007"
    );
}

#[test]
fn test_negative_numbers() {
    let locale = get_default_locale();
    assert_eq!(format_number(-123.0, "0.0", locale).text, "-123.0");
    assert_eq!(format_number(-3.0, "000.0", locale).text, "-003.0");
    assert_eq!(format_number(-0.00001, "000.0", locale).text, "000.0");
}

#[test]
fn test_decimal_part() {
    let locale = get_default_locale();
    assert_eq!(format_number(3.1, "0.00", locale).text, "3.10");
    // assert_eq!(format_number(3.1, "00-.-0?0", locale).text, "03-.-1 0");
}

#[test]
fn test_color() {
    let locale = get_default_locale();
    assert_eq!(format_number(3.1, "[blue]0.00", locale).text, "3.10");
    assert_eq!(format_number(3.1, "[blue]0.00", locale).color, Some(4));

    assert_eq!(format_number(3.1, "[Color42]0.00", locale).text, "3.10");
    assert_eq!(format_number(3.1, "[Color42]0.00", locale).color, Some(42));
}

#[test]
fn test_failed_to_parse_color() {
    let locale = get_default_locale();
    let error = Some("Problem parsing format string".to_string());
    assert_eq!(format_number(3.1, "[foo]0.00", locale).error, error);
    assert_eq!(format_number(3.1, "[Color999]0.00", locale).error, error);
    assert_eq!(format_number(3.1, "[Color42.5]0.00", locale).error, error);
}

#[test]
fn test_conditional() {
    let locale = get_default_locale();
    assert_eq!(format_number(42.00, "[=]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[<]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[>]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[<=]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[>=]0.00", locale).text, "42.00");
}

#[test]
fn test_failed_to_parse_conditional() {
    let locale = get_default_locale();
    let error = Some("Problem parsing format string".to_string());

    assert_eq!(format_number(42.00, "[=0.00", locale).error, error);
    assert_eq!(format_number(42.00, "[=", locale).error, error);
}

#[test]
fn test_string_double_quota() {
    let locale = get_default_locale();
    assert_eq!(
        format_number(42.00, "0 \"\"\"Millions\"\"\"", locale).text,
        "42 \"Millions\""
    );
}

#[test]
fn test_failed_to_parse_string() {
    let locale = get_default_locale();
    assert_eq!(
        format_number(42.00, "0 \"\"\"Millions\"\"", locale).error,
        Some("Problem parsing format string".to_string())
    );
}

#[test]
fn test_exponential_conditional() {
    let locale = get_default_locale();
    assert_eq!(format_number(42.00, "[=0.0e0]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[=0.0e00]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[=0.0e+0]0.00", locale).text, "42.00");
    assert_eq!(format_number(42.00, "[=0.0e-0]0.00", locale).text, "42.00");
}

#[test]
fn test_failed_to_parse_exponential_conditional() {
    let locale = get_default_locale();
    assert_eq!(
        format_number(42.00, "[=0.0ea]0.00", locale).error,
        Some("Problem parsing format string".to_string())
    );
}

#[test]
fn dollar_euro() {
    let locale = get_default_locale();
    let format = "[$€]#,##0.00";
    let t = format_number(3.1, format, locale);
    assert_eq!(t.text, "€3.10");
}

#[test]
fn test_currency_valid_formats() {
    let locale = get_default_locale();
    assert_eq!(format_number(2.34, "[$€]#,##0.00", locale).text, "€2.34");
    assert_eq!(format_number(3.0, "[$€]#,##0.00", locale).text, "€3.00");
    assert_eq!(format_number(42.0, "[$€]0", locale).text, "€42");
}

#[test]
fn test_failed_to_parse_currency() {
    let locale = get_default_locale();
    let error = Some("Problem parsing format string".to_string());
    assert_eq!(format_number(42.00, "[$", locale).error, error);
    assert_eq!(format_number(42.00, "[$€", locale).error, error);
    assert_eq!(format_number(42.00, "[$€0", locale).error, error);
}

#[test]
fn test_failed_to_parse_bracket() {
    let locale = get_default_locale();
    let error = Some("Problem parsing format string".to_string());
    assert_eq!(format_number(42.0, "[", locale).error, error);
}

#[test]
fn test_parts() {
    let locale = get_default_locale();
    assert_eq!(format_number(3.1, "0.00;(0.00);(-)", locale).text, "3.10");
    assert_eq!(
        format_number(-3.1, "0.00;(0.00);(-)", locale).text,
        "(3.10)"
    );
    assert_eq!(format_number(0.0, "0.00;(0.00);(-)", locale).text, "(-)");
}

#[test]
fn test_zero() {
    let locale = get_default_locale();
    assert_eq!(format_number(0.0, "$#,##0", locale).text, "$0");
    assert_eq!(format_number(-1.0 / 3.0, "0", locale).text, "0");
    assert_eq!(format_number(-1.0 / 3.0, "0;(0)", locale).text, "(0)");
}

#[test]
fn test_negative_currencies() {
    let locale = get_default_locale();
    assert_eq!(format_number(-23.0, "$#,##0", locale).text, "-$23");
}

#[test]
fn test_percent() {
    let locale = get_default_locale();
    assert_eq!(format_number(0.12, "0.00%", locale).text, "12.00%");
    assert_eq!(format_number(0.12, "0.00%%", locale).text, "1200.00%%");
}

#[test]
fn test_percent_correct_rounding() {
    let locale = get_default_locale();
    // Formatting does Excel rounding (15 significant digits)
    assert_eq!(
        format_number(0.1399999999999999, "0.0%", locale).text,
        "14.0%"
    );
    assert_eq!(
        format_number(-0.1399999999999999, "0.0%", locale).text,
        "-14.0%"
    );
    // Formatting does proper rounding
    assert_eq!(format_number(0.1399, "0.0%", locale).text, "14.0%");
    assert_eq!(format_number(-0.1399, "0.0%", locale).text, "-14.0%");
    assert_eq!(format_number(0.02666, "0.00%", locale).text, "2.67%");
    assert_eq!(format_number(0.0266, "0.00%", locale).text, "2.66%");
    assert_eq!(format_number(0.0233, "0.00%", locale).text, "2.33%");
    assert_eq!(format_number(0.02666, "0%", locale).text, "3%");
    assert_eq!(format_number(-0.02666, "0.00%", locale).text, "-2.67%");
    assert_eq!(format_number(-0.02666, "0%", locale).text, "-3%");

    // precision 0
    assert_eq!(format_number(0.135, "0%", locale).text, "14%");
    assert_eq!(format_number(0.13499, "0%", locale).text, "13%");
    assert_eq!(format_number(-0.135, "0%", locale).text, "-14%");
    assert_eq!(format_number(-0.13499, "0%", locale).text, "-13%");

    // precision 1
    assert_eq!(format_number(0.1345, "0.0%", locale).text, "13.5%");
    assert_eq!(format_number(0.1343, "0.0%", locale).text, "13.4%");
    assert_eq!(format_number(-0.1345, "0.0%", locale).text, "-13.5%");
    assert_eq!(format_number(-0.134499, "0.0%", locale).text, "-13.4%");
}

#[test]
fn test_scientific() {
    let locale = get_default_locale();
    assert_eq!(format_number(2.5e-14, "0.00E+0", locale).text, "2.50E-14");
    assert_eq!(format_number(3e-4, "0.00E+00", locale).text, "3.00E-04");
}

#[test]
fn test_currency() {
    let locale = get_default_locale();
    assert_eq!(format_number(123.1, "$#,##0", locale).text, "$123");
    assert_eq!(format_number(123.1, "#,##0 €", locale).text, "123 €");
}

#[test]
fn test_date() {
    let locale = get_default_locale();
    assert_eq!(
        format_number(41181.0, "dd/mm/yyyy", locale).text,
        "29/09/2012"
    );
    assert_eq!(
        format_number(41181.0, "dd-mm-yyyy", locale).text,
        "29-09-2012"
    );
    assert_eq!(
        format_number(41304.0, "dd-mm-yyyy", locale).text,
        "30-01-2013"
    );
    assert_eq!(
        format_number(42657.0, "dd-mm-yyyy", locale).text,
        "14-10-2016"
    );

    assert_eq!(
        format_number(41181.0, "dddd-mmmm-yyyy", locale).text,
        "Saturday-September-2012"
    );
    assert_eq!(
        format_number(41181.0, "ddd-mmm-yy", locale).text,
        "Sat-Sep-12"
    );
    assert_eq!(
        format_number(41181.0, "ddd-mmmmm-yy", locale).text,
        "Sat-S-12"
    );
    assert_eq!(
        format_number(41181.0, "ddd-mmmmmmm-yy", locale).text,
        "Sat-September-12"
    );
}

#[test]
fn test_german_locale() {
    let locale = get_locale("de").expect("");
    assert_eq!(format_number(1234.56, "General", locale).text, "1234,56");
}
