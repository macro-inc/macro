use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

use super::util::compare_values;

/// Compare two sort keys following Excel's rules:
///   Numbers < Strings < Booleans < Errors < Empty cells
/// Empty cells always sort last regardless of ascending/descending.
fn sort_key_cmp(
    a: &ArrayNode,
    b: &ArrayNode,
    ascending: bool,
    cell: CellReferenceIndex,
) -> Ordering {
    let a_empty = matches!(a, ArrayNode::Empty);
    let b_empty = matches!(b, ArrayNode::Empty);
    match (a_empty, b_empty) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => {
            let key_a = array_node_to_calc_result(a, cell);
            let key_b = array_node_to_calc_result(b, cell);
            let cmp = compare_values(&key_a, &key_b);
            if ascending {
                cmp.cmp(&0)
            } else {
                0.cmp(&cmp)
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn array_node_is_truthy(node: &ArrayNode) -> bool {
    match node {
        ArrayNode::Boolean(b) => *b,
        ArrayNode::Number(n) => *n != 0.0,
        _ => false,
    }
}

/// A hashable, equality-normalised representation of a single cell value.
/// Strings are uppercased (matching case-insensitive array_nodes_equal).
/// Numbers use bit-level identity (f64::to_bits), which is exact for all
/// values that actually appear in spreadsheet cells.
#[derive(Hash, Eq, PartialEq)]
enum CellKey {
    Number(u64),
    Boolean(bool),
    Str(String),
    Error(u8),
    Empty,
}

fn cell_key(node: &ArrayNode) -> CellKey {
    match node {
        ArrayNode::Number(n) => CellKey::Number(n.to_bits()),
        ArrayNode::Boolean(b) => CellKey::Boolean(*b),
        ArrayNode::String(s) => CellKey::Str(s.to_uppercase()),
        ArrayNode::Error(e) => CellKey::Error(error_discriminant(e)),
        ArrayNode::Empty => CellKey::Empty,
    }
}

fn error_discriminant(e: &crate::expressions::token::Error) -> u8 {
    use crate::expressions::token::Error;
    match e {
        Error::REF => 0,
        Error::NAME => 1,
        Error::VALUE => 2,
        Error::DIV => 3,
        Error::NA => 4,
        Error::NUM => 5,
        Error::ERROR => 6,
        Error::NIMPL => 7,
        Error::SPILL => 8,
        Error::CALC => 9,
        Error::CIRC => 10,
        Error::NULL => 11,
    }
}

fn row_key(row: &[ArrayNode]) -> Vec<CellKey> {
    row.iter().map(cell_key).collect()
}

fn col_key(data: &[Vec<ArrayNode>], j: usize) -> Vec<CellKey> {
    data.iter().map(|row| cell_key(&row[j])).collect()
}

// Extract a 1-D column key from a 2-D by_array.
// Accepts column vectors (N×1), row vectors (1×N), or the first column of a multi-column array.
fn extract_key_column(data: &[Vec<ArrayNode>], expected_len: usize) -> Option<Vec<ArrayNode>> {
    if data.is_empty() {
        return None;
    }
    if data.len() == expected_len && data[0].len() == 1 {
        Some(data.iter().map(|row| row[0].clone()).collect())
    } else if data.len() == 1 && data[0].len() == expected_len {
        Some(data[0].clone())
    } else if data.len() == expected_len {
        Some(data.iter().map(|row| row[0].clone()).collect())
    } else {
        None
    }
}

impl<'a> Model<'a> {
    /// Evaluate a node and convert the result to a 2-D array of ArrayNodes.
    /// Handles Range references, inline Arrays, and scalar values.
    pub(crate) fn eval_to_array(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<Vec<ArrayNode>>, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        match result {
            CalcResult::Range { left, right } => Ok(self.evaluate_range(left, right)),
            CalcResult::Array(arr) => Ok(arr),
            CalcResult::Number(n) => Ok(vec![vec![ArrayNode::Number(n)]]),
            CalcResult::Boolean(b) => Ok(vec![vec![ArrayNode::Boolean(b)]]),
            CalcResult::String(s) => Ok(vec![vec![ArrayNode::String(s)]]),
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(vec![vec![ArrayNode::Number(0.0)]]),
            err @ CalcResult::Error { .. } => Err(err),
            CalcResult::Lambda(_) => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "LAMBDA cannot be used as an array".to_string(),
            )),
        }
    }

    // ── SORT ──────────────────────────────────────────────────────────────────

    /// `=SORT(array, [sort_index], [sort_order], [by_col])`
    ///
    /// Returns the array sorted by the given column (or row when by_col=TRUE).
    ///   * sort_index – 1-based column/row index to sort by (default 1)
    ///   * sort_order – 1 = ascending, -1 = descending (default 1)
    ///   * by_col     – FALSE = sort rows, TRUE = sort columns (default FALSE)
    pub(crate) fn fn_sort(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();
        let num_cols = data[0].len();

        let sort_index: usize = if args.len() >= 2 {
            match self.get_number(&args[1], cell) {
                Ok(n) => {
                    let n = n as i64;
                    if n < 1 {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "sort_index must be >= 1".to_string(),
                        );
                    }
                    n as usize
                }
                Err(e) => return e,
            }
        } else {
            1
        };

        let ascending: bool = if args.len() >= 3 {
            match self.get_number(&args[2], cell) {
                Ok(n) => match n as i32 {
                    1 => true,
                    -1 => false,
                    _ => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "sort_order must be 1 or -1".to_string(),
                        )
                    }
                },
                Err(e) => return e,
            }
        } else {
            true
        };

        let by_col: bool = if args.len() >= 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };

        if !by_col {
            // Sort rows by column sort_index
            if sort_index > num_cols {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "sort_index exceeds array width".to_string(),
                );
            }
            let key_col = sort_index - 1;

            let mut row_indices: Vec<usize> = (0..num_rows).collect();
            row_indices.sort_by(|&a, &b| {
                sort_key_cmp(&data[a][key_col], &data[b][key_col], ascending, cell)
            });

            CalcResult::Array(row_indices.iter().map(|&r| data[r].clone()).collect())
        } else {
            // Sort columns by row sort_index
            if sort_index > num_rows {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "sort_index exceeds array height".to_string(),
                );
            }
            let key_row = sort_index - 1;

            let mut col_indices: Vec<usize> = (0..num_cols).collect();
            col_indices.sort_by(|&a, &b| {
                sort_key_cmp(&data[key_row][a], &data[key_row][b], ascending, cell)
            });

            CalcResult::Array(
                data.iter()
                    .map(|row| col_indices.iter().map(|&c| row[c].clone()).collect())
                    .collect(),
            )
        }
    }

    // ── SORTBY ────────────────────────────────────────────────────────────────

    /// `=SORTBY(array, by_array1, [sort_order1], [by_array2, sort_order2], ...)`
    ///
    /// Sorts array rows using one or more external key arrays.
    ///   * sort_order values: 1 = ascending (default), -1 = descending
    ///   * by_array must have the same number of rows as array
    ///   * Valid argument counts: 2, 3, 5, 7, … (additional keys in pairs)
    pub(crate) fn fn_sortby(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let n = args.len();
        // Valid: 2, 3, 5, 7, ... (n==2 || n==3 || n>=5 with odd count)
        if n < 2 || (n > 3 && n.is_multiple_of(2)) {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();

        // Collect sort keys: (flat key column, ascending)
        let mut sort_keys: Vec<(Vec<ArrayNode>, bool)> = Vec::new();

        // First key at args[1], optional order at args[2]
        let key1 = match self.eval_to_array(&args[1], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let key1_flat = match extract_key_column(&key1, num_rows) {
            Some(k) => k,
            None => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "by_array1 must have the same number of rows as array".to_string(),
                )
            }
        };
        let order1 = if n >= 3 {
            match self.get_number(&args[2], cell) {
                Ok(v) => match v as i32 {
                    1 => true,
                    -1 => false,
                    _ => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "sort_order must be 1 or -1".to_string(),
                        )
                    }
                },
                Err(e) => return e,
            }
        } else {
            true
        };
        sort_keys.push((key1_flat, order1));

        // Additional key/order pairs starting at args[3]
        let mut i = 3;
        while i < n {
            let key = match self.eval_to_array(&args[i], cell) {
                Ok(d) => d,
                Err(e) => return e,
            };
            let key_flat = match extract_key_column(&key, num_rows) {
                Some(k) => k,
                None => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "by_array must have the same number of rows as array".to_string(),
                    )
                }
            };
            let ascending = if i + 1 < n {
                match self.get_number(&args[i + 1], cell) {
                    Ok(v) => match v as i32 {
                        1 => true,
                        -1 => false,
                        _ => {
                            return CalcResult::new_error(
                                Error::VALUE,
                                cell,
                                "sort_order must be 1 or -1".to_string(),
                            )
                        }
                    },
                    Err(e) => return e,
                }
            } else {
                true
            };
            sort_keys.push((key_flat, ascending));
            i += 2;
        }

        let mut row_indices: Vec<usize> = (0..num_rows).collect();
        row_indices.sort_by(|&a, &b| {
            for (keys, ascending) in &sort_keys {
                let ord = sort_key_cmp(&keys[a], &keys[b], *ascending, cell);
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            Ordering::Equal
        });

        CalcResult::Array(row_indices.iter().map(|&r| data[r].clone()).collect())
    }

    // ── UNIQUE ────────────────────────────────────────────────────────────────

    /// `=UNIQUE(array, [by_col], [exactly_once])`
    ///
    /// Returns the unique rows (or columns) from array.
    ///   * by_col       – FALSE = deduplicate rows, TRUE = deduplicate columns (default FALSE)
    ///   * exactly_once – FALSE = return one copy of every distinct value (default)
    ///     TRUE  = return only rows/columns that appear exactly once
    pub(crate) fn fn_unique(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let by_col: bool = if args.len() >= 2 {
            match self.get_boolean(&args[1], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };

        let exactly_once: bool = if args.len() >= 3 {
            match self.get_boolean(&args[2], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };

        if !by_col {
            let num_rows = data.len();

            // First pass: count how many times each row key appears.
            let mut counts: HashMap<Vec<CellKey>, usize> = HashMap::with_capacity(num_rows);
            for row in &data {
                *counts.entry(row_key(row)).or_insert(0) += 1;
            }

            // Second pass: collect rows in original order.
            let result: Vec<Vec<ArrayNode>> = if exactly_once {
                data.into_iter()
                    .filter(|row| counts[&row_key(row)] == 1)
                    .collect()
            } else {
                let mut seen: HashSet<Vec<CellKey>> = HashSet::with_capacity(num_rows);
                data.into_iter()
                    .filter(|row| seen.insert(row_key(row)))
                    .collect()
            };

            if result.is_empty() {
                return CalcResult::new_error(
                    Error::CALC,
                    cell,
                    "UNIQUE found no matching rows".to_string(),
                );
            }

            CalcResult::Array(result)
        } else {
            let num_cols = data[0].len();

            // First pass: count how many times each column key appears.
            let mut counts: HashMap<Vec<CellKey>, usize> = HashMap::with_capacity(num_cols);
            for j in 0..num_cols {
                *counts.entry(col_key(&data, j)).or_insert(0) += 1;
            }

            // Second pass: collect column indices in original order.
            let result_cols: Vec<usize> = if exactly_once {
                (0..num_cols)
                    .filter(|&j| counts[&col_key(&data, j)] == 1)
                    .collect()
            } else {
                let mut seen: HashSet<Vec<CellKey>> = HashSet::with_capacity(num_cols);
                (0..num_cols)
                    .filter(|&j| seen.insert(col_key(&data, j)))
                    .collect()
            };

            if result_cols.is_empty() {
                return CalcResult::new_error(
                    Error::CALC,
                    cell,
                    "UNIQUE found no matching columns".to_string(),
                );
            }

            CalcResult::Array(
                data.iter()
                    .map(|row| result_cols.iter().map(|&c| row[c].clone()).collect())
                    .collect(),
            )
        }
    }

    // ── FILTER ────────────────────────────────────────────────────────────────

    /// `=FILTER(array, include, [if_empty])`
    ///
    /// Returns only the rows of array where the corresponding include value is truthy.
    ///   * include  – a column vector of booleans/numbers with the same height as array
    ///   * if_empty – value returned when no rows pass the filter (default: #CALC! error)
    ///
    /// Note: include must be a range reference or inline array containing boolean/numeric
    /// values. For comparison-based filtering (e.g. A1:A5>3) store the comparison result
    /// in a helper column first.
    pub(crate) fn fn_filter(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();
        let num_cols = data[0].len();

        let include = match self.eval_to_array(&args[1], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        // Strings and errors are invalid as include mask elements.
        // Strings → #VALUE!; errors → propagate the error.
        for row in &include {
            for node in row {
                match node {
                    ArrayNode::Boolean(_) | ArrayNode::Number(_) | ArrayNode::Empty => {}
                    ArrayNode::String(_) => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "include array must contain numbers or booleans".to_string(),
                        );
                    }
                    ArrayNode::Error(e) => {
                        return CalcResult::new_error(
                            e.clone(),
                            cell,
                            "include array contains an error".to_string(),
                        );
                    }
                }
            }
        }

        // Determine whether we are filtering rows or columns
        let include_flat: Vec<bool>;
        let filter_rows: bool;

        if include.len() == num_rows && include[0].len() == 1 {
            // Column vector — filter rows
            include_flat = include
                .iter()
                .map(|row| array_node_is_truthy(&row[0]))
                .collect();
            filter_rows = true;
        } else if include.len() == 1 && include[0].len() == num_rows {
            // Row vector with length == num_rows — also filter rows
            include_flat = include[0].iter().map(array_node_is_truthy).collect();
            filter_rows = true;
        } else if include.len() == 1 && include[0].len() == num_cols {
            // Row vector — filter columns
            include_flat = include[0].iter().map(array_node_is_truthy).collect();
            filter_rows = false;
        } else if include.len() == num_cols && include[0].len() == 1 {
            // Column vector with length == num_cols — filter columns
            include_flat = include
                .iter()
                .map(|row| array_node_is_truthy(&row[0]))
                .collect();
            filter_rows = false;
        } else {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "include array dimensions must match array rows or columns".to_string(),
            );
        }

        let filtered: Vec<Vec<ArrayNode>> = if filter_rows {
            data.into_iter()
                .enumerate()
                .filter_map(|(i, row)| if include_flat[i] { Some(row) } else { None })
                .collect()
        } else {
            let col_indices: Vec<usize> = include_flat
                .iter()
                .enumerate()
                .filter_map(|(i, &keep)| if keep { Some(i) } else { None })
                .collect();
            data.iter()
                .map(|row| col_indices.iter().map(|&c| row[c].clone()).collect())
                .collect()
        };

        let is_empty_result = filtered.is_empty() || filtered.first().is_none_or(|r| r.is_empty());

        if is_empty_result {
            if args.len() >= 3 {
                let empty_val = self.evaluate_node_in_context(&args[2], cell);
                match empty_val {
                    CalcResult::EmptyArg => CalcResult::new_error(
                        Error::CALC,
                        cell,
                        "No data returned by FILTER".to_string(),
                    ),
                    // A range is its values: FILTER gives values, never a
                    // reference, found or not
                    CalcResult::Range { left, right } => {
                        CalcResult::Array(self.evaluate_range(left, right))
                    }
                    // The value as it is, not an array holding it: to the
                    // function that receives it, `""` is a text and not an
                    // array with a text in it, which MAX for one would ignore.
                    v => v,
                }
            } else {
                CalcResult::new_error(Error::CALC, cell, "No data returned by FILTER".to_string())
            }
        } else {
            CalcResult::Array(filtered)
        }
    }
}
