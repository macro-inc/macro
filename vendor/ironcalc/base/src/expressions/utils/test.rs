use super::*;

#[test]
fn test_column_to_number() {
    assert_eq!(column_to_number("A"), Ok(1));
    assert_eq!(column_to_number("Z"), Ok(26));
    assert_eq!(column_to_number("AA"), Ok(27));
    assert_eq!(column_to_number("AB"), Ok(28));
    assert_eq!(column_to_number("XFD"), Ok(16_384));
    assert_eq!(column_to_number("XFD"), Ok(LAST_COLUMN));

    assert_eq!(
        column_to_number("XFE"),
        Err("Column is not valid.".to_string())
    );
    assert_eq!(
        column_to_number(""),
        Err("Column identifier cannot be empty.".to_string())
    );
    assert_eq!(
        column_to_number("💥"),
        Err("Column identifier must be ASCII.".to_string())
    );
    assert_eq!(
        column_to_number("A1"),
        Err("Column identifier can use only A-Z characters".to_string())
    );
    assert_eq!(
        column_to_number("ab"),
        Err("Column identifier can use only A-Z characters".to_string())
    );
}

#[test]
fn test_is_valid_column() {
    assert!(is_valid_column("A"));
    assert!(is_valid_column("AA"));
    assert!(is_valid_column("XFD"));

    assert!(!is_valid_column("a"));
    assert!(!is_valid_column("aa"));
    assert!(!is_valid_column("xfd"));

    assert!(!is_valid_column("1"));
    assert!(!is_valid_column("-1"));
    assert!(!is_valid_column("XFE"));
    assert!(!is_valid_column(""));
}

#[test]
fn test_number_to_column() {
    assert_eq!(number_to_column(1), Some("A".to_string()));
    assert_eq!(number_to_column(26), Some("Z".to_string()));
    assert_eq!(number_to_column(27), Some("AA".to_string()));
    assert_eq!(number_to_column(28), Some("AB".to_string()));
    assert_eq!(number_to_column(16_384), Some("XFD".to_string()));

    assert_eq!(number_to_column(0), None);
    assert_eq!(number_to_column(16_385), None);
}

#[test]
fn test_references() {
    assert_eq!(
        parse_reference_a1("A1"),
        Some(ParsedReference {
            row: 1,
            column: 1,
            absolute_column: false,
            absolute_row: false
        })
    );
}

#[test]
fn test_references_1() {
    assert_eq!(
        parse_reference_a1("AB$23"),
        Some(ParsedReference {
            row: 23,
            column: 28,
            absolute_column: false,
            absolute_row: true
        })
    );
}

#[test]
fn test_references_2() {
    assert_eq!(
        parse_reference_a1("$AB123"),
        Some(ParsedReference {
            row: 123,
            column: 28,
            absolute_column: true,
            absolute_row: false
        })
    );
}

#[test]
fn test_references_3() {
    assert_eq!(
        parse_reference_a1("$AB$123"),
        Some(ParsedReference {
            row: 123,
            column: 28,
            absolute_column: true,
            absolute_row: true
        })
    );
}

#[test]
fn test_r1c1_references() {
    assert_eq!(
        parse_reference_r1c1("R1C1"),
        Some(ParsedReference {
            row: 1,
            column: 1,
            absolute_column: true,
            absolute_row: true
        })
    );
}

#[test]
fn test_r1c1_references_1() {
    assert_eq!(
        parse_reference_r1c1("R32C[-3]"),
        Some(ParsedReference {
            row: 32,
            column: -3,
            absolute_column: false,
            absolute_row: true
        })
    );
}

#[test]
fn test_r1c1_references_2() {
    assert_eq!(
        parse_reference_r1c1("R32C"),
        Some(ParsedReference {
            row: 32,
            column: 0,
            absolute_column: true,
            absolute_row: true
        })
    );
}

#[test]
fn test_r1c1_references_3() {
    assert_eq!(
        parse_reference_r1c1("R[-2]C[-3]"),
        Some(ParsedReference {
            row: -2,
            column: -3,
            absolute_column: false,
            absolute_row: false
        })
    );
}

#[test]
fn test_r1c1_references_4() {
    assert_eq!(
        parse_reference_r1c1("RC[-3]"),
        Some(ParsedReference {
            row: 0,
            column: -3,
            absolute_column: false,
            absolute_row: true
        })
    );
}

#[test]
fn test_names() {
    assert!(is_valid_identifier("hola1"));
    assert!(is_valid_identifier("hola_1"));
    assert!(is_valid_identifier("hola.1"));
    assert!(is_valid_identifier("sum_total_"));
    assert!(is_valid_identifier("sum.total"));
    assert!(is_valid_identifier("_hola"));
    assert!(is_valid_identifier("t"));
    assert!(is_valid_identifier("q"));
    assert!(is_valid_identifier("true_that"));
    assert!(is_valid_identifier("true1"));

    // weird names apparently  valid in Excel
    assert!(is_valid_identifier("_"));
    assert!(is_valid_identifier("\\hola1"));
    assert!(is_valid_identifier("__"));
    assert!(is_valid_identifier("_."));
    assert!(is_valid_identifier("_1"));
    assert!(is_valid_identifier("\\."));
    assert!(is_valid_identifier("truñe"));

    // invalid
    assert!(!is_valid_identifier("true"));
    assert!(!is_valid_identifier("false"));
    assert!(!is_valid_identifier("SUM THAT"));
    assert!(!is_valid_identifier("A23"));
    assert!(!is_valid_identifier("R1C1"));
    assert!(!is_valid_identifier("R23C"));
    assert!(!is_valid_identifier("R"));
    assert!(!is_valid_identifier("c"));
    assert!(!is_valid_identifier("1true"));

    assert!(!is_valid_identifier("test€"));
    assert!(!is_valid_identifier("tr&ue"));

    assert!(!is_valid_identifier("LOG10"));
}

#[test]
fn test_a1_identifier_allows_r_and_c() {
    // is_valid_a1_identifier permits "R" and "C" (valid LAMBDA/LET variable names).
    assert!(is_valid_a1_identifier("R"));
    assert!(is_valid_a1_identifier("r"));
    assert!(is_valid_a1_identifier("C"));
    assert!(is_valid_a1_identifier("c"));
    // All other is_valid_identifier rules still apply.
    assert!(!is_valid_a1_identifier("R1C1"));
    assert!(!is_valid_a1_identifier("A23"));
    assert!(!is_valid_a1_identifier("true"));
}
