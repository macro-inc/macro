use crate::functions::date_and_time::parse_time_of_day;
use crate::number_format::parse_finite_number;
use crate::{
    calc_result::{CalcResult, Range},
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    formatter::format::parse_formatted_number,
    model::Model,
};

pub(crate) enum NumberOrArray {
    Number(f64),
    Array(Vec<Vec<ArrayNode>>),
}

/// A scalar CalcResult or a 2-D array, used for element-wise comparison.
pub(crate) enum ValueOrArray {
    Value(CalcResult),
    Array(Vec<Vec<ArrayNode>>),
}

/// A scalar string or a 2-D array, used for element-wise text operations.
pub(crate) enum StringOrArray {
    String(String),
    Array(Vec<Vec<ArrayNode>>),
}

/// Collapses a scalar [`CalcResult`] into a single array element.
/// Ranges, arrays and lambdas cannot be a single element, so they become `#VALUE!`.
pub(crate) fn calc_result_to_array_node(result: CalcResult) -> ArrayNode {
    match result {
        CalcResult::Number(n) => ArrayNode::Number(n),
        CalcResult::Boolean(b) => ArrayNode::Boolean(b),
        CalcResult::String(s) => ArrayNode::String(s),
        CalcResult::Error { error, .. } => ArrayNode::Error(error),
        CalcResult::EmptyCell | CalcResult::EmptyArg => ArrayNode::Empty,
        _ => ArrayNode::Error(Error::VALUE),
    }
}

/// Converts a single array element to a string using the same rules as
/// [`Model::cast_to_string`]. Errors propagate.
pub(crate) fn array_node_to_string(node: &ArrayNode) -> Result<String, Error> {
    match node {
        ArrayNode::Number(f) => Ok(format!("{f}")),
        ArrayNode::String(s) => Ok(s.clone()),
        ArrayNode::Boolean(b) => Ok(if *b {
            "TRUE".to_string()
        } else {
            "FALSE".to_string()
        }),
        ArrayNode::Empty => Ok("".to_string()),
        ArrayNode::Error(e) => Err(e.clone()),
    }
}

impl<'a> Model<'a> {
    pub(crate) fn cast_number(&self, s: &str) -> Option<f64> {
        match parse_finite_number(s.trim()) {
            Some(f) => Some(f),
            None => {
                let currency = &self.locale.currency.symbol;
                let mut currencies = vec!["$", "€"];
                if !currencies.iter().any(|e| *e == currency) {
                    currencies.push(currency);
                }
                // Try to parse as a formatted number (e.g., dates, currencies, percentages)
                if let Ok((v, _number_format)) = parse_formatted_number(s, &currencies, self.locale)
                {
                    return Some(v);
                }
                // Or as a time of the day ("12:00", "3:30 PM")
                parse_time_of_day(s)
            }
        }
    }
    pub(crate) fn get_number_or_array(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<NumberOrArray, CalcResult> {
        match self.evaluate_node_in_context(node, cell) {
            CalcResult::Number(f) => Ok(NumberOrArray::Number(f)),
            CalcResult::String(s) => match self.cast_number(&s) {
                Some(f) => Ok(NumberOrArray::Number(f)),
                None => Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Expecting number".to_string(),
                )),
            },
            CalcResult::Boolean(f) => {
                if f {
                    Ok(NumberOrArray::Number(1.0))
                } else {
                    Ok(NumberOrArray::Number(0.0))
                }
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(NumberOrArray::Number(0.0)),
            CalcResult::Range { left, right } => {
                let sheet = left.sheet;
                if sheet != right.sheet {
                    return Err(CalcResult::Error {
                        error: Error::ERROR,
                        origin: cell,
                        message: "3D ranges are not allowed".to_string(),
                    });
                }
                // we need to convert the range into an array
                let mut array = Vec::new();
                for row in left.row..=right.row {
                    let mut row_data = Vec::new();
                    for column in left.column..=right.column {
                        let value =
                            match self.evaluate_cell(CellReferenceIndex { sheet, column, row }) {
                                CalcResult::String(s) => ArrayNode::String(s),
                                CalcResult::Number(f) => ArrayNode::Number(f),
                                CalcResult::Boolean(b) => ArrayNode::Boolean(b),
                                CalcResult::Error { error, .. } => ArrayNode::Error(error),
                                CalcResult::Range { .. } => {
                                    // if we do things right this can never happen.
                                    // the evaluation of a cell should never return a range
                                    ArrayNode::Number(0.0)
                                }
                                CalcResult::EmptyCell => ArrayNode::Empty,
                                CalcResult::EmptyArg => ArrayNode::Empty,
                                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                                    // if we do things right this can never happen.
                                    // the evaluation of a cell should never return an array or lambda
                                    ArrayNode::Number(0.0)
                                }
                            };
                        row_data.push(value);
                    }
                    array.push(row_data);
                }
                Ok(NumberOrArray::Array(array))
            }
            CalcResult::Array(s) => Ok(NumberOrArray::Array(s)),
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Lambda(_) => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "LAMBDA cannot be used as a number".to_string(),
            )),
        }
    }

    /// Like `get_number_or_array` but preserves the full CalcResult type (no coercion to f64).
    /// Used for element-wise comparison operators.
    pub(crate) fn get_value_or_array(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<ValueOrArray, CalcResult> {
        match self.evaluate_node_in_context(node, cell) {
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Range { left, right } => {
                Ok(ValueOrArray::Array(self.evaluate_range(left, right)))
            }
            CalcResult::Array(arr) => Ok(ValueOrArray::Array(arr)),
            other => Ok(ValueOrArray::Value(other)),
        }
    }

    /// Like `get_number_or_array` but for text: scalars are coerced to a `String`,
    /// ranges and arrays are returned as a 2-D array (to be processed element-wise).
    pub(crate) fn get_string_or_array(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<StringOrArray, CalcResult> {
        match self.evaluate_node_in_context(node, cell) {
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Range { left, right } => {
                Ok(StringOrArray::Array(self.evaluate_range(left, right)))
            }
            CalcResult::Array(arr) => Ok(StringOrArray::Array(arr)),
            other => Ok(StringOrArray::String(self.cast_to_string(other, cell)?)),
        }
    }

    /// Applies a scalar numeric transform element-wise over a node that may evaluate
    /// to a number, a range, or an array. Mirrors the `single_number_fn!` /
    /// `date_part_fn!` macros but accepts a closure, so callers can capture extra
    /// scalar arguments (e.g. WEEKDAY's `return_type`) or use non-arithmetic
    /// transforms (e.g. date helpers).
    ///
    /// Element coercion matches the rest of the array machinery: booleans → 0/1,
    /// empty → 0, strings are parsed with `cast_number` (`#VALUE!` if they don't
    /// parse), and errors propagate.
    pub(crate) fn apply_number_unary(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
        op: impl Fn(f64) -> Result<f64, Error>,
    ) -> CalcResult {
        match self.get_number_or_array(node, cell) {
            Ok(NumberOrArray::Number(f)) => match op(f) {
                Ok(x) => CalcResult::Number(x),
                Err(e) => CalcResult::new_error(e, cell, String::new()),
            },
            Ok(NumberOrArray::Array(a)) => {
                let mut array = Vec::with_capacity(a.len());
                for row in a {
                    let mut data_row = Vec::with_capacity(row.len());
                    for value in row {
                        let n = match value {
                            ArrayNode::Number(n) => Some(n),
                            ArrayNode::Boolean(b) => Some(if b { 1.0 } else { 0.0 }),
                            ArrayNode::Empty => Some(0.0),
                            ArrayNode::String(s) => self.cast_number(&s),
                            ArrayNode::Error(e) => {
                                data_row.push(ArrayNode::Error(e));
                                continue;
                            }
                        };
                        let out = match n {
                            Some(f) => match op(f) {
                                Ok(x) => ArrayNode::Number(x),
                                Err(e) => ArrayNode::Error(e),
                            },
                            None => ArrayNode::Error(Error::VALUE),
                        };
                        data_row.push(out);
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }
            Err(e) => e,
        }
    }

    pub(crate) fn get_number(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<f64, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        self.cast_to_number(result, cell)
    }

    /// A reference where a value is expected (typically returned by INDIRECT,
    /// OFFSET or INDEX inside a scalar argument) is dereferenced: a single cell
    /// gives its value, a larger range is intersected with the row or column of
    /// `cell`, as Excel does in a scalar context. Literal ranges never get here:
    /// static analysis wraps them in `@` at parse time.
    ///
    /// A 1x1 array (the result of arithmetic on such a reference, for instance
    /// `INDIRECT("C3")*1`) is a scalar wrapped in an array and unwraps likewise.
    fn dereference(&mut self, result: CalcResult, cell: CellReferenceIndex) -> CalcResult {
        match result {
            CalcResult::Range { .. } => self.implicit_intersection_to_value(result, cell),
            CalcResult::Array(ref array) if array.len() == 1 && array[0].len() == 1 => {
                match &array[0][0] {
                    ArrayNode::Number(n) => CalcResult::Number(*n),
                    ArrayNode::Boolean(b) => CalcResult::Boolean(*b),
                    ArrayNode::String(s) => CalcResult::String(s.clone()),
                    ArrayNode::Error(error) => CalcResult::new_error(
                        error.clone(),
                        cell,
                        error.to_localized_error_string(self.language),
                    ),
                    ArrayNode::Empty => CalcResult::EmptyCell,
                }
            }
            other => other,
        }
    }

    pub(crate) fn cast_to_number(
        &mut self,
        result: CalcResult,
        cell: CellReferenceIndex,
    ) -> Result<f64, CalcResult> {
        let result = self.dereference(result, cell);
        match result {
            CalcResult::Number(f) => Ok(f),
            CalcResult::String(s) => match self.cast_number(&s) {
                Some(f) => Ok(f),
                None => Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Expecting number".to_string(),
                )),
            },
            CalcResult::Boolean(f) => {
                if f {
                    Ok(1.0)
                } else {
                    Ok(0.0)
                }
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(0.0),
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Range { .. } => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
            CalcResult::Array(_) | CalcResult::Lambda(_) => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
        }
    }

    pub(crate) fn get_number_no_bools(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<f64, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        let result = self.dereference(result, cell);
        if matches!(result, CalcResult::Boolean(_)) {
            return Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expecting number".to_string(),
            ));
        }
        self.cast_to_number(result, cell)
    }

    pub(crate) fn get_string(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<String, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        self.cast_to_string(result, cell)
    }

    pub(crate) fn cast_to_string(
        &mut self,
        result: CalcResult,
        cell: CellReferenceIndex,
    ) -> Result<String, CalcResult> {
        // FIXME: I think when casting a number we should convert it to_precision(x, 15)
        // See function Exact
        let result = self.dereference(result, cell);
        match result {
            CalcResult::Number(f) => Ok(format!("{f}")),
            CalcResult::String(s) => Ok(s),
            CalcResult::Boolean(f) => {
                if f {
                    Ok("TRUE".to_string())
                } else {
                    Ok("FALSE".to_string())
                }
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok("".to_string()),
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Range { .. } => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
            CalcResult::Array(_) | CalcResult::Lambda(_) => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
        }
    }

    pub(crate) fn get_boolean(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<bool, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        self.cast_to_bool(result, cell)
    }

    pub(crate) fn cast_to_bool(
        &mut self,
        result: CalcResult,
        cell: CellReferenceIndex,
    ) -> Result<bool, CalcResult> {
        let result = self.dereference(result, cell);
        match result {
            CalcResult::Number(f) => {
                if f == 0.0 {
                    return Ok(false);
                }
                Ok(true)
            }
            CalcResult::String(s) => {
                if s.to_lowercase() == *"true" {
                    return Ok(true);
                } else if s.to_lowercase() == *"false" {
                    return Ok(false);
                }
                Err(CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Expected boolean".to_string(),
                })
            }
            CalcResult::Boolean(b) => Ok(b),
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(false),
            error @ CalcResult::Error { .. } => Err(error),
            CalcResult::Range { .. } => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
            CalcResult::Array(_) | CalcResult::Lambda(_) => Err(CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            }),
        }
    }

    // tries to return a reference. That is either a reference or a formula that evaluates to a range/reference
    pub(crate) fn get_reference(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Range, CalcResult> {
        // Reference context: references stay references and an `@` node yields
        // the intersected 1x1 reference (e.g. COLUMNS(@A1:C1) is 1).
        let value = self.evaluate_node_with_reference(node, cell);
        if value.is_error() {
            return Err(value);
        }
        if let CalcResult::Range { left, right } = value {
            Ok(Range { left, right })
        } else {
            Err(CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Expected reference".to_string(),
            })
        }
    }
}
