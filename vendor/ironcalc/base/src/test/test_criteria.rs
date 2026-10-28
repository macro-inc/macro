#![allow(clippy::unwrap_used)]

use crate::calc_result::CalcResult;
use crate::functions::util::build_criteria;
use crate::locale::{get_locale, Locale};

fn en_locale() -> &'static Locale {
    get_locale("en").unwrap()
}

// Tests for build_criteria
// ------------------------
//
// Note that any test here is mostly for documentation purposes.
// A real test must be done in Excel.
//
// `build_criteria` takes a string ('criteria') and returns a function ('fn_criteria') that takes a CalcResult and returns a boolean.
//
// For instance if criteria is "123" we want all cells that contain the number "123". Then
//
// let fn_criteria = build_criteria(&CalcResult::Number(123));
//
// Then fn_criteria(calc_result) will return true every time calc_result is the number "123"
//
// There are different types of criteria
//
// * We want the cells that are equal to a value (say a number, string, bool or an error).
//   We can build those with a calc_result of the type (i.e CalcResult::Number(123))
//   or we can use a string preceded by "=" like CalcResult::String("=123")
// * We can use inequality signs "<", ">", "<=", ">=" or "<>"
// * If you use "=" or "<>" you can use wildcards (like "=*brown")
//
// All of them are case insensitive.

#[test]
fn test_build_criteria_is_number() {
    let c = CalcResult::Number(42.0);
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Number(42.0)));
    assert!(fn_criteria(&CalcResult::String("42".to_string())));
    assert!(fn_criteria(&CalcResult::String("42.00".to_string())));
    assert!(!fn_criteria(&CalcResult::Number(2.0)));

    let c = CalcResult::String("=42".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Number(42.0)));
    assert!(fn_criteria(&CalcResult::String("42".to_string())));
    assert!(fn_criteria(&CalcResult::String("42.00".to_string())));
    assert!(!fn_criteria(&CalcResult::Number(2.0)));
}

#[test]
fn test_build_criteria_is_bool() {
    let c = CalcResult::Boolean(true);
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Boolean(true)));
    assert!(!fn_criteria(&CalcResult::String("true".to_string())));
    assert!(!fn_criteria(&CalcResult::Number(1.0)));

    let c = CalcResult::String("=True".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Boolean(true)));
    assert!(!fn_criteria(&CalcResult::String("true".to_string())));
    assert!(!fn_criteria(&CalcResult::Number(1.0)));
}

#[test]
fn test_build_criteria_is_less_than() {
    let c = CalcResult::String("<100".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(!fn_criteria(&CalcResult::Boolean(true)));
    assert!(!fn_criteria(&CalcResult::String("23".to_string())));
    assert!(fn_criteria(&CalcResult::Number(1.0)));
    assert!(!fn_criteria(&CalcResult::Number(101.0)));
}

#[test]
fn test_build_criteria_is_less_wildcard() {
    let c = CalcResult::String("=D* G*".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::String(
        "Diarmuid Glynn".to_string()
    )));
    assert!(fn_criteria(&CalcResult::String(
        "Daniel Gonzalez".to_string()
    )));
    assert!(!fn_criteria(&CalcResult::String(
        "DanielGonzalez".to_string()
    )));
    assert!(!fn_criteria(&CalcResult::String(
        " Daniel Gonzalez".to_string()
    )));
}

// Date-string criteria. Excel parses literals like "7/31/2023" into a serial
// (45138 in this case) and applies the comparison numerically against
// date-serial cells. These tests cover all six branches of build_criteria.
//
// The neighbouring serials used below:
//   45137 = 7/30/2023
//   45138 = 7/31/2023  (the criterion target)
//   45139 = 8/1/2023

#[test]
fn test_build_criteria_date_less_than() {
    let c = CalcResult::String("<7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45139.0)));
}

#[test]
fn test_build_criteria_date_less_or_equal() {
    let c = CalcResult::String("<=7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45139.0)));
}

#[test]
fn test_build_criteria_date_greater_than() {
    let c = CalcResult::String(">7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria(&CalcResult::Number(45138.0)));
    assert!(fn_criteria(&CalcResult::Number(45139.0)));
}

#[test]
fn test_build_criteria_date_greater_or_equal() {
    let c = CalcResult::String(">=7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(fn_criteria(&CalcResult::Number(45139.0)));
}

#[test]
fn test_build_criteria_date_not_equal() {
    let c = CalcResult::String("<>7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria(&CalcResult::Number(45138.0)));
    assert!(fn_criteria(&CalcResult::Number(45139.0)));
}

#[test]
fn test_build_criteria_date_equal() {
    let c = CalcResult::String("7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45139.0)));

    // Same with a leading "=" prefix.
    let c = CalcResult::String("=7/31/2023".to_string());
    let fn_criteria = build_criteria(&c, en_locale());
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45139.0)));
}

// Locale coverage for the date-parse fallback.
//
// `parse_date` decides D/M/Y vs M/D/Y by inspecting the locale's
// `date_formats.short`. The tests below pick locales whose short formats are
// known: `en` -> "m/d/yy", `en-GB` -> "dd/mm/yyyy", `es` -> "d/m/yy",
// `de` -> "dd.mm.yy". They guard against three regression classes:
//   1. The locale parameter being dropped or hard-coded to "en".
//   2. The `.` separator path (used by `de`) being broken.
//   3. ISO dates becoming locale-dependent.
//
// Serial numbers used (Excel 1900 system, anchored on 45108 = 2023-07-01):
//   44941 = 2023-01-15
//   44992 = 2023-03-07
//   45110 = 2023-07-03
//   45138 = 2023-07-31

#[test]
fn test_build_criteria_date_dmy_locale_en_gb() {
    // "31/7/2023" is unambiguously a date under en-GB (D/M/Y), but under en
    // (M/D/Y) the would-be month is 31 and the parse must fail.
    let en_gb = get_locale("en-GB").unwrap();
    let c = CalcResult::String("<31/7/2023".to_string());
    let fn_criteria = build_criteria(&c, en_gb);
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria(&CalcResult::Number(45138.0)));

    // Under en, the same string is not a parseable date so it falls through to
    // string comparison; numeric cells must never match.
    let fn_criteria_en = build_criteria(&c, en_locale());
    assert!(!fn_criteria_en(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria_en(&CalcResult::Number(45138.0)));
}

#[test]
fn test_build_criteria_date_dmy_locale_es() {
    // Spanish is also D/M/Y. Cover equality and >= to exercise different
    // branches than the en-GB test above.
    let es = get_locale("es").unwrap();
    let c = CalcResult::String("31/7/2023".to_string());
    let fn_criteria = build_criteria(&c, es);
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));

    let c = CalcResult::String(">=31/7/2023".to_string());
    let fn_criteria = build_criteria(&c, es);
    assert!(!fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
}

#[test]
fn test_build_criteria_date_dot_separator_locale_de() {
    // German short format is "dd.mm.yy" — the `.` separator is a third path
    // through parse_date, separate from `/` and `-`.
    let de = get_locale("de").unwrap();
    let c = CalcResult::String("<=31.7.2023".to_string());
    let fn_criteria = build_criteria(&c, de);
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(fn_criteria(&CalcResult::Number(45138.0)));
    assert!(!fn_criteria(&CalcResult::Number(45139.0)));

    let c = CalcResult::String("<>31.7.2023".to_string());
    let fn_criteria = build_criteria(&c, de);
    assert!(fn_criteria(&CalcResult::Number(45137.0)));
    assert!(!fn_criteria(&CalcResult::Number(45138.0)));
}

#[test]
fn test_build_criteria_date_iso_is_locale_independent() {
    // ISO yyyy-mm-dd must parse the same way under every locale. Without this
    // guard, a regression that wrongly applied the D/M/Y swap to ISO dates
    // would slip through.
    let iso = CalcResult::String("2023-07-31".to_string());
    for id in ["en", "en-GB", "es", "de", "fr", "it"] {
        let loc = get_locale(id).unwrap();
        let fn_criteria = build_criteria(&iso, loc);
        assert!(
            fn_criteria(&CalcResult::Number(45138.0)),
            "ISO date should match 45138 under locale {id}"
        );
        assert!(
            !fn_criteria(&CalcResult::Number(45137.0)),
            "ISO date should not match 45137 under locale {id}"
        );
    }
}

#[test]
fn test_build_criteria_date_locale_disambiguation() {
    // "3/7/2023" is ambiguous: en reads March 7 (44992), es reads July 3 (45110).
    // Pin both interpretations to make sure the locale is actually consulted
    // rather than silently defaulted.
    let c = CalcResult::String("3/7/2023".to_string());

    let fn_en = build_criteria(&c, en_locale());
    assert!(fn_en(&CalcResult::Number(44992.0))); // March 7
    assert!(!fn_en(&CalcResult::Number(45110.0))); // July 3

    let es = get_locale("es").unwrap();
    let fn_es = build_criteria(&c, es);
    assert!(!fn_es(&CalcResult::Number(44992.0)));
    assert!(fn_es(&CalcResult::Number(45110.0)));
}

#[test]
fn test_build_criteria_date_localized_month_name() {
    // Spanish abbreviates January as "ene". parse_month consults the locale's
    // months_short list, so this only matches under the matching locale.
    let es = get_locale("es").unwrap();
    let c = CalcResult::String("=15-ene-2023".to_string());
    let fn_es = build_criteria(&c, es);
    assert!(fn_es(&CalcResult::Number(44941.0))); // 2023-01-15
    assert!(!fn_es(&CalcResult::Number(44942.0)));

    // Under en, "ene" is not a known month — parse fails and the criterion
    // falls back to string equality, so no Number cell should match.
    let fn_en = build_criteria(&c, en_locale());
    assert!(!fn_en(&CalcResult::Number(44941.0)));
}
