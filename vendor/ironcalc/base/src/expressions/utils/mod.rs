use super::types::*;
use crate::constants::{LAST_COLUMN, LAST_ROW};

#[cfg(test)]
mod test;

/// Converts column letter identifier to number.
pub fn column_to_number(column: &str) -> Result<i32, String> {
    if column.is_empty() {
        return Err("Column identifier cannot be empty.".to_string());
    }

    if !column.is_ascii() {
        return Err("Column identifier must be ASCII.".to_string());
    }

    let mut column_number = 0;
    for character in column.chars() {
        if !character.is_ascii_uppercase() {
            return Err("Column identifier can use only A-Z characters".to_string());
        }
        column_number = column_number * 26 + ((character as i32) - 64);
    }

    match is_valid_column_number(column_number) {
        true => Ok(column_number),
        false => Err("Column is not valid.".to_string()),
    }
}

/// If input number is outside valid range `None` is returned.
pub fn number_to_column(mut i: i32) -> Option<String> {
    if !is_valid_column_number(i) {
        return None;
    }
    let mut column = "".to_string();
    while i > 0 {
        let r = ((i - 1) % 26) as u8;
        column.insert(0, (65 + r) as char);
        i = (i - 1) / 26;
    }
    Some(column)
}

/// Checks if column number is in valid range.
pub fn is_valid_column_number(column: i32) -> bool {
    (1..=LAST_COLUMN).contains(&column)
}

pub fn is_valid_column(column: &str) -> bool {
    // last column XFD
    if column.len() > 3 {
        return false;
    }

    let column_number = column_to_number(column);

    match column_number {
        Ok(column_number) => is_valid_column_number(column_number),
        Err(_) => false,
    }
}

pub fn is_valid_row(row: i32) -> bool {
    (1..=LAST_ROW).contains(&row)
}

fn is_valid_row_str(row: &str) -> bool {
    match row.parse::<i32>() {
        Ok(r) => is_valid_row(r),
        Err(_r) => false,
    }
}

pub fn parse_reference_r1c1(r: &str) -> Option<ParsedReference> {
    let chars = r.as_bytes();
    let len = chars.len();
    let absolute_column;
    let absolute_row;
    let mut row = "".to_string();
    let mut column = "".to_string();
    if len < 4 {
        return None;
    }
    if chars[0] != b'R' {
        return None;
    }
    let mut i = 1;
    if chars[i] == b'[' {
        i += 1;
        absolute_row = false;
        if chars[i] == b'-' {
            i += 1;
            row.push('-');
        }
    } else {
        absolute_row = true;
    }
    while i < len {
        let ch = chars[i];
        if ch.is_ascii_digit() {
            row.push(ch as char);
        } else {
            break;
        }
        i += 1;
    }
    if !absolute_row {
        if i >= len || chars[i] != b']' {
            return None;
        };
        i += 1;
    }
    if i >= len || chars[i] != b'C' {
        return None;
    };
    i += 1;
    if i < len && chars[i] == b'[' {
        absolute_column = false;
        i += 1;
        if i < len && chars[i] == b'-' {
            i += 1;
            column.push('-');
        }
    } else {
        absolute_column = true;
    }
    while i < len {
        let ch = chars[i];
        if ch.is_ascii_digit() {
            column.push(ch as char);
        } else {
            break;
        }
        i += 1;
    }
    if !absolute_column {
        if i >= len || chars[i] != b']' {
            return None;
        };
        i += 1;
    }
    if i != len {
        return None;
    }
    Some(ParsedReference {
        row: row.parse::<i32>().unwrap_or(0),
        column: column.parse::<i32>().unwrap_or(0),
        absolute_column,
        absolute_row,
    })
}

pub fn parse_reference_a1(r: &str) -> Option<ParsedReference> {
    let chars = r.chars();
    let mut absolute_column = false;
    let mut absolute_row = false;
    let mut row = "".to_string();
    let mut column = "".to_string();
    let mut state = 1; // 1(colum), 2(row)

    for ch in chars {
        match ch {
            'A'..='Z' if state == 1 => {
                column.push(ch);
            }
            '0'..='9' => {
                if state == 1 {
                    state = 2
                }
                row.push(ch);
            }
            '$' => {
                if column == *"" {
                    absolute_column = true;
                } else if state == 1 {
                    absolute_row = true;
                    state = 2;
                } else {
                    return None;
                }
            }
            _ => {
                return None;
            }
        }
    }
    if !is_valid_column(&column) {
        return None;
    }
    if !is_valid_row_str(&row) {
        return None;
    }
    let row = match row.parse::<i32>() {
        Ok(r) => r,
        Err(_) => return None,
    };

    Some(ParsedReference {
        row,
        column: column_to_number(&column).ok()?,
        absolute_column,
        absolute_row,
    })
}

/// Returns true if `name` is a valid identifier in an A1-mode formula expression.
/// This is a superset of `is_valid_identifier`: it permits the single-character
/// names "R" and "C" that are valid as LAMBDA parameters or LET variables but
/// not as worksheet-level defined names.
pub fn is_valid_a1_identifier(name: &str) -> bool {
    // https://support.microsoft.com/en-us/office/names-in-formulas-fc2935f9-115d-4bef-a370-3aa8bb4c91f1
    // https://github.com/MartinTrummer/excel-names/
    let upper = name.to_uppercase();
    let len = upper.chars().count();

    let mut chars = upper.chars();

    if len > 255 || len == 0 {
        return false;
    }
    let first = match chars.next() {
        Some(ch) => ch,
        None => return false,
    };

    // The first character of a name must be a letter, an underscore character (_), or a backslash (\).
    if !(first.is_ascii_alphabetic() || first == '_' || first == '\\') {
        return false;
    }
    if upper == *"TRUE" || upper == *"FALSE" {
        return false;
    }
    if parse_reference_a1(name).is_some() {
        return false;
    }
    if parse_reference_r1c1(name).is_some() {
        return false;
    }
    for ch in chars {
        if !(ch.is_alphanumeric() || ch == '_' || ch == '.') {
            return false;
        }
    }

    true
}

pub fn is_valid_identifier(name: &str) -> bool {
    // You cannot use the uppercase and lowercase characters "C", "c", "R", or "r" as a defined name
    let upper = name.to_uppercase();
    if upper == "R" || upper == "C" {
        return false;
    }
    is_valid_a1_identifier(name)
}

fn name_needs_quoting(name: &str) -> bool {
    // Excel only leaves a sheet name unquoted when it is made of letters, digits,
    // '_' and '.', and does not start with a digit or a '.'. Anything else
    // (space, '&', '=', '-', '+', '(', ')', '$', ',', ';', '{', '}', '\'', '!', ...)
    // must be quoted, otherwise `'P&L'!A1` would be read back as `P & L!A1`.
    let mut chars = name.chars();
    match chars.next() {
        // ADDRESS(…, "") emits a bare "!" prefix; an empty name is never quoted.
        None => return false,
        Some(c) if c.is_ascii_digit() || c == '.' => return true,
        Some(c) if !(c.is_alphabetic() || c == '_') => return true,
        Some(_) => {}
    }
    if chars.any(|c| !(c.is_alphanumeric() || c == '_' || c == '.')) {
        return true;
    }
    if parse_reference_a1(name).is_some() {
        // cell reference in A1 notation, e.g. B1048576 is quoted, B1048577 is not
        return true;
    }
    if parse_reference_r1c1(name).is_some() {
        // cell reference in R1C1 notation, e.g. RC, RC2, R5C, R-4C, RC-8, R, C
        return true;
    }
    false
}

/// Quotes a string sheet name if it needs to
/// NOTE: Invalid characters in a sheet name \, /, *, \[, \], :, ?
pub fn quote_name(name: &str) -> String {
    if name_needs_quoting(name) {
        return format!("'{}'", name.replace('\'', "''"));
    };
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_name() {
        assert_eq!(quote_name("Sheet1"), "Sheet1");
        assert_eq!(quote_name("Sheet 1"), "'Sheet 1'");
        // escape and quote
        assert_eq!(quote_name("Sheet1'"), "'Sheet1'''");
        assert_eq!(quote_name("Data(2024)"), "'Data(2024)'");
        // any character outside [letters, digits, '_', '.'] needs quoting
        assert_eq!(quote_name("P&L"), "'P&L'");
        assert_eq!(quote_name("Q1=Q2"), "'Q1=Q2'");
        assert_eq!(quote_name("Sheet!"), "'Sheet!'");
        assert_eq!(quote_name("100%"), "'100%'");
        assert_eq!(quote_name(".hidden"), "'.hidden'");
        // unicode letters, '_' and '.' inside the name do not
        assert_eq!(quote_name("Été"), "Été");
        assert_eq!(quote_name("_draft"), "_draft");
        assert_eq!(quote_name("Sheet.1"), "Sheet.1");
        assert_eq!(quote_name("Data$2024"), "'Data$2024'");
        assert_eq!(quote_name("Data-2024"), "'Data-2024'");
        assert_eq!(quote_name("Data+2024"), "'Data+2024'");
        assert_eq!(quote_name("Data,2024"), "'Data,2024'");
        assert_eq!(quote_name("Data;2024"), "'Data;2024'");
        assert_eq!(quote_name("Data{2024}"), "'Data{2024}'");

        assert_eq!(quote_name("2024"), "'2024'");
        assert_eq!(quote_name("1Data"), "'1Data'");
        assert_eq!(quote_name("A1"), "'A1'");
        assert_eq!(quote_name("R1C1"), "'R1C1'");
        assert_eq!(quote_name("MySheet"), "MySheet");

        assert_eq!(quote_name("B1048576"), "'B1048576'");
        assert_eq!(quote_name("B1048577"), "B1048577");
    }
}
