use crate::number_format::parse_finite_number;
use crate::{
    calc_result::CalcResult,
    cast::{array_node_to_string, NumberOrArray, StringOrArray, ValueOrArray},
    expressions::{
        parser::{ArrayNode, Node},
        token::{Error, OpCompare},
        types::CellReferenceIndex,
    },
    functions::util::compare_values,
    model::Model,
};

/// Maps an output index `i` back to the source array index, applying Excel's
/// size-1 broadcasting rule: a length-1 dimension repeats its only element, an
/// equal-length dimension maps one-to-one, and any other mismatch is out of range.
pub(crate) fn bcast_idx(len: usize, i: usize) -> Option<usize> {
    if len == 1 {
        Some(0)
    } else if i < len {
        Some(i)
    } else {
        None
    }
}

/// What an array has beyond its end, when it is combined with a larger one:
/// `#N/A`, as in Excel. It is an error like any other, so if the element on
/// the other side is an error too, the one on the left comes first.
static MISSING: ArrayNode = ArrayNode::Error(Error::NA);

/// Unify how we map booleans/strings to f64
fn to_f64(value: &ArrayNode) -> Result<f64, Error> {
    match value {
        ArrayNode::Number(f) => Ok(*f),
        ArrayNode::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
        ArrayNode::String(s) => parse_finite_number(s).ok_or(Error::VALUE),
        ArrayNode::Error(err) => Err(err.clone()),
        ArrayNode::Empty => Ok(0.0),
    }
}

/// `x` to the power of `y`, as POWER and the operator `^` compute it.
pub(crate) fn power(x: f64, y: f64) -> Result<f64, Error> {
    if x == 0.0 && y == 0.0 {
        return Err(Error::NUM);
    }
    if y == 0.0 {
        return Ok(1.0);
    }
    let result = if x < 0.0 && is_one_over_an_odd_integer(y) {
        // An odd root of a negative number is a real number: the cube root of
        // -8 is -2. `powf` cannot tell, a third is just another fraction to it.
        -(-x).powf(y)
    } else {
        x.powf(y)
    };
    if result.is_infinite() {
        return Err(Error::DIV);
    }
    if result.is_nan() {
        // A negative number to a power that is not an integer nor an odd root
        return Err(Error::NUM);
    }
    Ok(result)
}

/// Whether `y` is 1/3, 1/5, -1/7 and so on. A float cannot hold a third, so
/// this asks whether one over `y` is an odd integer as far as the precision of
/// a float can tell.
fn is_one_over_an_odd_integer(y: f64) -> bool {
    // 2^-48: the last few bits are left to the error of the two divisions
    const TOLERANCE: f64 = 1.0 / (16_777_216.0 * 16_777_216.0);
    let inverse = 1.0 / y;
    let integer = inverse.round();
    (inverse - integer).abs() <= integer.abs() * TOLERANCE && integer % 2.0 != 0.0
}

/// What an operator, or a function that works element by element, gives when
/// one operand is an array and the other one an error: an array of the same size with an error in every element. The error
/// of the left operand comes first, so if the array is on the left
/// `element_error` says which of its elements are errors of their own.
pub(crate) fn array_of_errors(
    array: &[Vec<ArrayNode>],
    error: CalcResult,
    element_error: impl Fn(&ArrayNode) -> Option<Error>,
) -> CalcResult {
    let CalcResult::Error { error: kind, .. } = &error else {
        return error;
    };
    CalcResult::Array(
        array
            .iter()
            .map(|row| {
                row.iter()
                    .map(|node| ArrayNode::Error(element_error(node).unwrap_or(kind.clone())))
                    .collect()
            })
            .collect(),
    )
}

impl<'a> Model<'a> {
    /// Applies `op` element‐wise for arrays/numbers.
    pub(crate) fn handle_arithmetic(
        &mut self,
        left: &Node,
        right: &Node,
        cell: CellReferenceIndex,
        op: &dyn Fn(f64, f64) -> Result<f64, Error>,
    ) -> CalcResult {
        let l = self.get_number_or_array(left, cell);
        let r = self.get_number_or_array(right, cell);
        self.arithmetic_on_values(l, r, cell, op)
    }

    /// Applies `op` element‐wise to operands that are already evaluated. An
    /// operand that is an error makes the result an error, or an array of
    /// errors if the other operand is an array.
    pub(crate) fn arithmetic_on_values(
        &mut self,
        l: Result<NumberOrArray, CalcResult>,
        r: Result<NumberOrArray, CalcResult>,
        cell: CellReferenceIndex,
        op: &dyn Fn(f64, f64) -> Result<f64, Error>,
    ) -> CalcResult {
        let (l, r) = match (l, r) {
            (Ok(l), Ok(r)) => (l, r),
            (Err(error), Ok(NumberOrArray::Array(array))) => {
                return array_of_errors(&array, error, |_| None);
            }
            (Ok(NumberOrArray::Array(array)), Err(error)) => {
                return array_of_errors(&array, error, |node| to_f64(node).err());
            }
            (Err(error), _) | (_, Err(error)) => return error,
        };
        match (l, r) {
            // -----------------------------------------------------
            // Case 1: Both are numbers
            // -----------------------------------------------------
            (NumberOrArray::Number(f1), NumberOrArray::Number(f2)) => match op(f1, f2) {
                Ok(x) => CalcResult::Number(x),
                Err(Error::DIV) => CalcResult::Error {
                    error: Error::DIV,
                    origin: cell,
                    message: "Divide by 0".to_string(),
                },
                Err(Error::VALUE) => CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Invalid number".to_string(),
                },
                Err(e) => CalcResult::Error {
                    error: e,
                    origin: cell,
                    message: "Unknown error".to_string(),
                },
            },

            // -----------------------------------------------------
            // Case 2: left is Number, right is Array
            // -----------------------------------------------------
            (NumberOrArray::Number(f1), NumberOrArray::Array(a2)) => {
                let mut array = Vec::new();
                for row in a2 {
                    let mut data_row = Vec::new();
                    for node in row {
                        match to_f64(&node) {
                            Ok(f2) => match op(f1, f2) {
                                Ok(x) => data_row.push(ArrayNode::Number(x)),
                                Err(Error::DIV) => data_row.push(ArrayNode::Error(Error::DIV)),
                                Err(Error::VALUE) => data_row.push(ArrayNode::Error(Error::VALUE)),
                                Err(e) => data_row.push(ArrayNode::Error(e)),
                            },
                            Err(err) => data_row.push(ArrayNode::Error(err)),
                        }
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }

            // -----------------------------------------------------
            // Case 3: left is Array, right is Number
            // -----------------------------------------------------
            (NumberOrArray::Array(a1), NumberOrArray::Number(f2)) => {
                let mut array = Vec::new();
                for row in a1 {
                    let mut data_row = Vec::new();
                    for node in row {
                        match to_f64(&node) {
                            Ok(f1) => match op(f1, f2) {
                                Ok(x) => data_row.push(ArrayNode::Number(x)),
                                Err(Error::DIV) => data_row.push(ArrayNode::Error(Error::DIV)),
                                Err(Error::VALUE) => data_row.push(ArrayNode::Error(Error::VALUE)),
                                Err(e) => data_row.push(ArrayNode::Error(e)),
                            },
                            Err(err) => data_row.push(ArrayNode::Error(err)),
                        }
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }

            // -----------------------------------------------------
            // Case 4: Both are arrays
            // -----------------------------------------------------
            (NumberOrArray::Array(a1), NumberOrArray::Array(a2)) => {
                let n1 = a1.len();
                let m1 = a1.first().map(|r| r.len()).unwrap_or(0);
                let n2 = a2.len();
                let m2 = a2.first().map(|r| r.len()).unwrap_or(0);
                let n = n1.max(n2);
                let m = m1.max(m2);

                let mut array = Vec::new();
                for i in 0..n {
                    let row1 = bcast_idx(n1, i).and_then(|ri| a1.get(ri));
                    let row2 = bcast_idx(n2, i).and_then(|ri| a2.get(ri));

                    let mut data_row = Vec::new();
                    for j in 0..m {
                        let v1 = row1
                            .and_then(|r| bcast_idx(m1, j).and_then(|cj| r.get(cj)))
                            .unwrap_or(&MISSING);
                        let v2 = row2
                            .and_then(|r| bcast_idx(m2, j).and_then(|cj| r.get(cj)))
                            .unwrap_or(&MISSING);

                        match (to_f64(v1), to_f64(v2)) {
                            (Ok(f1), Ok(f2)) => match op(f1, f2) {
                                Ok(x) => data_row.push(ArrayNode::Number(x)),
                                Err(Error::DIV) => data_row.push(ArrayNode::Error(Error::DIV)),
                                Err(Error::VALUE) => data_row.push(ArrayNode::Error(Error::VALUE)),
                                Err(e) => data_row.push(ArrayNode::Error(e)),
                            },
                            (Err(e), _) | (_, Err(e)) => data_row.push(ArrayNode::Error(e)),
                        }
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }
        }
    }

    /// Applies the concatenation operator (`&`) element-wise.
    /// When either operand is a range or array the result is an array of strings;
    /// when both are scalars the result is a single String.
    pub(crate) fn handle_concatenate(
        &mut self,
        left: &Node,
        right: &Node,
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let l = self.get_string_or_array(left, cell);
        let r = self.get_string_or_array(right, cell);
        let (l, r) = match (l, r) {
            (Ok(l), Ok(r)) => (l, r),
            (Err(error), Ok(StringOrArray::Array(array))) => {
                return array_of_errors(&array, error, |_| None);
            }
            (Ok(StringOrArray::Array(array)), Err(error)) => {
                return array_of_errors(&array, error, |node| array_node_to_string(node).err());
            }
            (Err(error), _) | (_, Err(error)) => return error,
        };

        // Concatenates two array elements, propagating errors as error nodes.
        let concat_nodes = |a: &ArrayNode, b: &ArrayNode| -> ArrayNode {
            match (array_node_to_string(a), array_node_to_string(b)) {
                (Ok(sa), Ok(sb)) => ArrayNode::String(format!("{sa}{sb}")),
                (Err(e), _) | (_, Err(e)) => ArrayNode::Error(e),
            }
        };

        match (l, r) {
            (StringOrArray::String(s1), StringOrArray::String(s2)) => {
                CalcResult::String(format!("{s1}{s2}"))
            }
            (StringOrArray::String(s1), StringOrArray::Array(a2)) => CalcResult::Array(
                a2.iter()
                    .map(|row| {
                        row.iter()
                            .map(|n| concat_nodes(&ArrayNode::String(s1.clone()), n))
                            .collect()
                    })
                    .collect(),
            ),
            (StringOrArray::Array(a1), StringOrArray::String(s2)) => CalcResult::Array(
                a1.iter()
                    .map(|row| {
                        row.iter()
                            .map(|n| concat_nodes(n, &ArrayNode::String(s2.clone())))
                            .collect()
                    })
                    .collect(),
            ),
            (StringOrArray::Array(a1), StringOrArray::Array(a2)) => {
                let n1 = a1.len();
                let m1 = a1.first().map(|r| r.len()).unwrap_or(0);
                let n2 = a2.len();
                let m2 = a2.first().map(|r| r.len()).unwrap_or(0);
                let rows = n1.max(n2);
                let cols = m1.max(m2);
                let mut array = Vec::with_capacity(rows);
                for ri in 0..rows {
                    let row1 = bcast_idx(n1, ri).and_then(|i| a1.get(i));
                    let row2 = bcast_idx(n2, ri).and_then(|i| a2.get(i));
                    let mut data_row = Vec::with_capacity(cols);
                    for ci in 0..cols {
                        let v1 = row1
                            .and_then(|r| bcast_idx(m1, ci).and_then(|j| r.get(j)))
                            .unwrap_or(&MISSING);
                        let v2 = row2
                            .and_then(|r| bcast_idx(m2, ci).and_then(|j| r.get(j)))
                            .unwrap_or(&MISSING);
                        data_row.push(concat_nodes(v1, v2));
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }
        }
    }

    /// Applies a comparison operator element-wise.
    /// When either operand is a range or array the result is an array of booleans,
    /// with an error where an element of the operands is an error;
    /// when both are scalars the result is a single Boolean.
    pub(crate) fn handle_comparison(
        &mut self,
        left: &Node,
        right: &Node,
        cell: CellReferenceIndex,
        kind: &OpCompare,
    ) -> CalcResult {
        let l = self.get_value_or_array(left, cell);
        let r = self.get_value_or_array(right, cell);
        let (l, r) = match (l, r) {
            (Ok(l), Ok(r)) => (l, r),
            (Err(error), Ok(ValueOrArray::Array(array))) => {
                return array_of_errors(&array, error, |_| None);
            }
            (Ok(ValueOrArray::Array(array)), Err(error)) => {
                return array_of_errors(&array, error, |node| match node {
                    ArrayNode::Error(error) => Some(error.clone()),
                    _ => None,
                });
            }
            (Err(error), _) | (_, Err(error)) => return error,
        };

        let apply = |lv: &CalcResult, rv: &CalcResult| -> bool {
            let cmp = compare_values(lv, rv);
            match kind {
                OpCompare::Equal => cmp == 0,
                OpCompare::LessThan => cmp == -1,
                OpCompare::GreaterThan => cmp == 1,
                OpCompare::LessOrEqualThan => cmp < 1,
                OpCompare::GreaterOrEqualThan => cmp > -1,
                OpCompare::NonEqual => cmp != 0,
            }
        };

        // Compares two elements. One that is an error is the result, the left
        // one first.
        let apply_to_elements = |lv: &CalcResult, rv: &CalcResult| -> ArrayNode {
            match (lv, rv) {
                (CalcResult::Error { error, .. }, _) | (_, CalcResult::Error { error, .. }) => {
                    ArrayNode::Error(error.clone())
                }
                _ => ArrayNode::Boolean(apply(lv, rv)),
            }
        };

        let node_to_calc = |node: &ArrayNode| -> CalcResult {
            match node {
                ArrayNode::Number(n) => CalcResult::Number(*n),
                ArrayNode::Boolean(b) => CalcResult::Boolean(*b),
                ArrayNode::String(s) => CalcResult::String(s.clone()),
                ArrayNode::Error(e) => CalcResult::Error {
                    error: e.clone(),
                    origin: cell,
                    message: String::new(),
                },
                ArrayNode::Empty => CalcResult::EmptyCell,
            }
        };

        match (l, r) {
            (ValueOrArray::Value(lv), ValueOrArray::Value(rv)) => {
                CalcResult::Boolean(apply(&lv, &rv))
            }
            (ValueOrArray::Array(la), ValueOrArray::Value(rv)) => CalcResult::Array(
                la.iter()
                    .map(|row| {
                        row.iter()
                            .map(|n| apply_to_elements(&node_to_calc(n), &rv))
                            .collect()
                    })
                    .collect(),
            ),
            (ValueOrArray::Value(lv), ValueOrArray::Array(ra)) => CalcResult::Array(
                ra.iter()
                    .map(|row| {
                        row.iter()
                            .map(|n| apply_to_elements(&lv, &node_to_calc(n)))
                            .collect()
                    })
                    .collect(),
            ),
            (ValueOrArray::Array(la), ValueOrArray::Array(ra)) => {
                let n1 = la.len();
                let m1 = la.first().map(|r| r.len()).unwrap_or(0);
                let n2 = ra.len();
                let m2 = ra.first().map(|r| r.len()).unwrap_or(0);
                let rows = n1.max(n2);
                let cols = m1.max(m2);
                let mut array = Vec::with_capacity(rows);
                for ri in 0..rows {
                    let lrow = bcast_idx(n1, ri).and_then(|i| la.get(i));
                    let rrow = bcast_idx(n2, ri).and_then(|i| ra.get(i));
                    let mut data_row = Vec::with_capacity(cols);
                    for ci in 0..cols {
                        let lv = node_to_calc(
                            lrow.and_then(|r| bcast_idx(m1, ci).and_then(|j| r.get(j)))
                                .unwrap_or(&MISSING),
                        );
                        let rv = node_to_calc(
                            rrow.and_then(|r| bcast_idx(m2, ci).and_then(|j| r.get(j)))
                                .unwrap_or(&MISSING),
                        );
                        data_row.push(apply_to_elements(&lv, &rv));
                    }
                    array.push(data_row);
                }
                CalcResult::Array(array)
            }
        }
    }
}
