use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::{token::TokenType, utils::column_to_number};

use super::Lexer;
use super::{ParsedRange, ParsedReference, Result};

impl<'a> Lexer<'a> {
    /// Consumes a reference in A1 style like:
    /// AS23, $AS23, AS$23, $AS$23, R12
    /// Or returns an error
    fn consume_reference_a1(&mut self) -> Result<ParsedReference> {
        let mut absolute_column = false;
        let mut absolute_row = false;
        let mut position = self.position;
        let len = self.len;
        if position < len && self.chars[position] == '$' {
            absolute_column = true;
            position += 1;
        }
        let mut column = "".to_string();
        while position < len {
            let x = self.chars[position].to_ascii_uppercase();
            match x {
                'A'..='Z' => column.push(x),
                _ => break,
            }
            position += 1;
        }
        if column.is_empty() {
            return Err(self.set_error("Failed to parse reference", position));
        }
        if position < len && self.chars[position] == '$' {
            absolute_row = true;
            position += 1;
        }
        let mut row = "".to_string();
        while position < len {
            let x = self.chars[position];
            match x {
                '0'..='9' => row.push(x),
                _ => break,
            }
            position += 1;
        }
        // Note that row numbers could start with 0
        self.position = position;
        let column = column_to_number(&column).map_err(|error| self.set_error(&error, position))?;

        match row.parse::<i32>() {
            Ok(row) => {
                if row > LAST_ROW {
                    return Err(self.set_error("Row too large in reference", position));
                }
                Ok(ParsedReference {
                    column,
                    row,
                    absolute_column,
                    absolute_row,
                })
            }
            Err(..) => Err(self.set_error("Failed to parse integer", position)),
        }
    }

    // Parsing a range is a parser on it's own right. Here is the grammar:
    //
    //    range       -> cell | cell ':' cell | row ':' row | column ':' column
    //    cell        -> column row
    //    column      -> '$' column_name | column_name
    //    row         -> '$' row_name | row_name
    //    column_name -> 'A'..'XFD'
    //    row_name    -> 1..1_048_576
    //
    /// Consumes a range of references in A1 style like:
    /// AS23:AS24, $AS23:AS24, AS$23:AS24, $AS$23:AS24, R12:R23, $R12:R23, R$12:R23, $R$12:R23
    pub(super) fn consume_range_a1(&mut self) -> Result<ParsedRange> {
        // first let's try to parse a cell
        let mut position = self.position;
        match self.consume_reference_a1() {
            Ok(cell) => {
                if self.peek_char() == Some(':') {
                    // It's a range
                    self.position += 1;
                    if let Ok(cell2) = self.consume_reference_a1() {
                        Ok(ParsedRange {
                            left: cell,
                            right: Some(cell2),
                        })
                    } else {
                        Err(self.set_error("Expecting reference in range", self.position))
                    }
                } else {
                    // just a reference
                    Ok(ParsedRange {
                        left: cell,
                        right: None,
                    })
                }
            }
            Err(_) => {
                self.position = position;
                // It's either a row range or a column range (or not a range at all)
                let len = self.len;
                let mut absolute_left = false;
                if position < len && self.chars[position] == '$' {
                    absolute_left = true;
                    position += 1;
                }
                let mut column_left = "".to_string();
                let mut row_left = "".to_string();
                while position < len {
                    let x = self.chars[position].to_ascii_uppercase();
                    match x {
                        'A'..='Z' => column_left.push(x),
                        '0'..='9' => row_left.push(x),
                        _ => break,
                    }
                    position += 1;
                }
                if position >= len || self.chars[position] != ':' {
                    return Err(self.set_error("Expecting reference in range", self.position));
                }
                position += 1;
                let mut absolute_right = false;
                if position < len && self.chars[position] == '$' {
                    absolute_right = true;
                    position += 1;
                }
                let mut column_right = "".to_string();
                let mut row_right = "".to_string();
                while position < len {
                    let x = self.chars[position].to_ascii_uppercase();
                    match x {
                        'A'..='Z' => column_right.push(x),
                        '0'..='9' => row_right.push(x),
                        _ => break,
                    }
                    position += 1;
                }
                self.position = position;
                // At this point either the columns are the empty string or the rows are the empty string
                if !row_left.is_empty() {
                    // It is a row range 23:56
                    if row_right.is_empty() || !column_left.is_empty() || !column_right.is_empty() {
                        return Err(self.set_error("Error parsing Range", position));
                    }
                    // Note that row numbers can start with 0
                    let row_left = match row_left.parse::<i32>() {
                        Ok(n) => n,
                        Err(_) => {
                            return Err(
                                self.set_error(&format!("Failed parsing row {row_left}"), position)
                            )
                        }
                    };
                    let row_right = match row_right.parse::<i32>() {
                        Ok(n) => n,
                        Err(_) => {
                            return Err(self
                                .set_error(&format!("Failed parsing row {row_right}"), position))
                        }
                    };
                    if row_left > LAST_ROW {
                        return Err(self.set_error("Row too large in reference", position));
                    }
                    if row_right > LAST_ROW {
                        return Err(self.set_error("Row too large in reference", position));
                    }
                    return Ok(ParsedRange {
                        left: ParsedReference {
                            row: row_left,
                            absolute_row: absolute_left,
                            column: 1,
                            absolute_column: true,
                        },
                        right: Some(ParsedReference {
                            row: row_right,
                            absolute_row: absolute_right,
                            column: LAST_COLUMN,
                            absolute_column: true,
                        }),
                    });
                }
                // It is a column range
                if column_right.is_empty() || !row_right.is_empty() {
                    return Err(self.set_error("Error parsing Range", position));
                }
                let column_left = column_to_number(&column_left)
                    .map_err(|error| self.set_error(&error, position))?;
                let column_right = column_to_number(&column_right)
                    .map_err(|error| self.set_error(&error, position))?;
                Ok(ParsedRange {
                    left: ParsedReference {
                        row: 1,
                        absolute_row: true,
                        column: column_left,
                        absolute_column: absolute_left,
                    },
                    right: Some(ParsedReference {
                        row: LAST_ROW,
                        absolute_row: true,
                        column: column_right,
                        absolute_column: absolute_right,
                    }),
                })
            }
        }
    }

    /// Consumes a range of references in R1C1 style like:
    /// R12C3:R23C4, R[2]C[-2]:R[3]C[6], R3C[6]:R[-3]C4, R[-2]C:R[-2]C
    pub(super) fn consume_range_r1c1(&mut self) -> Result<ParsedRange> {
        // first let's try to parse a cell
        match self.consume_reference_r1c1() {
            Ok(cell) => {
                if self.peek_char() == Some(':') {
                    // It's a range
                    self.position += 1;
                    if let Ok(cell2) = self.consume_reference_r1c1() {
                        Ok(ParsedRange {
                            left: cell,
                            right: Some(cell2),
                        })
                    } else {
                        Err(self.set_error("Expecting reference in range", self.position))
                    }
                } else {
                    // just a reference
                    Ok(ParsedRange {
                        left: cell,
                        right: None,
                    })
                }
            }
            Err(s) => Err(s),
        }
    }

    /// Consumes a reference in R1C1 style like:
    /// R12C3, R[2]C[-2], R3C[6], R[-3]C4, RC1, R[-2]C
    pub(super) fn consume_reference_r1c1(&mut self) -> Result<ParsedReference> {
        // R12C3, R[2]C[-2], R3C[6], R[-3]C4, RC1, R[-2]C
        let absolute_column;
        let absolute_row;
        let position = self.position;
        let row;
        let column;
        self.expect_char('R')?;
        match self.peek_char() {
            Some('[') => {
                absolute_row = false;
                self.expect_char('[')?;
                let c = match self.read_next_char() {
                    Some(s) => s,
                    None => {
                        return Err(self.set_error("Expected column number", position));
                    }
                };
                match self.consume_integer(c) {
                    Ok(v) => row = v,
                    Err(_) => {
                        return Err(self.set_error("Expected row number", position));
                    }
                }
                self.expect(TokenType::RightBracket)?;
            }
            Some(c) => {
                absolute_row = true;
                self.expect_char(c)?;
                match self.consume_integer(c) {
                    Ok(v) => row = v,
                    Err(_) => {
                        return Err(self.set_error("Expected row number", position));
                    }
                }
            }
            None => {
                return Err(self.set_error("Expected row number or '['", position));
            }
        }
        self.expect_char('C')?;
        match self.peek_char() {
            Some('[') => {
                self.expect_char('[')?;
                absolute_column = false;
                let c = match self.read_next_char() {
                    Some(s) => s,
                    None => {
                        return Err(self.set_error("Expected column number", position));
                    }
                };
                match self.consume_integer(c) {
                    Ok(v) => column = v,
                    Err(_) => {
                        return Err(self.set_error("Expected column number", position));
                    }
                }
                self.expect(TokenType::RightBracket)?;
            }
            Some(c) => {
                absolute_column = true;
                self.expect_char(c)?;
                match self.consume_integer(c) {
                    Ok(v) => column = v,
                    Err(_) => {
                        return Err(self.set_error("Expected column number", position));
                    }
                }
            }
            None => {
                return Err(self.set_error("Expected column number or '['", position));
            }
        }
        if let Some(c) = self.peek_char() {
            if c.is_alphanumeric() {
                return Err(self.set_error("Expected end of reference", position));
            }
        }

        Ok(ParsedReference {
            column,
            row,
            absolute_column,
            absolute_row,
        })
    }
}
