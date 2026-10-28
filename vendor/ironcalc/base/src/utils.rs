use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::token::get_error_by_name;
use crate::expressions::types::CellReferenceIndex;
use crate::language::Language;
use crate::number_format::parse_finite_number;

use crate::{
    expressions::{
        lexer::{Lexer, LexerMode},
        token::TokenType,
    },
    language::get_language,
    locale::Locale,
};

#[derive(Debug, Eq, PartialEq)]
pub enum ParsedReference {
    CellReference(CellReferenceIndex),
    Range(CellReferenceIndex, CellReferenceIndex),
}

impl ParsedReference {
    /// Parses reference in formula format. For example:  `Sheet1!A1`, `Sheet1!$A$1:$B$9`.
    /// Absolute references (`$`) do not affect parsing.
    ///
    /// # Arguments
    ///
    /// * `sheet_index_context` - if available, sheet index can be provided so references
    ///   without explicit sheet name can be recognized
    /// * `reference` - text string to parse as reference
    /// * `locale` - locale that will be used to set-up parser
    /// * `get_sheet_index_by_name` - function that allows to translate sheet name to index
    pub(crate) fn parse_reference_formula<F: Fn(&str) -> Option<u32>>(
        sheet_index_context: Option<u32>,
        reference: &str,
        locale: &Locale,
        get_sheet_index_by_name: F,
    ) -> Result<ParsedReference, String> {
        #[allow(clippy::expect_used)]
        let language = get_language("en").expect("");
        let mut lexer = Lexer::new(reference, LexerMode::A1, locale, language);

        let reference_token = lexer.next_token();
        let eof_token = lexer.next_token();

        if TokenType::EOF != eof_token {
            return Err("Invalid reference. Expected only one token.".to_string());
        }

        match reference_token {
            TokenType::Reference {
                sheet: sheet_name,
                column: column_id,
                row: row_id,
                ..
            } => {
                let sheet_index;
                if let Some(name) = sheet_name {
                    match get_sheet_index_by_name(&name) {
                        Some(i) => sheet_index = i,
                        None => {
                            return Err(format!(
                                "Invalid reference. Sheet \"{}\" could not be found.",
                                name.as_str(),
                            ));
                        }
                    }
                } else if let Some(sheet_index_context) = sheet_index_context {
                    sheet_index = sheet_index_context;
                } else {
                    return Err(
                        "Reference doesn't contain sheet name and relative cell is not known."
                            .to_string(),
                    );
                }

                Ok(ParsedReference::CellReference(CellReferenceIndex {
                    sheet: sheet_index,
                    row: row_id,
                    column: column_id,
                }))
            }
            TokenType::Range {
                sheet: sheet_name,
                left,
                right,
            } => {
                let sheet_index;
                if let Some(name) = sheet_name {
                    match get_sheet_index_by_name(&name) {
                        Some(i) => sheet_index = i,
                        None => {
                            return Err(format!(
                                "Invalid reference. Sheet \"{}\" could not be found.",
                                name.as_str(),
                            ));
                        }
                    }
                } else if let Some(sheet_index_context) = sheet_index_context {
                    sheet_index = sheet_index_context;
                } else {
                    return Err(
                        "Reference doesn't contain sheet name and relative cell is not known."
                            .to_string(),
                    );
                }

                Ok(ParsedReference::Range(
                    CellReferenceIndex {
                        sheet: sheet_index,
                        row: left.row,
                        column: left.column,
                    },
                    CellReferenceIndex {
                        sheet: sheet_index,
                        row: right.row,
                        column: right.column,
                    },
                ))
            }
            _ => Err("Invalid reference. First token is not a reference.".to_string()),
        }
    }

    /// Parses a reference in R1C1 notation, the way a user writes it. For
    /// example: `R1C1`, `Sheet1!R2C3:R5C7`, `R[-1]C[2]`, `RC[-1]`, `R3`, `C[1]:C[2]`.
    ///
    /// A number after `R` or `C` is the row or column itself, a number in
    /// brackets is an offset from `cell`, and no number at all means the row
    /// or column of `cell`. `R` on its own is a whole row and `C` a whole
    /// column. Without a sheet name the reference is in the sheet of `cell`.
    ///
    /// An offset that leaves the sheet comes back in by the opposite side, as
    /// in Excel: one row above the first row is the last row.
    ///
    /// # Arguments
    ///
    /// * `cell` - the cell the reference is relative to
    /// * `reference` - text string to parse as reference
    /// * `get_sheet_index_by_name` - function that allows to translate sheet name to index
    pub(crate) fn parse_r1c1_reference<F: Fn(&str) -> Option<u32>>(
        cell: CellReferenceIndex,
        reference: &str,
        get_sheet_index_by_name: F,
    ) -> Result<ParsedReference, String> {
        let (sheet_name, reference) = split_sheet_name(reference)?;
        let sheet = match sheet_name {
            Some(name) => get_sheet_index_by_name(&name).ok_or_else(|| {
                format!("Invalid reference. Sheet \"{name}\" could not be found.")
            })?,
            None => cell.sheet,
        };

        let text = reference.as_bytes();
        let mut position = 0;
        let first = parse_r1c1_part(text, &mut position, &cell)?;
        let second = if text.get(position) == Some(&b':') {
            position += 1;
            Some(parse_r1c1_part(text, &mut position, &cell)?)
        } else {
            None
        };
        if position != text.len() {
            return Err("Invalid reference. Expected end of reference.".to_string());
        }

        let (row1, column1, row2, column2) = match (first, second) {
            (R1C1Part::Cell(row, column), None) => {
                return Ok(ParsedReference::CellReference(CellReferenceIndex {
                    sheet,
                    row,
                    column,
                }));
            }
            (R1C1Part::Cell(row1, column1), Some(R1C1Part::Cell(row2, column2))) => {
                (row1, column1, row2, column2)
            }
            (R1C1Part::Row(row), None) => (row, 1, row, LAST_COLUMN),
            (R1C1Part::Row(row1), Some(R1C1Part::Row(row2))) => (row1, 1, row2, LAST_COLUMN),
            (R1C1Part::Column(column), None) => (1, column, LAST_ROW, column),
            (R1C1Part::Column(column1), Some(R1C1Part::Column(column2))) => {
                (1, column1, LAST_ROW, column2)
            }
            _ => {
                return Err(
                    "Invalid reference. The two ends of the range are of different kind."
                        .to_string(),
                );
            }
        };
        Ok(ParsedReference::Range(
            CellReferenceIndex {
                sheet,
                row: row1.min(row2),
                column: column1.min(column2),
            },
            CellReferenceIndex {
                sheet,
                row: row1.max(row2),
                column: column1.max(column2),
            },
        ))
    }
}

/// One end of a reference in R1C1 notation.
enum R1C1Part {
    /// `R2C3`: row and column
    Cell(i32, i32),
    /// `R2`: a whole row
    Row(i32),
    /// `C3`: a whole column
    Column(i32),
}

/// Splits `Sheet1!R1C1` or `'My sheet'!R1C1` into the name of the sheet and
/// the rest. A quote in a quoted name is written twice.
fn split_sheet_name(reference: &str) -> Result<(Option<String>, &str), String> {
    let Some(quoted) = reference.strip_prefix('\'') else {
        return Ok(match reference.split_once('!') {
            Some((name, rest)) => (Some(name.to_string()), rest),
            None => (None, reference),
        });
    };
    let mut name = String::new();
    let mut chars = quoted.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if c != '\'' {
            name.push(c);
        } else if matches!(chars.peek(), Some((_, '\''))) {
            name.push('\'');
            chars.next();
        } else {
            return match quoted[index + 1..].strip_prefix('!') {
                Some(rest) => Ok((Some(name), rest)),
                None => Err("Invalid reference. Expected '!' after the sheet name.".to_string()),
            };
        }
    }
    Err("Invalid reference. The name of the sheet is not closed.".to_string())
}

/// Reads one end of a reference in R1C1 notation starting at `position`,
/// which is left just after it.
fn parse_r1c1_part(
    text: &[u8],
    position: &mut usize,
    cell: &CellReferenceIndex,
) -> Result<R1C1Part, String> {
    let is_letter = |position: usize, letter: u8| {
        text.get(position)
            .is_some_and(|c| c.eq_ignore_ascii_case(&letter))
    };
    let part = if is_letter(*position, b'R') {
        *position += 1;
        let row = parse_r1c1_number(text, position, cell.row, LAST_ROW)?;
        if is_letter(*position, b'C') {
            *position += 1;
            let column = parse_r1c1_number(text, position, cell.column, LAST_COLUMN)?;
            R1C1Part::Cell(row, column)
        } else {
            R1C1Part::Row(row)
        }
    } else if is_letter(*position, b'C') {
        *position += 1;
        R1C1Part::Column(parse_r1c1_number(text, position, cell.column, LAST_COLUMN)?)
    } else {
        return Err("Invalid reference. Expected 'R' or 'C'.".to_string());
    };
    let (row, column) = match part {
        R1C1Part::Cell(row, column) => (row, column),
        R1C1Part::Row(row) => (row, 1),
        R1C1Part::Column(column) => (1, column),
    };
    if !(1..=LAST_ROW).contains(&row) || !(1..=LAST_COLUMN).contains(&column) {
        return Err("Invalid reference. It is outside of the sheet.".to_string());
    }
    Ok(part)
}

/// Reads the number that follows an `R` or a `C`: `12` is row or column 12,
/// `[-2]` is two before `current` and nothing at all is `current`.
///
/// The rows and the columns go round: an offset that goes past the `last` one
/// carries on from the first, and one that goes before the first carries on
/// from the last. An offset has to be shorter than the whole way round.
fn parse_r1c1_number(
    text: &[u8],
    position: &mut usize,
    current: i32,
    last: i32,
) -> Result<i32, String> {
    let invalid = || "Invalid reference. Expected a number.".to_string();
    let is_relative = text.get(*position) == Some(&b'[');
    if is_relative {
        *position += 1;
    }
    let start = *position;
    if is_relative && text.get(*position) == Some(&b'-') {
        *position += 1;
    }
    while text.get(*position).is_some_and(u8::is_ascii_digit) {
        *position += 1;
    }
    let digits = std::str::from_utf8(&text[start..*position]).map_err(|_| invalid())?;
    if !is_relative {
        if digits.is_empty() {
            return Ok(current);
        }
        return digits.parse::<i32>().map_err(|_| invalid());
    }
    if text.get(*position) != Some(&b']') {
        return Err("Invalid reference. Expected ']'.".to_string());
    }
    *position += 1;
    let offset = digits.parse::<i32>().map_err(|_| invalid())?;
    // Not `offset.abs()`: the lowest number has no positive counterpart.
    if offset <= -last || offset >= last {
        return Err("Invalid reference. The offset is larger than the sheet.".to_string());
    }
    Ok((current - 1 + offset).rem_euclid(last) + 1)
}

/// Returns true if the string value could be interpreted as:
///  * a formula
///  * a number
///  * a boolean
///  * an error (i.e "#VALUE!")
pub(crate) fn value_needs_quoting(value: &str, language: &Language) -> bool {
    value.starts_with(['=', '+', '-'])
        || parse_finite_number(value).is_some()
        || value.to_lowercase().parse::<bool>().is_ok()
        || get_error_by_name(&value.to_uppercase(), language).is_some()
}

/// Gets all timezones
pub fn get_all_timezones() -> Vec<String> {
    crate::tz::get_all_timezone_names()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::*;
    use crate::language::get_language;
    use crate::locale::{get_locale, Locale};

    fn get_test_locale() -> &'static Locale {
        #![allow(clippy::unwrap_used)]
        get_locale("en").unwrap()
    }

    fn get_sheet_index_by_name(sheet_names: &[&str], name: &str) -> Option<u32> {
        sheet_names
            .iter()
            .position(|&sheet_name| sheet_name == name)
            .map(|index| index as u32)
    }

    #[test]
    fn test_parse_cell_references() {
        let locale = get_test_locale();
        let sheet_names = vec!["Sheet1", "Sheet2", "Sheet3"];

        assert_eq!(
            ParsedReference::parse_reference_formula(Some(7), "A1", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::CellReference(CellReferenceIndex {
                sheet: 7,
                row: 1,
                column: 1,
            })),
        );

        assert_eq!(
            ParsedReference::parse_reference_formula(None, "Sheet1!A1", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::CellReference(CellReferenceIndex {
                sheet: 0,
                row: 1,
                column: 1,
            })),
        );

        assert_eq!(
            ParsedReference::parse_reference_formula(None, "Sheet1!$A$1", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::CellReference(CellReferenceIndex {
                sheet: 0,
                row: 1,
                column: 1,
            })),
        );

        assert_eq!(
            ParsedReference::parse_reference_formula(None, "Sheet2!$A$1", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::CellReference(CellReferenceIndex {
                sheet: 1,
                row: 1,
                column: 1,
            })),
        );
    }

    #[test]
    fn test_parse_range_references() {
        let locale = get_test_locale();
        let sheet_names = vec!["Sheet1", "Sheet2", "Sheet3"];

        assert_eq!(
            ParsedReference::parse_reference_formula(Some(5), "A1:A2", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::Range(
                CellReferenceIndex {
                    sheet: 5,
                    column: 1,
                    row: 1,
                },
                CellReferenceIndex {
                    sheet: 5,
                    column: 1,
                    row: 2,
                },
            )),
        );

        assert_eq!(
            ParsedReference::parse_reference_formula(None, "Sheet1!$A$1:$B$10", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::Range(
                CellReferenceIndex {
                    sheet: 0,
                    row: 1,
                    column: 1,
                },
                CellReferenceIndex {
                    sheet: 0,
                    row: 10,
                    column: 2,
                },
            )),
        );

        assert_eq!(
            ParsedReference::parse_reference_formula(None, "Sheet2!AA1:E$11", locale, |name| {
                get_sheet_index_by_name(&sheet_names, name)
            },),
            Ok(ParsedReference::Range(
                CellReferenceIndex {
                    sheet: 1,
                    row: 1,
                    column: 27,
                },
                CellReferenceIndex {
                    sheet: 1,
                    row: 11,
                    column: 5,
                },
            )),
        );
    }

    #[test]
    fn test_error_reject_assignments() {
        let locale = get_test_locale();
        let sheet_index = Some(1);
        assert_eq!(
            ParsedReference::parse_reference_formula(sheet_index, "=A1", locale, |_| Some(1)),
            Err("Invalid reference. Expected only one token.".to_string()),
        );
        assert_eq!(
            ParsedReference::parse_reference_formula(sheet_index, "=$A$1", locale, |_| { Some(1) }),
            Err("Invalid reference. Expected only one token.".to_string()),
        );
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "=Sheet1!A1", locale, |_| Some(1)),
            Err("Invalid reference. Expected only one token.".to_string()),
        );
    }

    #[test]
    fn test_error_reject_formulas_without_equal_sign() {
        let locale = get_test_locale();
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "SUM", locale, |_| Some(1)),
            Err("Invalid reference. First token is not a reference.".to_string()),
        );
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "SUM(A1:A2)", locale, |_| Some(1)),
            Err("Invalid reference. Expected only one token.".to_string()),
        );
    }

    #[test]
    fn test_error_reject_without_sheet_and_relative_cell() {
        let locale = get_test_locale();
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "A1", locale, |_| Some(1)),
            Err("Reference doesn't contain sheet name and relative cell is not known.".to_string()),
        );
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "A1:A2", locale, |_| Some(1)),
            Err("Reference doesn't contain sheet name and relative cell is not known.".to_string()),
        );
    }

    #[test]
    fn test_error_unrecognized_sheet_name() {
        let locale = get_test_locale();
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "SheetName!A1", locale, |_| None),
            Err("Invalid reference. Sheet \"SheetName\" could not be found.".to_string()),
        );
        assert_eq!(
            ParsedReference::parse_reference_formula(None, "SheetName2!A1:A4", locale, |_| None),
            Err("Invalid reference. Sheet \"SheetName2\" could not be found.".to_string()),
        );
    }

    fn r1c1(reference: &str) -> Result<ParsedReference, String> {
        // Relative to Sheet2!C5
        let cell = CellReferenceIndex {
            sheet: 1,
            row: 5,
            column: 3,
        };
        let sheet_names = vec!["Sheet1", "Sheet2", "My sheet", "It's"];
        ParsedReference::parse_r1c1_reference(cell, reference, |name| {
            get_sheet_index_by_name(&sheet_names, name)
        })
    }

    fn cell(sheet: u32, row: i32, column: i32) -> Result<ParsedReference, String> {
        Ok(ParsedReference::CellReference(CellReferenceIndex {
            sheet,
            row,
            column,
        }))
    }

    fn range(
        sheet: u32,
        (row1, column1): (i32, i32),
        (row2, column2): (i32, i32),
    ) -> Result<ParsedReference, String> {
        Ok(ParsedReference::Range(
            CellReferenceIndex {
                sheet,
                row: row1,
                column: column1,
            },
            CellReferenceIndex {
                sheet,
                row: row2,
                column: column2,
            },
        ))
    }

    #[test]
    fn test_parse_r1c1_cells() {
        assert_eq!(r1c1("R1C1"), cell(1, 1, 1));
        assert_eq!(r1c1("R12C34"), cell(1, 12, 34));
        assert_eq!(r1c1("r2c3"), cell(1, 2, 3));
        assert_eq!(r1c1("R1048576C16384"), cell(1, LAST_ROW, LAST_COLUMN));
        // Relative to C5
        assert_eq!(r1c1("RC"), cell(1, 5, 3));
        assert_eq!(r1c1("R[0]C[0]"), cell(1, 5, 3));
        assert_eq!(r1c1("R[2]C[-1]"), cell(1, 7, 2));
        assert_eq!(r1c1("R[-4]C[1]"), cell(1, 1, 4));
        assert_eq!(r1c1("RC[1]"), cell(1, 5, 4));
        assert_eq!(r1c1("R[1]C"), cell(1, 6, 3));
        assert_eq!(r1c1("R1C"), cell(1, 1, 3));
        assert_eq!(r1c1("RC1"), cell(1, 5, 1));
        assert_eq!(r1c1("R7C[2]"), cell(1, 7, 5));
    }

    #[test]
    fn test_parse_r1c1_sheets() {
        assert_eq!(r1c1("Sheet1!R2C3"), cell(0, 2, 3));
        assert_eq!(r1c1("Sheet2!R2C3"), cell(1, 2, 3));
        assert_eq!(r1c1("'My sheet'!R2C3"), cell(2, 2, 3));
        assert_eq!(r1c1("'It''s'!R2C3"), cell(3, 2, 3));
        assert_eq!(r1c1("'Sheet1'!R1C1:R2C2"), range(0, (1, 1), (2, 2)));
        assert_eq!(
            r1c1("Sheet3!R2C3"),
            Err("Invalid reference. Sheet \"Sheet3\" could not be found.".to_string())
        );
        assert!(r1c1("'My sheet!R2C3").is_err());
        assert!(r1c1("'My sheet'R2C3").is_err());
        assert!(r1c1("Sheet1!").is_err());
    }

    #[test]
    fn test_parse_r1c1_ranges() {
        assert_eq!(r1c1("R1C1:R1C768"), range(1, (1, 1), (1, 768)));
        assert_eq!(r1c1("R2C3:R5C7"), range(1, (2, 3), (5, 7)));
        assert_eq!(r1c1("R2C3:R2C3"), range(1, (2, 3), (2, 3)));
        assert_eq!(r1c1("R[-1]C[-1]:R[1]C[1]"), range(1, (4, 2), (6, 4)));
        assert_eq!(r1c1("R1C1:RC"), range(1, (1, 1), (5, 3)));
        // The corners are put in order
        assert_eq!(r1c1("R5C7:R2C3"), range(1, (2, 3), (5, 7)));
        assert_eq!(r1c1("R5C3:R2C7"), range(1, (2, 3), (5, 7)));
    }

    #[test]
    fn test_parse_r1c1_whole_rows_and_columns() {
        assert_eq!(r1c1("R2"), range(1, (2, 1), (2, LAST_COLUMN)));
        assert_eq!(r1c1("R"), range(1, (5, 1), (5, LAST_COLUMN)));
        assert_eq!(r1c1("R[1]"), range(1, (6, 1), (6, LAST_COLUMN)));
        assert_eq!(r1c1("R2:R4"), range(1, (2, 1), (4, LAST_COLUMN)));
        assert_eq!(r1c1("C2"), range(1, (1, 2), (LAST_ROW, 2)));
        assert_eq!(r1c1("C"), range(1, (1, 3), (LAST_ROW, 3)));
        assert_eq!(r1c1("C[-2]"), range(1, (1, 1), (LAST_ROW, 1)));
        assert_eq!(r1c1("C4:C2"), range(1, (1, 2), (LAST_ROW, 4)));
        assert_eq!(r1c1("Sheet1!C:C[1]"), range(0, (1, 3), (LAST_ROW, 4)));
    }

    #[test]
    fn test_parse_r1c1_offsets_go_round_the_sheet() {
        // Relative to C5: five rows up is the last row, and so on
        assert_eq!(r1c1("R[-4]C"), cell(1, 1, 3));
        assert_eq!(r1c1("R[-5]C"), cell(1, LAST_ROW, 3));
        assert_eq!(r1c1("R[-6]C"), cell(1, LAST_ROW - 1, 3));
        assert_eq!(r1c1("R[1048571]C"), cell(1, LAST_ROW, 3));
        assert_eq!(r1c1("R[1048572]C"), cell(1, 1, 3));
        assert_eq!(r1c1("RC[-2]"), cell(1, 5, 1));
        assert_eq!(r1c1("RC[-3]"), cell(1, 5, LAST_COLUMN));
        assert_eq!(r1c1("RC[16381]"), cell(1, 5, LAST_COLUMN));
        assert_eq!(r1c1("RC[16382]"), cell(1, 5, 1));
        assert_eq!(r1c1("R[-5]C[-3]"), cell(1, LAST_ROW, LAST_COLUMN));
        // The longest offsets
        assert_eq!(r1c1("R[1048575]C"), cell(1, 4, 3));
        assert_eq!(r1c1("R[-1048575]C"), cell(1, 6, 3));
        assert_eq!(r1c1("RC[16383]"), cell(1, 5, 2));
        assert_eq!(r1c1("RC[-16383]"), cell(1, 5, 4));
        // Whole rows and columns
        assert_eq!(
            r1c1("R[-5]"),
            range(1, (LAST_ROW, 1), (LAST_ROW, LAST_COLUMN))
        );
        assert_eq!(
            r1c1("C[-3]"),
            range(1, (1, LAST_COLUMN), (LAST_ROW, LAST_COLUMN))
        );
        // A range whose first corner goes round: the corners are put in order
        assert_eq!(r1c1("R[-5]C:R[-3]C"), range(1, (2, 3), (LAST_ROW, 3)));
        // Once round the sheet, or more, is not an offset
        for reference in [
            "R[1048576]C",
            "R[-1048576]C",
            "RC[16384]",
            "RC[-16384]",
            "R[2000000]C",
            "C[-20000]",
        ] {
            assert!(r1c1(reference).is_err(), "{reference}");
        }
    }

    #[test]
    fn test_parse_r1c1_largest_offsets() {
        // The largest numbers an offset can be written with. The lowest one
        // has no positive counterpart, so it cannot be turned into a length.
        for reference in [
            "R[-2147483648]C",
            "RC[-2147483648]",
            "R[-2147483648]",
            "C[-2147483648]",
            "R[-2147483647]C",
            "R[2147483647]C",
            "RC[2147483647]",
            "R[-2147483648]C:R[2147483647]C",
            // These do not fit in a number
            "R[-2147483649]C",
            "R[2147483648]C",
        ] {
            assert!(r1c1(reference).is_err(), "{reference}");
        }
    }

    #[test]
    fn test_parse_r1c1_errors() {
        for reference in [
            "",
            "A1",
            "$A$1",
            "A1:B2",
            "R1C1:",
            ":R1C1",
            "R1C1:B2",
            "R1C1:R2",
            "R1:C1",
            "C1:R2C2",
            "R1C1 ",
            " R1C1",
            "R1C1x",
            "R1C1:R2C2:R3C3",
            "R[1C1",
            "R[]C1",
            "R[a]C1",
            "R1C[1",
            "R-1C1",
            "R[+1]C1",
            // Outside of the sheet
            "R0C1",
            "R1C0",
            "R1048577C1",
            "R1C16385",
            "R99999999999C1",
            "R[99999999999]C1",
            "R0",
            "C0",
        ] {
            assert!(r1c1(reference).is_err(), "{reference}");
        }
    }

    #[test]
    fn test_value_needs_quoting() {
        let en_language = get_language("en").expect("en language expected");

        assert!(!value_needs_quoting("", en_language));
        assert!(!value_needs_quoting("hello", en_language));

        assert!(value_needs_quoting("12", en_language));
        assert!(value_needs_quoting("true", en_language));
        assert!(value_needs_quoting("False", en_language));

        assert!(value_needs_quoting("=A1", en_language));

        assert!(value_needs_quoting("#REF!", en_language));
        assert!(value_needs_quoting("#NAME?", en_language));
    }
}
