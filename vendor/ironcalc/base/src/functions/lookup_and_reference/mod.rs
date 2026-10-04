use crate::cast::{calc_result_to_array_node, NumberOrArray};
use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
    utils::ParsedReference,
};

use super::binary_search::binary_search_on_array;
use super::util::{compare_values, from_wildcard_to_regex, result_matches_regex, values_are_equal};

mod address_areas;
mod choosecols_chooserows;
mod drop_take;
mod expand;
mod hstack_vstack;
mod tocol_torow;
mod transpose;
mod trimrange;
mod wrapcols_wraprows;
mod xmatch;

/// Converts a single array element into a scalar [`CalcResult`].
fn array_node_to_calc_result(node: &ArrayNode, cell: CellReferenceIndex) -> CalcResult {
    match node {
        ArrayNode::Number(n) => CalcResult::Number(*n),
        ArrayNode::Boolean(b) => CalcResult::Boolean(*b),
        ArrayNode::String(s) => CalcResult::String(s.clone()),
        ArrayNode::Error(e) => CalcResult::Error {
            error: e.clone(),
            origin: cell,
            message: "".to_string(),
        },
        ArrayNode::Empty => CalcResult::EmptyCell,
    }
}

/// A two dimensional table for the LOOKUP family of functions. It abstracts over
/// the two possible sources, a range reference or an in-formula array literal, so
/// the lookup logic can be written once for both.
enum LookupTable {
    Range {
        left: CellReferenceIndex,
        right: CellReferenceIndex,
    },
    Array(Vec<Vec<ArrayNode>>),
}

impl LookupTable {
    fn rows(&self) -> i32 {
        match self {
            LookupTable::Range { left, right } => right.row - left.row + 1,
            LookupTable::Array(array) => array.len() as i32,
        }
    }

    fn columns(&self) -> i32 {
        match self {
            LookupTable::Range { left, right } => right.column - left.column + 1,
            LookupTable::Array(array) => array.first().map_or(0, |row| row.len()) as i32,
        }
    }

    /// Returns the value at the 0-based `(row, column)` offset within the table.
    /// Callers must ensure the offsets are within bounds.
    fn get(
        &self,
        model: &mut Model,
        row: i32,
        column: i32,
        cell: CellReferenceIndex,
    ) -> CalcResult {
        match self {
            LookupTable::Range { left, .. } => model.evaluate_cell(CellReferenceIndex {
                sheet: left.sheet,
                row: left.row + row,
                column: left.column + column,
            }),
            LookupTable::Array(array) => {
                array_node_to_calc_result(&array[row as usize][column as usize], cell)
            }
        }
    }

    /// Materializes the first row of the table (the search vector for HLOOKUP).
    fn first_row(&self, model: &mut Model, cell: CellReferenceIndex) -> Vec<CalcResult> {
        (0..self.columns())
            .map(|column| self.get(model, 0, column, cell))
            .collect()
    }

    /// Materializes the first column of the table (the search vector for VLOOKUP).
    fn first_column(&self, model: &mut Model, cell: CellReferenceIndex) -> Vec<CalcResult> {
        (0..self.rows())
            .map(|row| self.get(model, row, 0, cell))
            .collect()
    }
}

/// Finds the 0-based index of `lookup_value` within `search_vector`.
/// When `is_sorted` is true a binary search is used (assuming ascending order)
/// returning the largest value smaller than or equal to the target; otherwise a
/// linear search for an exact match (supporting wildcards for text) is used.
/// Returns `None` when the value is not found.
fn lookup_index(
    lookup_value: &CalcResult,
    search_vector: &[CalcResult],
    is_sorted: bool,
) -> Option<usize> {
    if is_sorted {
        match binary_search_on_array(lookup_value, search_vector) {
            -2 => None,
            l => Some(l as usize),
        }
    } else {
        let result_matches: Box<dyn Fn(&CalcResult) -> bool> =
            if let CalcResult::String(s) = lookup_value {
                if let Ok(reg) = from_wildcard_to_regex(&s.to_lowercase(), true) {
                    Box::new(move |x| result_matches_regex(x, &reg))
                } else {
                    Box::new(move |_| false)
                }
            } else {
                let lookup_value = lookup_value.clone();
                Box::new(move |x| compare_values(x, &lookup_value) == 0)
            };
        search_vector.iter().position(result_matches)
    }
}

/// Resolves the effective (row, column) indices for INDEX, where `0` means "the
/// whole row/column" (used to spill an entire row, column or array).
///
/// In the two-argument form `INDEX(array, num)` the single index is interpreted
/// based on the shape of the source: for a single-row source it is a column
/// index (all rows), otherwise it is a row index (all columns — i.e. a whole row
/// for a 2-D source, or a single element for a column vector).
fn index_effective_indices(
    num_rows: usize,
    row_num: usize,
    col_num: usize,
    two_arg: bool,
) -> (usize, usize) {
    if two_arg {
        if num_rows == 1 {
            (0, row_num)
        } else {
            (row_num, 0)
        }
    } else {
        (row_num, col_num)
    }
}

/// Extracts the requested cell, row, column or whole array from `arr`.
/// `row_eff`/`col_eff` of `0` select every row/column respectively. A selection
/// that resolves to a single cell is returned as a scalar; otherwise an array.
fn index_from_array(
    arr: &[Vec<ArrayNode>],
    row_eff: usize,
    col_eff: usize,
    cell: CellReferenceIndex,
) -> CalcResult {
    let num_rows = arr.len();
    let num_cols = arr[0].len();
    if row_eff > num_rows || col_eff > num_cols {
        return CalcResult::Error {
            error: Error::REF,
            origin: cell,
            message: "Wrong reference".to_string(),
        };
    }
    let (row_start, row_end) = if row_eff == 0 {
        (1, num_rows)
    } else {
        (row_eff, row_eff)
    };
    let (col_start, col_end) = if col_eff == 0 {
        (1, num_cols)
    } else {
        (col_eff, col_eff)
    };
    if row_start == row_end && col_start == col_end {
        return array_node_to_calc_result(&arr[row_start - 1][col_start - 1], cell);
    }
    let mut result = Vec::with_capacity(row_end - row_start + 1);
    for r in row_start..=row_end {
        let mut data_row = Vec::with_capacity(col_end - col_start + 1);
        for c in col_start..=col_end {
            data_row.push(arr[r - 1][c - 1].clone());
        }
        result.push(data_row);
    }
    CalcResult::Array(result)
}

impl<'a> Model<'a> {
    /// Materializes a value that is expected to be a vector (a single row or a
    /// single column) into a flat list of values. Accepts both range references
    /// and in-formula array literals. Used by the vector-based lookup functions
    /// (MATCH, LOOKUP). Returns the appropriate error `CalcResult` when the value
    /// is not a vector or not a valid source.
    fn as_vector(
        &mut self,
        value: CalcResult,
        cell: CellReferenceIndex,
    ) -> Result<Vec<CalcResult>, CalcResult> {
        match value {
            CalcResult::Range { left, right } => {
                let is_row_vector = if left.row == right.row {
                    false
                } else if left.column == right.column {
                    true
                } else {
                    return Err(CalcResult::Error {
                        error: Error::ERROR,
                        origin: cell,
                        message: "Argument must be a vector".to_string(),
                    });
                };
                Ok(self.prepare_array(&left, &right, is_row_vector))
            }
            CalcResult::Array(array) => {
                // An array is a vector if it is a single row or a single column.
                let is_vector = array.len() == 1 || array.iter().all(|row| row.len() == 1);
                if !is_vector {
                    return Err(CalcResult::Error {
                        error: Error::ERROR,
                        origin: cell,
                        message: "Argument must be a vector".to_string(),
                    });
                }
                Ok(array
                    .iter()
                    .flatten()
                    .map(|node| array_node_to_calc_result(node, cell))
                    .collect())
            }
            error @ CalcResult::Error { .. } => Err(error),
            _ => Err(CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Invalid".to_string(),
            }),
        }
    }

    // INDEX(array, row_num, [column_num])
    // INDEX(range, row_num, [column_num], [area_num])
    // At the moment IronCalc does not support references with multiple areas,
    // so area_num = 1 (or missing).
    pub(crate) fn fn_index(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(2..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        // area_num (4th argument). We only support references with a single area,
        // so anything other than 1 is out of range.
        if args.len() == 4 {
            let area_num = match self.get_number(&args[3], cell) {
                Ok(f) => f.floor() as i64,
                Err(s) => return s,
            };
            if area_num < 1 {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Argument must be >= 1".to_string(),
                };
            }
            if area_num != 1 {
                return CalcResult::Error {
                    error: Error::REF,
                    origin: cell,
                    message: "Area out of range".to_string(),
                };
            }
        }
        // A missing or empty argument evaluates to 0, which means "the whole
        // row/column". A negative index is an error.
        let row_num = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if row_num < 0.0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Argument must be >= 0".to_string(),
            };
        }
        let two_arg = args.len() == 2;
        let col_num = if two_arg {
            0.0
        } else {
            match self.get_number(&args[2], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        };
        if col_num < 0.0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Argument must be >= 0".to_string(),
            };
        }
        let row_num = row_num.floor() as usize;
        let col_num = col_num.floor() as usize;

        match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Range { left, right } => {
                let num_rows = (right.row - left.row + 1) as usize;
                let (row_eff, col_eff) =
                    index_effective_indices(num_rows, row_num, col_num, two_arg);
                let num_cols = (right.column - left.column + 1) as usize;
                if row_eff > num_rows || col_eff > num_cols {
                    return CalcResult::Error {
                        error: Error::REF,
                        origin: cell,
                        message: "Wrong reference".to_string(),
                    };
                }
                let (row_start, row_end) = if row_eff == 0 {
                    (left.row, right.row)
                } else {
                    let r = left.row + row_eff as i32 - 1;
                    (r, r)
                };
                let (col_start, col_end) = if col_eff == 0 {
                    (left.column, right.column)
                } else {
                    let c = left.column + col_eff as i32 - 1;
                    (c, c)
                };
                if row_start == row_end && col_start == col_end {
                    self.evaluate_cell(CellReferenceIndex {
                        sheet: left.sheet,
                        row: row_start,
                        column: col_start,
                    })
                } else {
                    CalcResult::Range {
                        left: CellReferenceIndex {
                            sheet: left.sheet,
                            row: row_start,
                            column: col_start,
                        },
                        right: CellReferenceIndex {
                            sheet: left.sheet,
                            row: row_end,
                            column: col_end,
                        },
                    }
                }
            }
            CalcResult::Array(arr) => {
                if arr.is_empty() || arr[0].is_empty() {
                    return CalcResult::Error {
                        error: Error::REF,
                        origin: cell,
                        message: "Empty array".to_string(),
                    };
                }
                let (row_eff, col_eff) =
                    index_effective_indices(arr.len(), row_num, col_num, two_arg);
                index_from_array(&arr, row_eff, col_eff, cell)
            }
            error @ CalcResult::Error { .. } => error,
            _ => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Expecting a Range".to_string(),
            },
        }
    }

    //     MATCH(lookup_value, lookup_array, [match_type])
    // The MATCH function syntax has the following arguments:
    //   * lookup_value    Required. The value that you want to match in lookup_array.
    //                     The lookup_value argument can be a value (number, text, or logical value)
    //                     or a cell reference to a number, text, or logical value.
    //   * lookup_array    Required. The range of cells being searched.
    //   * match_type      Optional. The number -1, 0, or 1.
    //                     The match_type argument specifies how Excel matches lookup_value
    //                     with values in lookup_array. The default value for this argument is 1.
    // NOTE: Please read the caveat above in binary search
    pub(crate) fn fn_match(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 3 || args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let target = self.evaluate_node_in_context(&args[0], cell);
        if target.is_error() {
            return target;
        }
        if matches!(target, CalcResult::EmptyCell) {
            return CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Cannot match empty cell".to_string(),
            };
        }
        let match_type = if args.len() == 3 {
            match self.get_number(&args[2], cell) {
                Ok(v) => v as i32,
                Err(s) => return s,
            }
        } else {
            1
        };
        let match_range = self.evaluate_node_in_context(&args[1], cell);

        // MATCH operates on a vector (a single row or single column). We
        // materialize the second argument, be it a range reference or an array
        // literal, into a flat list of values and then run the search on it.
        let values = match self.as_vector(match_range, cell) {
            Ok(values) => values,
            Err(error) => return error,
        };

        match match_type {
            -1 => {
                // We apply binary search leftmost for value in the vector
                let mut l = 0;
                let mut r = values.len();
                while l < r {
                    let m = (l + r) / 2;
                    if compare_values(&values[m], &target) >= 0 {
                        l = m + 1;
                    } else {
                        r = m;
                    }
                }
                // r is the number of elements less than target in the vector
                // If target is less than the minimum return #N/A
                if l == 0 {
                    return CalcResult::Error {
                        error: Error::NA,
                        origin: cell,
                        message: "Not found".to_string(),
                    };
                }
                // Now l points to the leftmost element
                CalcResult::Number(l as f64)
            }
            0 => {
                // We apply linear search
                let result_matches: Box<dyn Fn(&CalcResult) -> bool> =
                    if let CalcResult::String(s) = &target {
                        if let Ok(reg) = from_wildcard_to_regex(&s.to_lowercase(), true) {
                            Box::new(move |x| result_matches_regex(x, &reg))
                        } else {
                            Box::new(move |_| false)
                        }
                    } else {
                        Box::new(move |x| values_are_equal(x, &target))
                    };
                for (l, value) in values.iter().enumerate() {
                    if result_matches(value) {
                        return CalcResult::Number(l as f64 + 1.0);
                    }
                }
                CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Not found".to_string(),
                }
            }
            _ => {
                // l is the number of elements less than target in the vector
                let l = binary_search_on_array(&target, &values);
                if l == -2 {
                    return CalcResult::Error {
                        error: Error::NA,
                        origin: cell,
                        message: "Not found".to_string(),
                    };
                }

                CalcResult::Number(l as f64 + 1.0)
            }
        }
    }

    /// HLOOKUP(lookup_value, table_array, row_index, [is_sorted])
    /// We look for `lookup_value` in the first row of table array
    /// We return the value in row `row_index` of the same column in `table_array`
    /// `is_sorted` is true by default and assumes that values in first row are ordered
    pub(crate) fn fn_hlookup(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 4 || args.len() < 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let lookup_value = self.evaluate_node_in_context(&args[0], cell);
        if lookup_value.is_error() {
            return lookup_value;
        }
        let row_index = match self.get_number(&args[2], cell) {
            Ok(v) => v.floor() as i32,
            Err(s) => return s,
        };
        let is_sorted = if args.len() == 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(v) => v,
                Err(s) => return s,
            }
        } else {
            true
        };
        let range = self.evaluate_node_in_context(&args[1], cell);
        let table = match range {
            CalcResult::Range { left, right } => LookupTable::Range { left, right },
            CalcResult::Array(array) => LookupTable::Array(array),
            error @ CalcResult::Error { .. } => return error,
            CalcResult::String(_) => {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Range expected".to_string(),
                }
            }
            _ => {
                return CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Range expected".to_string(),
                }
            }
        };
        // `row_index` is 1-based and must point inside the table
        if row_index < 1 || row_index > table.rows() {
            return CalcResult::Error {
                error: Error::REF,
                origin: cell,
                message: "Invalid reference".to_string(),
            };
        }
        // We look for `lookup_value` in the first row of the table
        let search_vector = table.first_row(self, cell);
        match lookup_index(&lookup_value, &search_vector, is_sorted) {
            Some(column) => table.get(self, row_index - 1, column as i32, cell),
            None => CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Not found".to_string(),
            },
        }
    }

    /// VLOOKUP(lookup_value, table_array, row_index, [is_sorted])
    /// We look for `lookup_value` in the first column of table array
    /// We return the value in column `column_index` of the same row in `table_array`
    /// `is_sorted` is true by default and assumes that values in first column are ordered
    pub(crate) fn fn_vlookup(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 4 || args.len() < 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let lookup_value = self.evaluate_node_in_context(&args[0], cell);
        if lookup_value.is_error() {
            return lookup_value;
        }
        let column_index = match self.get_number(&args[2], cell) {
            Ok(v) => v.floor() as i32,
            Err(s) => return s,
        };
        let is_sorted = if args.len() == 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(v) => v,
                Err(s) => return s,
            }
        } else {
            true
        };
        let range = self.evaluate_node_in_context(&args[1], cell);
        let table = match range {
            CalcResult::Range { left, right } => LookupTable::Range { left, right },
            CalcResult::Array(array) => LookupTable::Array(array),
            error @ CalcResult::Error { .. } => return error,
            CalcResult::String(_) => {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Range expected".to_string(),
                }
            }
            _ => {
                return CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Range expected".to_string(),
                }
            }
        };
        // `column_index` is 1-based and must point inside the table
        if column_index < 1 || column_index > table.columns() {
            return CalcResult::Error {
                error: Error::REF,
                origin: cell,
                message: "Invalid reference".to_string(),
            };
        }
        // We look for `lookup_value` in the first column of the table
        let search_vector = table.first_column(self, cell);
        match lookup_index(&lookup_value, &search_vector, is_sorted) {
            Some(row) => table.get(self, row as i32, column_index - 1, cell),
            None => CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Not found".to_string(),
            },
        }
    }

    // LOOKUP has two forms:
    //   * Vector form: LOOKUP(lookup_value, lookup_vector, result_vector)
    //     Searches a one-row/one-column `lookup_vector` and returns the value at
    //     the same position in `result_vector`.
    //   * Array form: LOOKUP(lookup_value, array)
    //     If `array` has more columns than rows it searches the first row and
    //     returns from the last row; otherwise it searches the first column and
    //     returns from the last column. (This subsumes the vector case where the
    //     "first" and "last" row/column coincide.)
    // Important: The values being searched must be placed in ascending order:
    // ..., -2, -1, 0, 1, 2, ..., A-Z, FALSE, TRUE;
    // otherwise, LOOKUP might not return the correct value.
    // Uppercase and lowercase text are equivalent.
    // NOTE: Please read the caveat above in binary search
    pub(crate) fn fn_lookup(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 3 || args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let target = self.evaluate_node_in_context(&args[0], cell);
        if target.is_error() {
            return target;
        }
        // LOOKUP always assumes the values being searched are in ascending order.
        let not_found = CalcResult::Error {
            error: Error::NA,
            origin: cell,
            message: "Not found".to_string(),
        };

        if args.len() == 3 {
            // Vector form: search the lookup vector, return from the result
            // vector at the same position.
            let value = self.evaluate_node_in_context(&args[1], cell);
            let lookup_vector = match self.as_vector(value, cell) {
                Ok(values) => values,
                Err(error) => return error,
            };
            let l = match lookup_index(&target, &lookup_vector, true) {
                Some(l) => l,
                None => return not_found,
            };
            let result = self.evaluate_node_in_context(&args[2], cell);
            let result_vector = match self.as_vector(result, cell) {
                Ok(values) => values,
                Err(error) => return error,
            };
            return result_vector.into_iter().nth(l).unwrap_or(not_found);
        }

        // Array form (also covers a plain vector, where the first and last
        // row/column coincide).
        let value = self.evaluate_node_in_context(&args[1], cell);
        let table = match value {
            CalcResult::Range { left, right } => LookupTable::Range { left, right },
            CalcResult::Array(array) => LookupTable::Array(array),
            error @ CalcResult::Error { .. } => return error,
            _ => {
                return CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Invalid".to_string(),
                }
            }
        };
        if table.columns() > table.rows() {
            // Search the first row, return from the last row.
            let search_vector = table.first_row(self, cell);
            match lookup_index(&target, &search_vector, true) {
                Some(column) => table.get(self, table.rows() - 1, column as i32, cell),
                None => not_found,
            }
        } else {
            // Search the first column, return from the last column.
            let search_vector = table.first_column(self, cell);
            match lookup_index(&target, &search_vector, true) {
                Some(row) => table.get(self, row as i32, table.columns() - 1, cell),
                None => not_found,
            }
        }
    }

    // HYPERLINK(link_location, [friendly_name])
    // Attaches a link to the cell and returns friendly_name (or link_location
    // if friendly_name is missing). A link_location starting with "#" is an
    // internal link ("#Sheet1!A1"), anything else is external.
    // The link itself is dynamic: it lives in `Model::links` and is rebuilt on
    // every evaluation, it is not part of the workbook.
    pub(crate) fn fn_hyperlink(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let location = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let display = if args.len() == 2 {
            // The friendly name is the value displayed in the cell. It can be
            // a string, a number or a boolean.
            let result = self.evaluate_node_in_context(&args[1], cell);
            match result {
                CalcResult::Range { .. } | CalcResult::Array(_) => {
                    match self.cast_to_string(result, cell) {
                        Ok(s) => CalcResult::String(s),
                        Err(error) => error,
                    }
                }
                other => other,
            }
        } else {
            CalcResult::String(location.clone())
        };
        // A cell displaying an error is not clickable: no link is attached
        if matches!(display, CalcResult::Error { .. }) {
            return display;
        }

        let link = match location.strip_prefix('#') {
            Some(internal) => crate::types::Link::Internal {
                location: internal.to_string(),
                tooltip: None,
            },
            None => crate::types::Link::External {
                target: location,
                tooltip: None,
            },
        };
        self.links.insert((cell.sheet, cell.row, cell.column), link);
        display
    }

    // ROW([reference])
    // If reference is not present returns the row of the present cell.
    // Otherwise returns the row number of reference. A reference that spans
    // several rows gives a column with the number of each of them.
    pub(crate) fn fn_row(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 1 {
            return CalcResult::new_args_number_error(cell);
        }
        if args.is_empty() {
            return CalcResult::Number(cell.row as f64);
        }
        match self.get_reference(&args[0], cell) {
            Ok(c) => {
                let first = c.left.row.min(c.right.row);
                let last = c.left.row.max(c.right.row);
                if first == last {
                    return CalcResult::Number(first as f64);
                }
                CalcResult::Array(
                    (first..=last)
                        .map(|row| vec![ArrayNode::Number(row as f64)])
                        .collect(),
                )
            }
            Err(s) => s,
        }
    }

    // ROWS(range)
    // Returns the number of rows in range
    pub(crate) fn fn_rows(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.get_reference(&args[0], cell) {
            Ok(c) => CalcResult::Number((c.right.row - c.left.row + 1) as f64),
            Err(s) => s,
        }
    }

    // COLUMN([reference])
    // If reference is not present returns the column of the present cell.
    // Otherwise returns the column number of reference. A reference that spans
    // several columns gives a row with the number of each of them.
    pub(crate) fn fn_column(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 1 {
            return CalcResult::new_args_number_error(cell);
        }
        if args.is_empty() {
            return CalcResult::Number(cell.column as f64);
        }

        match self.get_reference(&args[0], cell) {
            Ok(range) => {
                let first = range.left.column.min(range.right.column);
                let last = range.left.column.max(range.right.column);
                if first == last {
                    return CalcResult::Number(first as f64);
                }
                CalcResult::Array(vec![(first..=last)
                    .map(|column| ArrayNode::Number(column as f64))
                    .collect()])
            }
            Err(s) => s,
        }
    }

    /// CHOOSE(index_num, value1, [value2], ...)
    /// Uses index_num to return a value from the list of value arguments.
    pub(crate) fn fn_choose(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }

        // The index argument may be a single number or an array/range. In the array
        // case we broadcast: each index element selects the matching value argument,
        // collapsed to a single scalar (the result has the shape of the index array).
        match self.get_number_or_array(&args[0], cell) {
            Ok(NumberOrArray::Number(index_num)) => {
                let index_num = index_num as usize;
                if index_num < 1 || index_num > (args.len() - 1) {
                    return CalcResult::new_error(Error::VALUE, cell, "Invalid index".to_string());
                }
                self.evaluate_node_with_reference(&args[index_num], cell)
            }
            Ok(NumberOrArray::Array(index_array)) => {
                let result = index_array
                    .iter()
                    .map(|row| {
                        row.iter()
                            .map(|node| self.choose_element(args, node, cell))
                            .collect()
                    })
                    .collect();
                CalcResult::Array(result)
            }
            Err(calc_err) => calc_err,
        }
    }

    /// Selects the CHOOSE value argument for a single index element and collapses
    /// it to one array cell. A chosen range is reduced by implicit intersection.
    fn choose_element(
        &mut self,
        args: &[Node],
        index_node: &ArrayNode,
        cell: CellReferenceIndex,
    ) -> ArrayNode {
        let index_num = match index_node {
            ArrayNode::Number(n) => *n,
            ArrayNode::Boolean(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            ArrayNode::Empty => 0.0,
            ArrayNode::String(s) => match self.cast_number(s) {
                Some(f) => f,
                None => return ArrayNode::Error(Error::VALUE),
            },
            ArrayNode::Error(e) => return ArrayNode::Error(e.clone()),
        } as usize;

        if index_num < 1 || index_num > (args.len() - 1) {
            return ArrayNode::Error(Error::VALUE);
        }

        let result = self.evaluate_node_with_reference(&args[index_num], cell);
        let value = self.implicit_intersection_to_value(result, cell);
        calc_result_to_array_node(value)
    }

    // COLUMNS(range)
    // Returns the number of columns in range
    pub(crate) fn fn_columns(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.get_reference(&args[0], cell) {
            Ok(c) => CalcResult::Number((c.right.column - c.left.column + 1) as f64),
            Err(s) => s,
        }
    }

    // INDIRECT(ref_text, [a1])
    // Returns the reference specified by 'ref_text'. It is read in A1 notation
    // unless 'a1' is FALSE, in which case it is read in R1C1 notation.
    pub(crate) fn fn_indirect(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 2 || args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let ref_text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(v) => return v,
        };
        let a1 = if args.len() == 2 {
            match self.get_boolean(&args[1], cell) {
                Ok(b) => b,
                Err(v) => return v,
            }
        } else {
            true
        };

        let parsed_reference = if a1 {
            ParsedReference::parse_reference_formula(
                Some(cell.sheet),
                &ref_text,
                self.locale,
                |name| self.get_sheet_index_by_name(name),
            )
        } else {
            ParsedReference::parse_r1c1_reference(cell, &ref_text, |name| {
                self.get_sheet_index_by_name(name)
            })
        };

        match parsed_reference {
            Ok(ParsedReference::CellReference(reference)) => CalcResult::Range {
                left: reference,
                right: reference,
            },
            Ok(ParsedReference::Range(left, right)) => CalcResult::Range { left, right },
            Err(message) => CalcResult::Error {
                error: Error::REF,
                origin: cell,
                message,
            },
        }
    }

    // OFFSET(reference, rows, cols, [height], [width])
    // Returns a reference to a range that is a specified number of rows and columns from a cell or range of cells.
    // The reference that is returned can be a single cell or a range of cells.
    // You can specify the number of rows and the number of columns to be returned.
    pub(crate) fn fn_offset(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let l = args.len();
        if !(3..=5).contains(&l) {
            return CalcResult::new_args_number_error(cell);
        }
        let reference = match self.get_reference(&args[0], cell) {
            Ok(c) => c,
            Err(s) => return s,
        };
        let rows = match self.get_number(&args[1], cell) {
            Ok(c) => {
                if c < 0.0 {
                    c.ceil() as i32
                } else {
                    c.floor() as i32
                }
            }
            Err(s) => return s,
        };
        let cols = match self.get_number(&args[2], cell) {
            Ok(c) => {
                if c < 0.0 {
                    c.ceil() as i32
                } else {
                    c.floor() as i32
                }
            }
            Err(s) => return s,
        };
        let row_start = reference.left.row + rows;
        let column_start = reference.left.column + cols;
        let width;
        let height;
        if l == 4 {
            height = match self.get_number(&args[3], cell) {
                Ok(c) => {
                    if c < 1.0 {
                        c.ceil() as i32 - 1
                    } else {
                        c.floor() as i32 - 1
                    }
                }
                Err(s) => return s,
            };
            width = reference.right.column - reference.left.column;
        } else if l == 5 {
            height = match self.get_number(&args[3], cell) {
                Ok(c) => {
                    if c < 1.0 {
                        c.ceil() as i32 - 1
                    } else {
                        c.floor() as i32 - 1
                    }
                }
                Err(s) => return s,
            };
            width = match self.get_number(&args[4], cell) {
                Ok(c) => {
                    if c < 1.0 {
                        c.ceil() as i32 - 1
                    } else {
                        c.floor() as i32 - 1
                    }
                }
                Err(s) => return s,
            };
        } else {
            width = reference.right.column - reference.left.column;
            height = reference.right.row - reference.left.row;
        }
        // This is what Excel does
        if width == -1 || height == -1 {
            return CalcResult::Error {
                error: Error::REF,
                origin: cell,
                message: "Invalid reference".to_string(),
            };
        }
        // NB: Excel documentation says that negative values of width and height are not valid
        // but in practice they are valid. We follow the documentation and not Excel
        if width < -1 || height < -1 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "width and height cannot be negative".to_string(),
            };
        }

        let column_end = column_start + width;
        let row_end = row_start + height;
        if row_start < 1 || row_end > LAST_ROW || column_start < 1 || column_end > LAST_COLUMN {
            return CalcResult::Error {
                error: Error::REF,
                origin: cell,
                message: "Invalid reference".to_string(),
            };
        }
        let left = CellReferenceIndex {
            sheet: reference.left.sheet,
            row: row_start,
            column: column_start,
        };
        let right = CellReferenceIndex {
            sheet: reference.right.sheet,
            row: row_end,
            column: column_end,
        };
        CalcResult::Range { left, right }
    }

    // FORMULATEXT(reference)
    // Returns a formula as a string. Two differences with Excel:
    // - It returns the formula in English
    // - It formats the formula without spaces between elements
    pub(crate) fn fn_formulatext(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        if let CalcResult::Range { left, right } = self.evaluate_node_with_reference(&args[0], cell)
        {
            if left.sheet != right.sheet {
                return CalcResult::Error {
                    error: Error::ERROR,
                    origin: cell,
                    message: "3D ranges not supported".to_string(),
                };
            }
            if left.row != right.row || left.column != right.column {
                // FIXME: Implicit intersection or dynamic arrays
                return CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "argument must be a reference to a single cell".to_string(),
                };
            }
            if let Ok(Some(f)) = self.get_english_cell_formula(left.sheet, left.row, left.column) {
                CalcResult::String(f)
            } else {
                CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Reference does not have a formula".to_string(),
                }
            }
        } else {
            CalcResult::Error {
                error: Error::ERROR,
                origin: cell,
                message: "Argument must be a reference".to_string(),
            }
        }
    }
}
