#[cfg(not(target_arch = "wasm32"))]
use regex::Regex;
#[cfg(target_arch = "wasm32")]
use regex_lite::Regex;

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

use crate::functions::{
    binary_search::{
        binary_search_descending_or_greater, binary_search_descending_or_smaller,
        binary_search_or_greater, binary_search_or_smaller,
    },
    util::{compare_values, from_wildcard_to_regex, result_matches_regex},
};

#[derive(PartialEq)]
enum SearchMode {
    FirstToLast = 1,
    LastToFirst = -1,
    BinaryAscending = 2,
    BinaryDescending = -2,
}

#[derive(PartialEq, Clone, Copy)]
enum MatchMode {
    ExactMatchSmaller = -1,
    Exact = 0,
    ExactMatchLarger = 1,
    Wildcard = 2,
    Regex = 3,
}

/// Searches `array` for `lookup_value` and returns the 0-based index of the match,
/// or `None` if not found.
fn linear_search(
    lookup_value: &CalcResult,
    array: &[CalcResult],
    search_mode: &SearchMode,
    match_mode: MatchMode,
) -> Option<usize> {
    let len = array.len();

    let item = |i: usize| -> usize {
        if *search_mode == SearchMode::FirstToLast {
            i
        } else {
            len - i - 1
        }
    };

    match match_mode {
        MatchMode::Exact => {
            for i in 0..len {
                let idx = item(i);
                if compare_values(&array[idx], lookup_value) == 0 {
                    return Some(idx);
                }
            }
            None
        }
        MatchMode::ExactMatchSmaller | MatchMode::ExactMatchLarger => {
            let m = match_mode as i32;
            let mut best_idx = None;
            let mut best_val: Option<CalcResult> = None;
            for i in 0..len {
                let idx = item(i);
                let v = &array[idx];
                let c = compare_values(v, lookup_value);
                if c == 0 {
                    return Some(idx);
                } else if c == m {
                    match &best_val {
                        None => {
                            best_val = Some(v.clone());
                            best_idx = Some(idx);
                        }
                        Some(p) => {
                            if compare_values(p, v) == m {
                                best_val = Some(v.clone());
                                best_idx = Some(idx);
                            }
                        }
                    }
                }
            }
            best_idx
        }
        MatchMode::Wildcard => {
            let matches: Box<dyn Fn(&CalcResult) -> bool> =
                if let CalcResult::String(s) = lookup_value {
                    if let Ok(reg) = from_wildcard_to_regex(&s.to_lowercase(), true) {
                        Box::new(move |x| result_matches_regex(x, &reg))
                    } else {
                        Box::new(|_| false)
                    }
                } else {
                    Box::new(move |x| compare_values(x, lookup_value) == 0)
                };
            for i in 0..len {
                let idx = item(i);
                if matches(&array[idx]) {
                    return Some(idx);
                }
            }
            None
        }
        MatchMode::Regex => {
            let pattern = match lookup_value {
                CalcResult::String(s) => s.as_str(),
                _ => return None,
            };
            let re = match Regex::new(pattern) {
                Ok(r) => r,
                Err(_) => return None,
            };
            for i in 0..len {
                let idx = item(i);
                let text = match &array[idx] {
                    CalcResult::String(s) => s.clone(),
                    CalcResult::Number(n) => n.to_string(),
                    CalcResult::Boolean(b) => b.to_string(),
                    _ => continue,
                };
                if re.is_match(&text) {
                    return Some(idx);
                }
            }
            None
        }
    }
}

impl<'a> Model<'a> {
    /// `=XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])`
    ///
    /// Returns the relative position (1-based) of an item in a row or column array.
    ///
    /// match_mode:
    ///   *  0 – exact match (default)
    ///   * -1 – exact match or next smaller
    ///   *  1 – exact match or next larger
    ///   *  2 – wildcard match (* ? ~)
    ///
    /// search_mode:
    ///   *  1 – first to last (default)
    ///   * -1 – last to first
    ///   *  2 – binary search ascending
    ///   * -2 – binary search descending
    pub(crate) fn fn_xmatch(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let lookup_value = self.evaluate_node_in_context(&args[0], cell);
        if lookup_value.is_error() {
            return lookup_value;
        }

        let match_mode = if args.len() >= 3 {
            match self.get_number(&args[2], cell) {
                Ok(n) => match n.floor() as i32 {
                    -1 => MatchMode::ExactMatchSmaller,
                    0 => MatchMode::Exact,
                    1 => MatchMode::ExactMatchLarger,
                    2 => MatchMode::Wildcard,
                    3 => MatchMode::Regex,
                    _ => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Invalid match_mode".to_string(),
                        )
                    }
                },
                Err(e) => return e,
            }
        } else {
            MatchMode::Exact
        };

        let search_mode = if args.len() == 4 {
            match self.get_number(&args[3], cell) {
                Ok(n) => match n.floor() as i32 {
                    1 => SearchMode::FirstToLast,
                    -1 => SearchMode::LastToFirst,
                    2 => SearchMode::BinaryAscending,
                    -2 => SearchMode::BinaryDescending,
                    _ => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Invalid search_mode".to_string(),
                        )
                    }
                },
                Err(e) => return e,
            }
        } else {
            SearchMode::FirstToLast
        };

        // Materialise `lookup_array` into a one-dimensional vector of values.
        // It may be a range reference or an in-formula array constant `{…}`;
        // either way it must be a single row or single column.
        let array: Vec<CalcResult> = match self.evaluate_node_in_context(&args[1], cell) {
            CalcResult::Range { left, right } => {
                let is_col_vec = left.column == right.column;
                let is_row_vec = left.row == right.row;
                if !is_col_vec && !is_row_vec {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "lookup_array must be a single row or column".to_string(),
                    );
                }

                // Honour entire-column/row references: clamp to worksheet used range.
                let mut row2 = right.row;
                let mut col2 = right.column;
                match self.clip_to_used_area(left.sheet, left.row, left.column, row2, col2) {
                    Ok((r, c)) => {
                        row2 = r;
                        col2 = c;
                    }
                    Err(message) => return CalcResult::new_error(Error::ERROR, cell, message),
                }
                let right = CellReferenceIndex {
                    sheet: right.sheet,
                    row: row2,
                    column: col2,
                };
                self.prepare_array(&left, &right, is_col_vec)
            }
            CalcResult::Array(rows) => {
                // An array constant must be a single row or single column.
                let n_rows = rows.len();
                let n_cols = rows.first().map(|r| r.len()).unwrap_or(0);
                let is_row_vec = n_rows == 1;
                let is_col_vec = n_cols == 1;
                if n_rows == 0 || n_cols == 0 || (!is_row_vec && !is_col_vec) {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "lookup_array must be a single row or column".to_string(),
                    );
                }
                rows.iter()
                    .flatten()
                    .map(|node| super::array_node_to_calc_result(node, cell))
                    .collect()
            }
            error @ CalcResult::Error { .. } => return error,
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "lookup_array must be a range or array".to_string(),
                )
            }
        };

        match search_mode {
            SearchMode::FirstToLast | SearchMode::LastToFirst => {
                if match_mode == MatchMode::Regex {
                    if let CalcResult::String(ref pat) = lookup_value {
                        if Regex::new(pat).is_err() {
                            return CalcResult::new_error(
                                Error::VALUE,
                                cell,
                                "Invalid regular expression".to_string(),
                            );
                        }
                    }
                }
                match linear_search(&lookup_value, &array, &search_mode, match_mode) {
                    Some(idx) => CalcResult::Number(idx as f64 + 1.0),
                    None => CalcResult::new_error(Error::NA, cell, "Not found".to_string()),
                }
            }
            SearchMode::BinaryAscending | SearchMode::BinaryDescending => {
                if match_mode == MatchMode::Wildcard || match_mode == MatchMode::Regex {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Wildcard/regex match cannot be used with binary search".to_string(),
                    );
                }
                let idx_opt = if match_mode == MatchMode::ExactMatchLarger {
                    if search_mode == SearchMode::BinaryAscending {
                        binary_search_or_greater(&lookup_value, &array)
                    } else {
                        binary_search_descending_or_greater(&lookup_value, &array)
                    }
                } else if search_mode == SearchMode::BinaryAscending {
                    binary_search_or_smaller(&lookup_value, &array)
                } else {
                    binary_search_descending_or_smaller(&lookup_value, &array)
                };

                match idx_opt {
                    None => CalcResult::new_error(Error::NA, cell, "Not found".to_string()),
                    Some(l) => {
                        if match_mode == MatchMode::Exact {
                            let v = &array[l as usize];
                            if compare_values(v, &lookup_value) != 0 {
                                return CalcResult::new_error(
                                    Error::NA,
                                    cell,
                                    "Not found".to_string(),
                                );
                            }
                        }
                        CalcResult::Number(l as f64 + 1.0)
                    }
                }
            }
        }
    }
}
