use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult,
    expressions::parser::{ArrayNode, Node},
    expressions::token::Error,
    model::Model,
};

use super::{
    binary_search::{
        binary_search_descending_or_greater, binary_search_descending_or_smaller,
        binary_search_or_greater, binary_search_or_smaller,
    },
    util::{compare_values, from_wildcard_to_regex, result_matches_regex},
};

#[derive(PartialEq, Clone, Copy)]
enum SearchMode {
    StartAtFirstItem = 1,
    StartAtLastItem = -1,
    BinarySearchDescending = -2,
    BinarySearchAscending = 2,
}

#[derive(PartialEq, Clone, Copy)]
enum MatchMode {
    ExactMatchSmaller = -1,
    ExactMatch = 0,
    ExactMatchLarger = 1,
    WildcardMatch = 2,
}

/// MACRO: a lookup or return array of XLOOKUP: a range, or an array computed
/// by the formula.
enum Table {
    Range {
        left: CellReferenceIndex,
        right: CellReferenceIndex,
    },
    Array(Vec<Vec<ArrayNode>>),
}

impl Table {
    fn rows(&self) -> i32 {
        match self {
            Table::Range { left, right } => right.row - left.row + 1,
            Table::Array(array) => array.len() as i32,
        }
    }

    fn columns(&self) -> i32 {
        match self {
            Table::Range { left, right } => right.column - left.column + 1,
            Table::Array(array) => array.first().map_or(0, |row| row.len()) as i32,
        }
    }
}

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

// lookup_value in array, match_mode search_mode
fn linear_search(
    lookup_value: &CalcResult,
    array: &[CalcResult],
    search_mode: SearchMode,
    match_mode: MatchMode,
) -> Option<usize> {
    let length = array.len();

    match match_mode {
        MatchMode::ExactMatch => {
            // exact match
            for l in 0..length {
                let index = if search_mode == SearchMode::StartAtFirstItem {
                    l
                } else {
                    length - l - 1
                };

                let value = &array[index];
                if compare_values(value, lookup_value) == 0 {
                    return Some(index);
                }
            }
            return None;
        }
        MatchMode::ExactMatchSmaller | MatchMode::ExactMatchLarger => {
            // exact match, if none found return the next smaller/larger item
            let mut found_index = 0;
            let mut approx = None;
            let m_mode = match_mode as i32;
            for l in 0..length {
                let index = if search_mode == SearchMode::StartAtFirstItem {
                    l
                } else {
                    length - l - 1
                };

                let value = &array[index];
                let c = compare_values(value, lookup_value);
                if c == 0 {
                    return Some(index);
                } else if c == m_mode {
                    match approx {
                        None => {
                            approx = Some(value.clone());
                            found_index = index;
                        }
                        Some(ref p) => {
                            if compare_values(p, value) == m_mode {
                                approx = Some(value.clone());
                                found_index = index;
                            }
                        }
                    }
                }
            }
            if approx.is_none() {
                return None;
            } else {
                return Some(found_index);
            }
        }
        MatchMode::WildcardMatch => {
            let result_matches: Box<dyn Fn(&CalcResult) -> bool> =
                if let CalcResult::String(s) = &lookup_value {
                    if let Ok(reg) = from_wildcard_to_regex(&s.to_lowercase(), true) {
                        Box::new(move |x| result_matches_regex(x, &reg))
                    } else {
                        Box::new(move |_| false)
                    }
                } else {
                    Box::new(move |x| compare_values(x, lookup_value) == 0)
                };
            for l in 0..length {
                let index = if search_mode == SearchMode::StartAtFirstItem {
                    l
                } else {
                    length - l - 1
                };
                let value = &array[index];
                if result_matches(value) {
                    return Some(index);
                }
            }
        }
    }
    None
}

impl<'a> Model<'a> {
    /// The XLOOKUP function searches a range or an array, and then returns the item corresponding
    /// to the first match it finds. If no match exists, then XLOOKUP can return the closest (approximate) match.
    /// =XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
    ///
    /// lookup_array and return_array must be column or row arrays and of the same dimension.
    /// Otherwise #VALUE! is returned
    /// [if_not_found]
    /// Where a valid match is not found, return the [if_not_found] text you supply.
    /// If a valid match is not found, and [if_not_found] is missing, #N/A is returned.
    ///
    /// [match_mode]
    /// Specify the match type:
    ///   *  0 - Exact match. If none found, return #N/A. This is the default.
    ///   * -1 - Exact match. If none found, return the next smaller item.
    ///   *  1 - Exact match. If none found, return the next larger item.
    ///   *  2 - A wildcard match where *, ?, and ~ have special meaning.
    ///
    /// [search_mode]
    /// Specify the search mode to use:
    ///   *  1 - Perform a search starting at the first item. This is the default.
    ///   * -1 - Perform a reverse search starting at the last item.
    ///   *  2 - Perform a binary search that relies on lookup_array being sorted
    ///      in ascending order. If not sorted, invalid results will be returned.
    ///   * -2 - Perform a binary search that relies on lookup_array being sorted
    ///     in descending order. If not sorted, invalid results will be returned.
    pub(crate) fn fn_xlookup(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 3 || args.len() > 6 {
            return CalcResult::new_args_number_error(cell);
        }
        let lookup_value = self.evaluate_node_in_context(&args[0], cell);
        if lookup_value.is_error() {
            return lookup_value;
        }
        // Get optional arguments
        let if_not_found = if args.len() >= 4 {
            let v = self.evaluate_node_in_context(&args[3], cell);
            match v {
                CalcResult::EmptyArg => CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "Not found".to_string(),
                },
                _ => v,
            }
        } else {
            // default
            CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Not found".to_string(),
            }
        };
        let match_mode = if args.len() >= 5 {
            match self.get_number(&args[4], cell) {
                Ok(c) => match c.floor() as i32 {
                    -1 => MatchMode::ExactMatchSmaller,
                    1 => MatchMode::ExactMatchLarger,
                    0 => MatchMode::ExactMatch,
                    2 => MatchMode::WildcardMatch,
                    _ => {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Unexpected number".to_string(),
                        };
                    }
                },
                Err(s) => return s,
            }
        } else {
            // default
            MatchMode::ExactMatch
        };
        let search_mode = if args.len() == 6 {
            match self.get_number(&args[5], cell) {
                Ok(c) => match c.floor() as i32 {
                    1 => SearchMode::StartAtFirstItem,
                    -1 => SearchMode::StartAtLastItem,
                    -2 => SearchMode::BinarySearchDescending,
                    2 => SearchMode::BinarySearchAscending,
                    _ => {
                        return CalcResult::Error {
                            error: Error::ERROR,
                            origin: cell,
                            message: "Unexpected number".to_string(),
                        };
                    }
                },
                Err(s) => return s,
            }
        } else {
            // default
            SearchMode::StartAtFirstItem
        };
        // MACRO: lookup_array and return_array may be computed arrays, such
        // as `(A1:A9="x")*(B1:B9="y")`, and return_array may have several
        // columns (or rows): the whole row (or column) found is returned.
        let lookup = match self.xlookup_table(&args[1], cell) {
            Ok(table) => table,
            Err(error) => return error,
        };
        let returns = match self.xlookup_table(&args[2], cell) {
            Ok(table) => table,
            Err(error) => return error,
        };
        // Whether the arrays are searched by rows.
        let vertical = match (lookup.rows(), lookup.columns()) {
            (1, 1) => returns.rows() == 1,
            (_, 1) => true,
            (1, _) => false,
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Second argument must be a vector".to_string(),
                )
            }
        };
        let (length, return_length) = if vertical {
            (lookup.rows(), returns.rows())
        } else {
            (lookup.columns(), returns.columns())
        };
        if length != return_length {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "Arrays must be of the same size".to_string(),
            );
        }
        let values = match self.xlookup_values(&lookup, vertical, cell) {
            Ok(values) => values,
            Err(error) => return error,
        };
        let index = match search_mode {
            SearchMode::StartAtFirstItem | SearchMode::StartAtLastItem => {
                linear_search(&lookup_value, &values, search_mode, match_mode)
            }
            SearchMode::BinarySearchAscending | SearchMode::BinarySearchDescending => {
                let ascending = search_mode == SearchMode::BinarySearchAscending;
                let index = match match_mode {
                    MatchMode::ExactMatchLarger if ascending => {
                        binary_search_or_greater(&lookup_value, &values)
                    }
                    MatchMode::ExactMatchLarger => {
                        binary_search_descending_or_greater(&lookup_value, &values)
                    }
                    _ if ascending => binary_search_or_smaller(&lookup_value, &values),
                    _ => binary_search_descending_or_smaller(&lookup_value, &values),
                };
                match (index, match_mode) {
                    (None, _) => None,
                    (Some(_), MatchMode::WildcardMatch) => {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Cannot use wildcard in binary search".to_string(),
                        }
                    }
                    (Some(index), MatchMode::ExactMatch) => {
                        let index = index as usize;
                        (compare_values(&values[index], &lookup_value) == 0).then_some(index)
                    }
                    (Some(index), _) => Some(index as usize),
                }
            }
        };
        match index {
            Some(index) => self.xlookup_result(&returns, index, vertical, cell),
            None => if_not_found,
        }
    }

    /// MACRO: a lookup or return array of XLOOKUP. A single value is an array
    /// of one.
    fn xlookup_table(&mut self, arg: &Node, cell: CellReferenceIndex) -> Result<Table, CalcResult> {
        let value = match self.evaluate_node_with_reference(arg, cell) {
            CalcResult::Range { left, right } => return Ok(Table::Range { left, right }),
            CalcResult::Array(array) if array.first().is_some_and(|row| !row.is_empty()) => {
                return Ok(Table::Array(array))
            }
            error @ CalcResult::Error { .. } => return Err(error),
            CalcResult::Number(number) => ArrayNode::Number(number),
            CalcResult::String(text) => ArrayNode::String(text),
            CalcResult::Boolean(boolean) => ArrayNode::Boolean(boolean),
            _ => {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Range expected".to_string(),
                ))
            }
        };
        Ok(Table::Array(vec![vec![value]]))
    }

    /// MACRO: the values searched: the first column (or row) of `table`, up
    /// to the last used cell of a range.
    fn xlookup_values(
        &mut self,
        table: &Table,
        vertical: bool,
        cell: CellReferenceIndex,
    ) -> Result<Vec<CalcResult>, CalcResult> {
        match table {
            Table::Range { left, right } => {
                let (row, column) = self
                    .clip_to_used_area(left.sheet, left.row, left.column, right.row, right.column)
                    .map_err(|message| CalcResult::new_error(Error::ERROR, cell, message))?;
                let right = CellReferenceIndex {
                    sheet: left.sheet,
                    row,
                    column,
                };
                Ok(self.prepare_array(left, &right, vertical))
            }
            Table::Array(array) => Ok(if vertical {
                array
                    .iter()
                    .map(|row| array_node_to_calc_result(&row[0], cell))
                    .collect()
            } else {
                array[0]
                    .iter()
                    .map(|node| array_node_to_calc_result(node, cell))
                    .collect()
            }),
        }
    }

    /// MACRO: item `index` of the return array: a value, or a whole row (or
    /// column) of a two-dimensional array.
    fn xlookup_result(
        &mut self,
        table: &Table,
        index: usize,
        vertical: bool,
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let offset = index as i32;
        match table {
            Table::Range { left, right } => {
                let (left, right) = if vertical {
                    (
                        CellReferenceIndex {
                            row: left.row + offset,
                            ..*left
                        },
                        CellReferenceIndex {
                            row: left.row + offset,
                            ..*right
                        },
                    )
                } else {
                    (
                        CellReferenceIndex {
                            column: left.column + offset,
                            ..*left
                        },
                        CellReferenceIndex {
                            column: left.column + offset,
                            ..*right
                        },
                    )
                };
                if left == right {
                    self.evaluate_cell(left)
                } else {
                    CalcResult::Range { left, right }
                }
            }
            Table::Array(array) => {
                let found: Vec<Vec<ArrayNode>> = if vertical {
                    vec![array[index].clone()]
                } else {
                    array.iter().map(|row| vec![row[index].clone()]).collect()
                };
                match found.as_slice() {
                    [row] if row.len() == 1 => array_node_to_calc_result(&row[0], cell),
                    _ => CalcResult::Array(found),
                }
            }
        }
    }
}
