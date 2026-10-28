#![allow(clippy::unwrap_used)]

use crate::model::Model;
use crate::test::util::new_empty_model;

// Cursor rules:
// * If nothing is cycled, start and end are returned unchanged.
// * A collapsed cursor lands collapsed at the end of the cycled reference.
// * A selection spans all the cycled references in the new text
//   (start of the first one to end of the last one).

#[test]
fn non_formulas() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("hola", 2, 2),
        Ok(("hola".to_string(), 2, 2))
    );
}

#[test]
fn simple_a1_reference() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=A1", 1, 1),
        Ok(("=$A$1".to_string(), 5, 5))
    );
}

#[test]
fn simple_dad1_reference() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=$A$1", 1, 1),
        Ok(("=A$1".to_string(), 4, 4))
    );
}

#[test]
fn simple_ad1_reference() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=A$1", 1, 1),
        Ok(("=$A1".to_string(), 4, 4))
    );
}

#[test]
fn simple_da1_reference() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=$A1", 1, 1),
        Ok(("=A1".to_string(), 3, 3))
    );
}

// Ranges

#[test]
fn range_full_cycle() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=C3:D5", 1, 1),
        Ok(("=$C$3:$D$5".to_string(), 10, 10))
    );
    assert_eq!(
        model.cycle_reference("=$C$3:$D$5", 1, 1),
        Ok(("=C$3:D$5".to_string(), 8, 8))
    );
    assert_eq!(
        model.cycle_reference("=C$3:D$5", 1, 1),
        Ok(("=$C3:$D5".to_string(), 8, 8))
    );
    assert_eq!(
        model.cycle_reference("=$C3:$D5", 1, 1),
        Ok(("=C3:D5".to_string(), 6, 6))
    );
}

#[test]
fn range_cursor_on_colon() {
    let model = new_empty_model();

    // "=C3:D5"
    //      ^ cursor on the colon still targets the whole range
    assert_eq!(
        model.cycle_reference("=C3:D5", 3, 3),
        Ok(("=$C$3:$D$5".to_string(), 10, 10))
    );
}

#[test]
fn range_cursor_on_second_cell() {
    let model = new_empty_model();

    // cursor inside "D5" cycles the whole range, not just the right end
    assert_eq!(
        model.cycle_reference("=C3:D5", 5, 5),
        Ok(("=$C$3:$D$5".to_string(), 10, 10))
    );
}

#[test]
fn range_with_sheet_name() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=Sheet1!C3:D5", 8, 8),
        Ok(("=Sheet1!$C$3:$D$5".to_string(), 17, 17))
    );
}

// Different cursor positions

#[test]
fn cursor_at_end_of_reference() {
    let model = new_empty_model();

    // "=A1" cursor after the "1", still touching the reference
    assert_eq!(
        model.cycle_reference("=A1", 3, 3),
        Ok(("=$A$1".to_string(), 5, 5))
    );
}

#[test]
fn cursor_in_the_middle_of_reference() {
    let model = new_empty_model();

    // "=A1" cursor between "A" and "1"
    assert_eq!(
        model.cycle_reference("=A1", 2, 2),
        Ok(("=$A$1".to_string(), 5, 5))
    );
}

#[test]
fn cursor_at_end_of_formula() {
    let model = new_empty_model();

    // cursor at the very end of the text, touching the last reference
    assert_eq!(
        model.cycle_reference("=SUM(A1:B2)+C3", 14, 14),
        Ok(("=SUM(A1:B2)+$C$3".to_string(), 16, 16))
    );
}

#[test]
fn cursor_on_function_name() {
    let model = new_empty_model();

    // cursor inside "SUM", not touching any reference: nothing happens
    assert_eq!(
        model.cycle_reference("=SUM(A1:B2)+C3", 2, 2),
        Ok(("=SUM(A1:B2)+C3".to_string(), 2, 2))
    );
}

#[test]
fn cursor_on_operator_touching_previous_reference() {
    let model = new_empty_model();

    // "=A1+B2" cursor between "1" and "+" touches A1
    assert_eq!(
        model.cycle_reference("=A1+B2", 3, 3),
        Ok(("=$A$1+B2".to_string(), 5, 5))
    );
}

#[test]
fn cursor_on_operator_touching_next_reference() {
    let model = new_empty_model();

    // "=A1+B2" cursor between "+" and "B" touches B2
    assert_eq!(
        model.cycle_reference("=A1+B2", 4, 4),
        Ok(("=A1+$B$2".to_string(), 8, 8))
    );
}

// Formulas

#[test]
fn formula_with_function() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=SUM(C3:D5)", 6, 6),
        Ok(("=SUM($C$3:$D$5)".to_string(), 14, 14))
    );
}

#[test]
fn formula_with_arithmetic() {
    let model = new_empty_model();

    // cursor on "B$2" inside a larger expression
    assert_eq!(
        model.cycle_reference("=A1*2+SIN(B$2)", 11, 11),
        Ok(("=A1*2+SIN($B2)".to_string(), 13, 13))
    );
}

#[test]
fn formula_numbers_are_not_references() {
    let model = new_empty_model();

    // cursor on the number "2": nothing to cycle
    assert_eq!(
        model.cycle_reference("=A1*2", 5, 5),
        Ok(("=A1*2".to_string(), 5, 5))
    );
}

#[test]
fn not_a_formula_with_reference_looking_text() {
    let model = new_empty_model();

    // no leading "=": plain text is left alone
    assert_eq!(
        model.cycle_reference("C3:D5", 2, 2),
        Ok(("C3:D5".to_string(), 2, 2))
    );
}

// Multiple references

#[test]
fn multiple_references_cursor_picks_first() {
    let model = new_empty_model();

    // cursor on A1 only cycles A1
    assert_eq!(
        model.cycle_reference("=A1+B2", 1, 1),
        Ok(("=$A$1+B2".to_string(), 5, 5))
    );
}

#[test]
fn multiple_references_cursor_picks_second() {
    let model = new_empty_model();

    // cursor on B2 only cycles B2
    assert_eq!(
        model.cycle_reference("=A1+B2", 5, 5),
        Ok(("=A1+$B$2".to_string(), 8, 8))
    );
}

#[test]
fn selection_spanning_multiple_references() {
    let model = new_empty_model();

    // selecting the whole "A1+B2" cycles both references;
    // the new selection spans both cycled references
    assert_eq!(
        model.cycle_reference("=A1+B2", 1, 6),
        Ok(("=$A$1+$B$2".to_string(), 1, 10))
    );
}

#[test]
fn selection_cycles_each_reference_from_its_own_state() {
    let model = new_empty_model();

    // each reference advances one step in the cycle independently
    assert_eq!(
        model.cycle_reference("=$A$1+B2", 1, 8),
        Ok(("=A$1+$B$2".to_string(), 1, 9))
    );
}

#[test]
fn selection_spanning_range_and_cell() {
    let model = new_empty_model();

    // the new selection goes from the start of the first cycled reference
    // to the end of the last one
    assert_eq!(
        model.cycle_reference("=SUM(A1:B2)+C3", 0, 14),
        Ok(("=SUM($A$1:$B$2)+$C$3".to_string(), 5, 20))
    );
}

#[test]
fn same_reference_twice() {
    let model = new_empty_model();

    // only the occurrence under the cursor is cycled
    assert_eq!(
        model.cycle_reference("=A1+A1", 5, 5),
        Ok(("=A1+$A$1".to_string(), 8, 8))
    );
}

#[test]
fn cursor_at_equals() {
    let model = new_empty_model();

    // cursor at equals sign: nothing to cycle
    assert_eq!(
        model.cycle_reference("=H8", 0, 0),
        Ok(("=H8".to_string(), 0, 0))
    );
}

#[test]
fn cursor_out_of_bounds() {
    let model = new_empty_model();

    // cursor out of bounds: nothing to cycle
    assert_eq!(
        model.cycle_reference("=F5", 10, 10),
        Err("Cursor index out of bounds".to_string())
    );
}

// Different locales

#[test]
fn de_locale_decimal_comma_is_one_number() {
    let model = Model::new_empty("model", "de", "UTC", "en").unwrap();

    // in the de locale "2,5" is a single number, not "2" and "5"
    assert_eq!(
        model.cycle_reference("=A1+2,5", 2, 2),
        Ok(("=$A$1+2,5".to_string(), 5, 5))
    );
    // cursor on the number: nothing to cycle
    assert_eq!(
        model.cycle_reference("=A1+2,5", 6, 6),
        Ok(("=A1+2,5".to_string(), 6, 6))
    );
}

#[test]
fn de_locale_semicolon_argument_separator() {
    let model = Model::new_empty("model", "de", "UTC", "en").unwrap();

    assert_eq!(
        model.cycle_reference("=SUM(A1:B2;C3)", 12, 12),
        Ok(("=SUM(A1:B2;$C$3)".to_string(), 15, 15))
    );
}

// Different languages

#[test]
fn es_model_keeps_function_and_boolean_names() {
    let model = Model::new_empty("model", "es", "UTC", "es").unwrap();

    // SUMA and VERDADERO are left as they are, the range is cycled
    assert_eq!(
        model.cycle_reference("=SUMA(A1:B2;VERDADERO)", 7, 7),
        Ok(("=SUMA($A$1:$B$2;VERDADERO)".to_string(), 15, 15))
    );
}

#[test]
fn es_boolean_is_not_a_reference() {
    let model = Model::new_empty("model", "es", "UTC", "es").unwrap();

    // cursor on VERDADERO: it is a boolean, not a reference
    assert_eq!(
        model.cycle_reference("=SUMA(A1:B2;VERDADERO)", 15, 15),
        Ok(("=SUMA(A1:B2;VERDADERO)".to_string(), 15, 15))
    );
}

// Sheet names

#[test]
fn cycled_references_are_uppercased() {
    let model = new_empty_model();

    // an incomplete formula being typed: the reference is normalized
    // to uppercase, the rest of the text is left alone
    assert_eq!(
        model.cycle_reference("=sum(a1", 7, 7),
        Ok(("=sum($A$1".to_string(), 9, 9))
    );
    assert_eq!(
        model.cycle_reference("=d4+1", 1, 1),
        Ok(("=$D$4+1".to_string(), 5, 5))
    );
}

#[test]
fn lowercase_sheet_name_keeps_its_casing() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("=sheet1!d4", 5, 5),
        Ok(("=sheet1!$D$4".to_string(), 12, 12))
    );
}

#[test]
fn quoted_sheet_name() {
    let model = new_empty_model();

    assert_eq!(
        model.cycle_reference("='My Sheet'!A1", 13, 13),
        Ok(("='My Sheet'!$A$1".to_string(), 16, 16))
    );
}

#[test]
fn quoted_sheet_name_with_escaped_quote() {
    let model = new_empty_model();

    // the sheet is called "It's"; the quote is escaped by doubling it
    assert_eq!(
        model.cycle_reference("='It''s'!A1", 10, 10),
        Ok(("='It''s'!$A$1".to_string(), 13, 13))
    );
}
