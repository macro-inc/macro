// DOLLAR, FIXED, NUMBERVALUE, PROPER, REPLACE, ARRAYTOTEXT

use crate::{
    calc_result::CalcResult,
    cast::array_node_to_string,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

use super::common::broadcast_text;
use crate::number_format::parse_finite_number;

fn format_thousands(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result.chars().rev().collect()
}

/// Formats a non-negative f64 with the given decimal places and optional thousands separator.
/// Returns the formatted string without sign.
fn format_abs(abs_value: f64, decimals: i32, use_thousands: bool) -> String {
    if decimals >= 0 {
        let factor = 10f64.powi(decimals);
        let rounded = (abs_value * factor).round() / factor;
        let int_part = rounded.floor() as u64;
        let int_str = if use_thousands {
            format_thousands(int_part)
        } else {
            int_part.to_string()
        };
        if decimals == 0 {
            int_str
        } else {
            let frac = rounded - rounded.floor();
            let frac_digits = (frac * factor).round() as u64;
            format!(
                "{}.{:0>width$}",
                int_str,
                frac_digits,
                width = decimals as usize
            )
        }
    } else {
        // Negative decimals: round to 10^(-decimals) places
        let factor = 10f64.powi(-decimals);
        let rounded = ((abs_value / factor).round() * factor) as u64;
        if use_thousands {
            format_thousands(rounded)
        } else {
            rounded.to_string()
        }
    }
}

impl<'a> Model<'a> {
    /// DOLLAR(number, [decimals]) — Formats a number as a dollar currency string.
    /// Negative numbers use parentheses: ($1,234.57)
    pub(crate) fn fn_dollar(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let decimals = if args.len() == 2 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.floor() as i32,
                Err(e) => return e,
            }
        } else {
            2
        };
        let formatted = format_abs(value.abs(), decimals, true);
        let result = if value < 0.0 {
            format!("(${})", formatted)
        } else {
            format!("${}", formatted)
        };
        CalcResult::String(result)
    }

    /// FIXED(number, [decimals], [no_commas]) — Formats a number as text with fixed decimal places.
    pub(crate) fn fn_fixed(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let decimals = if args.len() >= 2 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.floor() as i32,
                Err(e) => return e,
            }
        } else {
            2
        };
        let no_commas = if args.len() == 3 {
            match self.get_boolean(&args[2], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };
        let use_thousands = !no_commas;
        let formatted = format_abs(value.abs(), decimals, use_thousands);
        let result = if value < 0.0 {
            format!("-{}", formatted)
        } else {
            formatted
        };
        CalcResult::String(result)
    }

    /// NUMBERVALUE(text, [decimal_separator], [group_separator])
    /// Converts text to a number using the given separators.
    pub(crate) fn fn_numbervalue(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let decimal_sep = if args.len() >= 2 {
            match self.get_string(&args[1], cell) {
                Ok(s) => s,
                Err(e) => return e,
            }
        } else {
            ".".to_string()
        };
        let group_sep = if args.len() == 3 {
            match self.get_string(&args[2], cell) {
                Ok(s) => s,
                Err(e) => return e,
            }
        } else {
            ",".to_string()
        };

        if decimal_sep.is_empty() || decimal_sep == group_sep {
            return CalcResult::new_error(Error::VALUE, cell, "Invalid separators".to_string());
        }

        let trimmed = text.trim();

        // Handle percentage suffix
        let (trimmed, pct_count) = {
            let mut t = trimmed;
            let mut count = 0u32;
            while t.ends_with('%') {
                t = &t[..t.len() - 1];
                count += 1;
            }
            (t.trim_end(), count)
        };

        if trimmed.is_empty() {
            return CalcResult::new_error(Error::VALUE, cell, "Empty string".to_string());
        }

        // Remove group separators, replace decimal separator with '.'
        let cleaned = trimmed.replace(&group_sep, "");
        let cleaned = cleaned.replace(&decimal_sep, ".");

        // Reject if more than one '.' after replacement
        if cleaned.matches('.').count() > 1 {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "Multiple decimal separators".to_string(),
            );
        }

        match parse_finite_number(&cleaned) {
            Some(mut v) => {
                for _ in 0..pct_count {
                    v /= 100.0;
                }
                CalcResult::Number(v)
            }
            None => CalcResult::new_error(Error::VALUE, cell, "Cannot parse number".to_string()),
        }
    }

    /// PROPER(text) — Converts text to title case (first letter of each word uppercase).
    pub(crate) fn fn_proper(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.apply_text_unary(args, cell, proper_case)
    }

    /// REPLACE(old_text, start_num, num_chars, new_text)
    /// Replaces num_chars characters starting at start_num (1-indexed) with new_text.
    /// If any of the arguments is an array it works element by element.
    pub(crate) fn fn_replace(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }
        let old_text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let start_num = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let num_chars = match self.text_arg(&args[2], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let new_text = match self.text_arg(&args[3], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        broadcast_text(
            cell,
            &[&old_text, &start_num, &num_chars, &new_text],
            |i, j| {
                replace_element(
                    old_text.elem(i, j),
                    self.text_number(start_num.elem(i, j)),
                    self.text_number(num_chars.elem(i, j)),
                    new_text.elem(i, j),
                )
            },
        )
    }
}

/// Computes a single REPLACE result from one element of each argument.
fn replace_element(
    old_text: &ArrayNode,
    start_num: Result<f64, Error>,
    num_chars: Result<f64, Error>,
    new_text: &ArrayNode,
) -> Result<ArrayNode, Error> {
    let old_text = array_node_to_string(old_text)?;
    let start_num = start_num?.floor();
    if start_num < 1.0 {
        return Err(Error::VALUE);
    }
    let num_chars = num_chars?.floor();
    if num_chars < 0.0 {
        return Err(Error::VALUE);
    }
    let new_text = array_node_to_string(new_text)?;

    let chars: Vec<char> = old_text.chars().collect();
    let len = chars.len();
    // start_num is 1-indexed; clamp to valid range
    let start = (start_num as usize - 1).min(len);
    let end = start.saturating_add(num_chars as usize).min(len);
    let result: String = chars[..start]
        .iter()
        .copied()
        .chain(new_text.chars())
        .chain(chars[end..].iter().copied())
        .collect();
    Ok(ArrayNode::String(result))
}

fn proper_case(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = true;
    for c in s.chars() {
        if c.is_alphabetic() {
            if capitalize_next {
                result.extend(c.to_uppercase());
                capitalize_next = false;
            } else {
                result.extend(c.to_lowercase());
            }
        } else {
            result.push(c);
            capitalize_next = true;
        }
    }
    result
}
