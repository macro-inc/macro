use crate::{
    arithmetic::{array_of_errors, bcast_idx},
    calc_result::CalcResult,
    cast::{array_node_to_string, calc_result_to_array_node},
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    formatter::format::{format_number, parse_formatted_number},
    functions::{
        text::util::{substitute, text_after, text_before, Case},
        util::from_wildcard_to_regex,
    },
    model::Model,
    number_format::to_precision,
};

/// An argument of a text function that works element by element (LEFT, MID,
/// EXACT, FIND, ...): a single scalar value or a 2-D array of values.
/// When any argument is an array (e.g. a SEQUENCE or a multi-cell range) the
/// scalar arguments are broadcast across it and the result is an array.
pub(super) enum TextArg {
    Scalar(ArrayNode),
    Array(Vec<Vec<ArrayNode>>),
    /// An argument that is an error. It is broadcast like any other scalar, so
    /// that next to an array it gives an array of errors. The error is kept
    /// twice: as the element to broadcast and as it was, to be returned whole
    /// when no argument is an array.
    Error(ArrayNode, CalcResult),
}

/// What an array has beyond its end, when it is used next to a longer one.
static MISSING: ArrayNode = ArrayNode::Error(Error::NA);

impl TextArg {
    /// The (rows, columns) shape of this argument.
    pub(super) fn dims(&self) -> (usize, usize) {
        match self {
            TextArg::Scalar(_) | TextArg::Error(..) => (1, 1),
            TextArg::Array(a) => (a.len(), a.first().map(|r| r.len()).unwrap_or(0)),
        }
    }

    /// Returns the element at (`i`, `j`), broadcasting scalars and length-1 dimensions.
    ///
    /// Where the array is too short for that position the element is `#N/A`,
    /// as in Excel. It is an error like any other: if an earlier argument of
    /// the function is an error too, that one comes first.
    pub(super) fn elem(&self, i: usize, j: usize) -> &ArrayNode {
        match self {
            TextArg::Scalar(n) | TextArg::Error(n, _) => n,
            TextArg::Array(a) => bcast_idx(a.len(), i)
                .and_then(|ri| a.get(ri))
                .and_then(|row| bcast_idx(row.len(), j).and_then(|cj| row.get(cj)))
                .unwrap_or(&MISSING),
        }
    }
}

/// Coerces a single array element to a number for the start/length arguments of
/// LEFT/RIGHT/MID. Booleans and strings are rejected with `#VALUE!`, matching the
/// scalar behaviour of these functions; empties are treated as 0 and errors
/// propagate.
fn text_num_arg(node: &ArrayNode) -> Result<f64, Error> {
    match node {
        ArrayNode::Number(v) => Ok(*v),
        ArrayNode::Empty => Ok(0.0),
        ArrayNode::Error(e) => Err(e.clone()),
        ArrayNode::Boolean(_) | ArrayNode::String(_) => Err(Error::VALUE),
    }
}

/// Computes a single LEFT result from one element of each argument.
fn left_element(text: &ArrayNode, num: &ArrayNode) -> Result<ArrayNode, Error> {
    let s = array_node_to_string(text)?;
    let num = text_num_arg(num)?;
    if num < 0.0 {
        return Err(Error::VALUE);
    }
    let num_chars = num.floor() as usize;
    Ok(ArrayNode::String(s.chars().take(num_chars).collect()))
}

/// Computes a single RIGHT result from one element of each argument.
fn right_element(text: &ArrayNode, num: &ArrayNode) -> Result<ArrayNode, Error> {
    let s = array_node_to_string(text)?;
    let num = text_num_arg(num)?;
    if num < 0.0 {
        return Err(Error::VALUE);
    }
    let num_chars = num.floor() as usize;
    let skip = s.chars().count().saturating_sub(num_chars);
    Ok(ArrayNode::String(s.chars().skip(skip).collect()))
}

/// Computes a single MID result from one element of each argument.
fn mid_element(
    text: &ArrayNode,
    start: &ArrayNode,
    length: &ArrayNode,
) -> Result<ArrayNode, Error> {
    let s = array_node_to_string(text)?;
    let start = text_num_arg(start)?;
    let length = text_num_arg(length)?;
    if start < 1.0 {
        return Err(Error::VALUE);
    }
    if length < 0.0 {
        return Err(Error::VALUE);
    }
    let start_num = start.floor() as usize;
    let num_chars = length.floor() as usize;
    let mut result = String::new();
    let mut count: usize = 0;
    for (index, ch) in s.chars().enumerate() {
        if count >= num_chars {
            break;
        }
        if index + 1 >= start_num {
            result.push(ch);
            count += 1;
        }
    }
    Ok(ArrayNode::String(result))
}

/// Computes a single LEN result.
fn len_element(text: &ArrayNode) -> Result<ArrayNode, Error> {
    let s = array_node_to_string(text)?;
    Ok(ArrayNode::Number(s.chars().count() as f64))
}

/// Computes a single FIND or SEARCH result from one element of each argument.
/// SEARCH is the one that is not case sensitive and understands wildcards.
fn find_element(
    find_text: &ArrayNode,
    within_text: &ArrayNode,
    start_num: Result<f64, Error>,
    is_search: bool,
) -> Result<ArrayNode, Error> {
    let find_text = array_node_to_string(find_text)?;
    let within_text = array_node_to_string(within_text)?;
    let start_num = start_num?.floor();
    if start_num < 1.0 {
        return Err(Error::VALUE);
    }
    let start_num = start_num as usize;
    if start_num > within_text.len() {
        return Err(Error::VALUE);
    }
    let position = if is_search {
        // SEARCH is case insensitive
        search(
            &find_text.to_lowercase(),
            &within_text.to_lowercase(),
            start_num,
        )
    } else {
        find(&find_text, &within_text, start_num)
    };
    match position {
        Some(p) => Ok(ArrayNode::Number(p as f64)),
        // Text not found
        None => Err(Error::VALUE),
    }
}

/// Computes a single REPT result from one element of each argument.
fn rept_element(text: &ArrayNode, number_times: Result<f64, Error>) -> Result<ArrayNode, Error> {
    let text = array_node_to_string(text)?;
    let number_times = number_times?.floor();
    // We normally don't follow Excel's sometimes archaic size's restrictions
    // But this might be a security issue
    if number_times < 0.0 || text.len() as f64 * number_times > 32767.0 {
        return Err(Error::VALUE);
    }
    Ok(ArrayNode::String(text.repeat(number_times as usize)))
}

/// Computes a single SUBSTITUTE result from one element of each argument.
/// Without an `instance_num` every instance is replaced.
fn substitute_element(
    text: &ArrayNode,
    old_text: &ArrayNode,
    new_text: &ArrayNode,
    instance_num: Option<Result<f64, Error>>,
) -> Result<ArrayNode, Error> {
    let text = array_node_to_string(text)?;
    let old_text = array_node_to_string(old_text)?;
    let new_text = array_node_to_string(new_text)?;
    let instance_num = match instance_num {
        Some(n) => {
            let n = n?.floor();
            if n < 1.0 {
                return Err(Error::VALUE);
            }
            Some(n.min(i32::MAX as f64) as i32)
        }
        None => None,
    };
    if old_text.is_empty() {
        return Ok(ArrayNode::String(text));
    }
    Ok(ArrayNode::String(match instance_num {
        Some(n) => substitute(&text, &old_text, &new_text, n),
        None => text.replace(&old_text, &new_text),
    }))
}

/// Computes a single EXACT result from one element of each argument.
fn exact_element(text1: &ArrayNode, text2: &ArrayNode) -> Result<ArrayNode, Error> {
    if let (ArrayNode::Number(number1), ArrayNode::Number(number2)) = (text1, text2) {
        // In Excel two numbers are the same if they are the same up to 15 digits.
        return Ok(ArrayNode::Boolean(
            to_precision(*number1, 15) == to_precision(*number2, 15),
        ));
    }
    let string1 = array_node_to_string(text1)?;
    let string2 = array_node_to_string(text2)?;
    Ok(ArrayNode::Boolean(string1 == string2))
}

/// Broadcasts `compute` over the (possibly array) `operands`. When every operand
/// is a scalar the result is a single value; otherwise it is an array whose shape
/// is the element-wise maximum of the operand shapes.
pub(super) fn broadcast_text(
    cell: CellReferenceIndex,
    operands: &[&TextArg],
    compute: impl Fn(usize, usize) -> Result<ArrayNode, Error>,
) -> CalcResult {
    let mut rows = 1;
    let mut cols = 1;
    for operand in operands {
        let (r, c) = operand.dims();
        rows = rows.max(r);
        cols = cols.max(c);
    }

    // All scalars: return a single value.
    if rows <= 1 && cols <= 1 {
        // An argument that is an error is the result, as it came.
        for operand in operands {
            if let TextArg::Error(_, error) = operand {
                return error.clone();
            }
        }
        return match compute(0, 0) {
            Ok(ArrayNode::String(s)) => CalcResult::String(s),
            Ok(ArrayNode::Number(n)) => CalcResult::Number(n),
            Ok(ArrayNode::Boolean(b)) => CalcResult::Boolean(b),
            Ok(ArrayNode::Empty) => CalcResult::String(String::new()),
            Ok(ArrayNode::Error(e)) | Err(e) => CalcResult::new_error(e, cell, String::new()),
        };
    }

    let mut result = Vec::with_capacity(rows);
    for i in 0..rows {
        let mut data_row = Vec::with_capacity(cols);
        for j in 0..cols {
            data_row.push(compute(i, j).unwrap_or_else(ArrayNode::Error));
        }
        result.push(data_row);
    }
    CalcResult::Array(result)
}

/// Finds the first instance of 'search_for' in text starting at char index start
fn find(search_for: &str, text: &str, start: usize) -> Option<i32> {
    let ch = text.chars();
    let mut byte_index = 0;
    for (char_index, c) in ch.enumerate() {
        if char_index + 1 >= start && text[byte_index..].starts_with(search_for) {
            return Some((char_index + 1) as i32);
        }
        byte_index += c.len_utf8();
    }
    None
}

/// You can use the wildcard characters — the question mark (?) and asterisk (*) — in the find_text argument.
/// * A question mark matches any single character.
/// * An asterisk matches any sequence of characters.
/// * If you want to find an actual question mark or asterisk, type a tilde (~) before the character.
fn search(search_for: &str, text: &str, start: usize) -> Option<i32> {
    let re = match from_wildcard_to_regex(search_for, false) {
        Ok(r) => r,
        Err(_) => return None,
    };

    let ch = text.chars();
    let mut byte_index = 0;
    for (char_index, c) in ch.enumerate() {
        if char_index + 1 >= start {
            {
                let m = re.find(&text[byte_index..])?;
                return Some((text[0..(m.start() + byte_index)].chars().count() as i32) + 1);
            }
        }
        byte_index += c.len_utf8();
    }
    None
}

impl<'a> Model<'a> {
    pub(crate) fn fn_concat(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let mut result = "".to_string();
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::String(value) => result = format!("{result}{value}"),
                CalcResult::Number(value) => result = format!("{result}{value}"),
                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                CalcResult::Boolean(value) => {
                    if value {
                        result = format!("{result}TRUE");
                    } else {
                        result = format!("{result}FALSE");
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..(right.row + 1) {
                        for column in left.column..(right.column + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::String(value) => {
                                    result = format!("{result}{value}");
                                }
                                CalcResult::Number(value) => result = format!("{result}{value}"),
                                CalcResult::Boolean(value) => {
                                    if value {
                                        result = format!("{result}TRUE");
                                    } else {
                                        result = format!("{result}FALSE");
                                    }
                                }
                                error @ CalcResult::Error { .. } => return error,
                                CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                                CalcResult::Range { .. } => {}
                                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                                    return CalcResult::Error {
                                        error: Error::NIMPL,
                                        origin: cell,
                                        message: "Arrays not supported yet".to_string(),
                                    }
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "Arrays not supported yet".to_string(),
                    }
                }
            };
        }
        CalcResult::String(result)
    }
    pub(crate) fn fn_text(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        use crate::expressions::parser::ArrayNode;
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value_result = self.evaluate_node_in_context(&args[0], cell);
        // Normalise a range to an array so both broadcast (spill) the same way.
        let value_result = match value_result {
            CalcResult::Range { left, right } => {
                CalcResult::Array(self.evaluate_range(left, right))
            }
            other => other,
        };
        match value_result {
            CalcResult::Array(arr) => {
                let format_code = match self.get_string(&args[1], cell) {
                    Ok(s) => s,
                    // An error in every element; the ones that already are
                    // an error keep theirs.
                    Err(e) => {
                        return array_of_errors(&arr, e, |node| match node {
                            ArrayNode::Error(error) => Some(error.clone()),
                            _ => None,
                        })
                    }
                };
                let locale = self.locale;
                let mut output = Vec::with_capacity(arr.len());
                for row in arr {
                    let mut data_row = Vec::with_capacity(row.len());
                    for node in row {
                        let out = match node {
                            ArrayNode::Number(f) => {
                                let d = format_number(f, &format_code, locale);
                                if d.error.is_some() {
                                    ArrayNode::Error(Error::VALUE)
                                } else {
                                    ArrayNode::String(d.text)
                                }
                            }
                            ArrayNode::Empty => {
                                let d = format_number(0.0, &format_code, locale);
                                if d.error.is_some() {
                                    ArrayNode::Error(Error::VALUE)
                                } else {
                                    ArrayNode::String(d.text)
                                }
                            }
                            ArrayNode::Boolean(b) => ArrayNode::Boolean(b),
                            ArrayNode::String(s) => ArrayNode::String(s),
                            e @ ArrayNode::Error(_) => e,
                        };
                        data_row.push(out);
                    }
                    output.push(data_row);
                }
                CalcResult::Array(output)
            }
            error @ CalcResult::Error { .. } => error,
            other => {
                // The format comes before the value is looked at: an error in
                // it is the result, whatever the value, as for an array
                let format_code = match self.get_string(&args[1], cell) {
                    Ok(s) => s,
                    Err(s) => return s,
                };
                let value = match other {
                    CalcResult::Number(f) => f,
                    CalcResult::String(s) => return CalcResult::String(s),
                    CalcResult::Boolean(b) => return CalcResult::Boolean(b),
                    CalcResult::Range { .. } => {
                        return CalcResult::Error {
                            error: Error::NIMPL,
                            origin: cell,
                            message: "Implicit Intersection not implemented".to_string(),
                        };
                    }
                    CalcResult::EmptyCell | CalcResult::EmptyArg => 0.0,
                    CalcResult::Error { .. } | CalcResult::Array(_) | CalcResult::Lambda(_) => {
                        unreachable!()
                    }
                };
                let d = format_number(value, &format_code, self.locale);
                if let Some(_e) = d.error {
                    return CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: "Invalid format code".to_string(),
                    };
                }
                CalcResult::String(d.text)
            }
        }
    }

    /// FIND(find_text, within_text, [start_num])
    ///  * FIND and FINDB are case sensitive and don't allow wildcard characters.
    ///  * If find_text is "" (empty text), FIND matches the first character in the search string (that is, the character numbered start_num or 1).
    ///  * Find_text cannot contain any wildcard characters.
    ///  * If find_text does not appear in within_text, FIND and FINDB return the #VALUE! error value.
    ///  * If start_num is not greater than zero, FIND and FINDB return the #VALUE! error value.
    ///  * If start_num is greater than the length of within_text, FIND and FINDB return the #VALUE! error value.
    ///    NB: FINDB is not implemented. It is the same as FIND function unless locale is a DBCS (Double Byte Character Set)
    ///  * If any of the arguments is an array it works element by element.
    pub(crate) fn fn_find(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.find_or_search(args, cell, false)
    }

    /// Same API as FIND but:
    ///  * Allows wildcards
    ///  * It is case insensitive
    ///    SEARCH(find_text, within_text, [start_num])
    pub(crate) fn fn_search(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.find_or_search(args, cell, true)
    }

    fn find_or_search(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        is_search: bool,
    ) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let find_text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let within_text = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let start_num = if args.len() == 3 {
            match self.text_arg(&args[2], cell) {
                Ok(o) => o,
                Err(e) => return e,
            }
        } else {
            TextArg::Scalar(ArrayNode::Number(1.0))
        };
        broadcast_text(cell, &[&find_text, &within_text, &start_num], |i, j| {
            find_element(
                find_text.elem(i, j),
                within_text.elem(i, j),
                self.text_number(start_num.elem(i, j)),
                is_search,
            )
        })
    }

    /// Coerces a single array element to a number the way a number argument
    /// is: booleans are 0 and 1, text has to read as a number, empties are 0
    /// and errors propagate.
    ///
    /// The number is finite. A calculation that overflowed inside the formula
    /// can hand over an infinity or a NaN: they are not positions or counts,
    /// and every comparison with a NaN is false, so no check of a range would
    /// stop one.
    pub(super) fn text_number(&self, node: &ArrayNode) -> Result<f64, Error> {
        let number = match node {
            ArrayNode::Number(v) => *v,
            ArrayNode::Boolean(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            ArrayNode::Empty => 0.0,
            ArrayNode::String(s) => self.cast_number(s).ok_or(Error::VALUE)?,
            ArrayNode::Error(e) => return Err(e.clone()),
        };
        if !number.is_finite() {
            return Err(Error::VALUE);
        }
        Ok(number)
    }

    // LEN, LEFT, RIGHT, MID, LOWER, UPPER, TRIM
    pub(crate) fn fn_len(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        broadcast_text(cell, &[&text], |i, j| len_element(text.elem(i, j)))
    }

    pub(crate) fn fn_trim(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // Excel TRIM operates on the ASCII space (0x20) only: it removes
        // leading and trailing spaces and collapses each internal run of two
        // or more spaces to a single space. It must NOT touch tab (0x09),
        // non-breaking space (0xA0), or any other Unicode whitespace, so we
        // deliberately split on ' ' rather than using `str::trim`.
        self.apply_text_unary(args, cell, |s| {
            s.split(' ')
                .filter(|w| !w.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
    }

    pub(crate) fn fn_lower(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.apply_text_unary(args, cell, |s| s.to_lowercase())
    }

    /// Applies a single-argument string transform element-wise.
    /// A scalar argument yields a single String; a range or array argument yields
    /// an array (which spills, or is consumed element-wise in array contexts such
    /// as SUMPRODUCT). Used by text functions like UPPER and LOWER.
    pub(crate) fn apply_text_unary(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        f: impl Fn(&str) -> String,
    ) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.get_string_or_array(&args[0], cell) {
            Ok(crate::cast::StringOrArray::String(s)) => CalcResult::String(f(&s)),
            Ok(crate::cast::StringOrArray::Array(arr)) => CalcResult::Array(
                arr.iter()
                    .map(|row| {
                        row.iter()
                            .map(|n| match crate::cast::array_node_to_string(n) {
                                Ok(s) => crate::expressions::parser::ArrayNode::String(f(&s)),
                                Err(e) => crate::expressions::parser::ArrayNode::Error(e),
                            })
                            .collect()
                    })
                    .collect(),
            ),
            Err(e) => e,
        }
    }

    pub(crate) fn fn_unicode(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            let s = match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Number(v) => format!("{v}"),
                CalcResult::String(v) => v,
                CalcResult::Boolean(b) => {
                    if b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                CalcResult::Range { .. } => {
                    // Implicit Intersection not implemented
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "Implicit Intersection not implemented".to_string(),
                    };
                }
                CalcResult::EmptyCell | CalcResult::EmptyArg => {
                    return CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: "Empty cell".to_string(),
                    }
                }
                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "Arrays not supported yet".to_string(),
                    }
                }
            };

            match s.chars().next() {
                Some(c) => {
                    let unicode_number = c as u32;
                    return CalcResult::Number(unicode_number as f64);
                }
                None => {
                    return CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: "Empty cell".to_string(),
                    };
                }
            }
        }
        CalcResult::new_args_number_error(cell)
    }

    pub(crate) fn fn_upper(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.apply_text_unary(args, cell, |s| s.to_uppercase())
    }

    /// Evaluates an argument of a text function into a scalar value or a 2-D array of
    /// values. References to a single cell collapse to a scalar; multi-cell ranges
    /// and array literals/spills become arrays that the result is broadcast over.
    pub(super) fn text_arg(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<TextArg, CalcResult> {
        match self.evaluate_node_in_context(node, cell) {
            CalcResult::Error {
                error,
                origin,
                message,
            } => Ok(TextArg::Error(
                ArrayNode::Error(error.clone()),
                CalcResult::Error {
                    error,
                    origin,
                    message,
                },
            )),
            CalcResult::Range { left, right } => {
                Ok(TextArg::Array(self.evaluate_range(left, right)))
            }
            CalcResult::Array(a) => Ok(TextArg::Array(a)),
            CalcResult::Lambda(_) => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expecting a value".to_string(),
            )),
            other => Ok(TextArg::Scalar(calc_result_to_array_node(other))),
        }
    }

    pub(crate) fn fn_left(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 2 || args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let num = if args.len() == 2 {
            match self.text_arg(&args[1], cell) {
                Ok(o) => o,
                Err(e) => return e,
            }
        } else {
            TextArg::Scalar(ArrayNode::Number(1.0))
        };
        broadcast_text(cell, &[&text, &num], |i, j| {
            left_element(text.elem(i, j), num.elem(i, j))
        })
    }

    pub(crate) fn fn_right(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 2 || args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let num = if args.len() == 2 {
            match self.text_arg(&args[1], cell) {
                Ok(o) => o,
                Err(e) => return e,
            }
        } else {
            TextArg::Scalar(ArrayNode::Number(1.0))
        };
        broadcast_text(cell, &[&text, &num], |i, j| {
            right_element(text.elem(i, j), num.elem(i, j))
        })
    }

    pub(crate) fn fn_mid(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let start = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let length = match self.text_arg(&args[2], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        broadcast_text(cell, &[&text, &start, &length], |i, j| {
            mid_element(text.elem(i, j), start.elem(i, j), length.elem(i, j))
        })
    }

    // REPT(text, number_times)
    pub(crate) fn fn_rept(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let number_times = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        broadcast_text(cell, &[&text, &number_times], |i, j| {
            rept_element(text.elem(i, j), self.text_number(number_times.elem(i, j)))
        })
    }

    // TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])
    pub(crate) fn fn_textafter(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(2..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let delimiter = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let instance_num = if arg_count > 2 {
            match self.get_number(&args[2], cell) {
                Ok(f) => f.floor() as i32,
                Err(s) => return s,
            }
        } else {
            1
        };
        let match_mode = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => {
                    if f == 0.0 {
                        Case::Sensitive
                    } else {
                        Case::Insensitive
                    }
                }
                Err(s) => return s,
            }
        } else {
            Case::Sensitive
        };

        let match_end = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            // disabled by default
            // the delimiter is specified in the formula
            0.0
        };
        if instance_num == 0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "instance_num must be <> 0".to_string(),
            };
        }
        if delimiter.len() > text.len() {
            // so this is fun(!)
            // if the function was provided with two arguments is a #VALUE!
            // if it had more is a #N/A (irrespective of their values)
            if arg_count > 2 {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "The delimiter is longer than the text is trying to match".to_string(),
                };
            } else {
                return CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "The delimiter is longer than the text is trying to match".to_string(),
                };
            }
        }
        if match_end != 0.0 && match_end != 1.0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "argument must be 0 or 1".to_string(),
            };
        };
        match text_after(&text, &delimiter, instance_num, match_mode) {
            Some(s) => CalcResult::String(s),
            None => {
                if match_end == 1.0 {
                    if instance_num == 1 {
                        return CalcResult::String("".to_string());
                    } else if instance_num == -1 {
                        return CalcResult::String(text);
                    }
                }
                if arg_count == 6 {
                    // An empty cell is converted to empty string (not 0)
                    match self.evaluate_node_in_context(&args[5], cell) {
                        CalcResult::EmptyCell => CalcResult::String("".to_string()),
                        result => result,
                    }
                } else {
                    CalcResult::Error {
                        error: Error::NA,
                        origin: cell,
                        message: "Value not found".to_string(),
                    }
                }
            }
        }
    }

    pub(crate) fn fn_textbefore(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(2..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let delimiter = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let instance_num = if arg_count > 2 {
            match self.get_number(&args[2], cell) {
                Ok(f) => f.floor() as i32,
                Err(s) => return s,
            }
        } else {
            1
        };
        let match_mode = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => {
                    if f == 0.0 {
                        Case::Sensitive
                    } else {
                        Case::Insensitive
                    }
                }
                Err(s) => return s,
            }
        } else {
            Case::Sensitive
        };

        let match_end = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            // disabled by default
            // the delimiter is specified in the formula
            0.0
        };
        if instance_num == 0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "instance_num must be <> 0".to_string(),
            };
        }
        if delimiter.len() > text.len() {
            // so this is fun(!)
            // if the function was provided with two arguments is a #VALUE!
            // if it had more is a #N/A (irrespective of their values)
            if arg_count > 2 {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "The delimiter is longer than the text is trying to match".to_string(),
                };
            } else {
                return CalcResult::Error {
                    error: Error::NA,
                    origin: cell,
                    message: "The delimiter is longer than the text is trying to match".to_string(),
                };
            }
        }
        if match_end != 0.0 && match_end != 1.0 {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "argument must be 0 or 1".to_string(),
            };
        };
        match text_before(&text, &delimiter, instance_num, match_mode) {
            Some(s) => CalcResult::String(s),
            None => {
                if match_end == 1.0 {
                    if instance_num == -1 {
                        return CalcResult::String("".to_string());
                    } else if instance_num == 1 {
                        return CalcResult::String(text);
                    }
                }
                if arg_count == 6 {
                    // An empty cell is converted to empty string (not 0)
                    match self.evaluate_node_in_context(&args[5], cell) {
                        CalcResult::EmptyCell => CalcResult::String("".to_string()),
                        result => result,
                    }
                } else {
                    CalcResult::Error {
                        error: Error::NA,
                        origin: cell,
                        message: "Value not found".to_string(),
                    }
                }
            }
        }
    }

    // TEXTJOIN(delimiter, ignore_empty, text1, [text2], …)
    pub(crate) fn fn_textjoin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count < 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let delimiter = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let ignore_empty = match self.get_boolean(&args[1], cell) {
            Ok(b) => b,
            Err(error) => return error,
        };
        let mut values = Vec::new();
        for arg in &args[2..] {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => values.push(format!("{value}")),
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    let row1 = left.row;
                    let mut row2 = right.row;
                    let column1 = left.column;
                    let mut column2 = right.column;
                    match self.clip_to_used_area(left.sheet, row1, column1, row2, column2) {
                        Ok((r, c)) => {
                            row2 = r;
                            column2 = c;
                        }
                        Err(message) => return CalcResult::new_error(Error::ERROR, cell, message),
                    }
                    for row in row1..row2 + 1 {
                        for column in column1..(column2 + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::Number(value) => {
                                    values.push(format!("{value}"));
                                }
                                CalcResult::String(value) => values.push(value),
                                CalcResult::Boolean(value) => {
                                    if value {
                                        values.push("TRUE".to_string())
                                    } else {
                                        values.push("FALSE".to_string())
                                    }
                                }
                                CalcResult::EmptyCell => {
                                    if !ignore_empty {
                                        values.push("".to_string())
                                    }
                                }
                                error @ CalcResult::Error { .. } => return error,
                                CalcResult::EmptyArg | CalcResult::Range { .. } => {}
                                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                                    return CalcResult::Error {
                                        error: Error::NIMPL,
                                        origin: cell,
                                        message: "Arrays not supported yet".to_string(),
                                    }
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                CalcResult::String(value) => values.push(value),
                CalcResult::Boolean(value) => {
                    if value {
                        values.push("TRUE".to_string())
                    } else {
                        values.push("FALSE".to_string())
                    }
                }
                CalcResult::EmptyCell => {
                    if !ignore_empty {
                        values.push("".to_string())
                    }
                }
                CalcResult::EmptyArg => {}
                CalcResult::Array(_) | CalcResult::Lambda(_) => {
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "Arrays not supported yet".to_string(),
                    }
                }
            };
        }
        let result = values.join(&delimiter);
        CalcResult::String(result)
    }

    // SUBSTITUTE(text, old_text, new_text, [instance_num])
    pub(crate) fn fn_substitute(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=4).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let old_text = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let new_text = match self.text_arg(&args[2], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        // Without it every instance is replaced
        let instance_num = if arg_count > 3 {
            match self.text_arg(&args[3], cell) {
                Ok(o) => Some(o),
                Err(e) => return e,
            }
        } else {
            None
        };
        let mut operands = vec![&text, &old_text, &new_text];
        if let Some(instance_num) = &instance_num {
            operands.push(instance_num);
        }
        broadcast_text(cell, &operands, |i, j| {
            substitute_element(
                text.elem(i, j),
                old_text.elem(i, j),
                new_text.elem(i, j),
                instance_num
                    .as_ref()
                    .map(|n| self.text_number(n.elem(i, j))),
            )
        })
    }
    pub(crate) fn fn_concatenate(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count == 0 {
            return CalcResult::new_args_number_error(cell);
        }
        let mut text_array = Vec::new();
        for arg in args {
            let text = match self.get_string(arg, cell) {
                Ok(s) => s,
                Err(error) => return error,
            };
            text_array.push(text)
        }
        CalcResult::String(text_array.join(""))
    }

    // EXACT(text1, text2)
    // If any of the arguments is an array it compares element by element.
    pub(crate) fn fn_exact(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let text1 = match self.text_arg(&args[0], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        let text2 = match self.text_arg(&args[1], cell) {
            Ok(o) => o,
            Err(e) => return e,
        };
        broadcast_text(cell, &[&text1, &text2], |i, j| {
            exact_element(text1.elem(i, j), text2.elem(i, j))
        })
    }
    // VALUE(text)
    pub(crate) fn fn_value(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::String(text) => {
                let currencies = vec!["$", "€"];
                if let Ok((value, _)) = parse_formatted_number(&text, &currencies, self.locale) {
                    return CalcResult::Number(value);
                };
                CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Invalid number".to_string(),
                }
            }
            CalcResult::Number(f) => CalcResult::Number(f),
            CalcResult::Boolean(_) => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Invalid number".to_string(),
            },
            error @ CalcResult::Error { .. } => error,
            CalcResult::Range { .. } => {
                // TODO Implicit Intersection
                CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Invalid number".to_string(),
                }
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => CalcResult::Number(0.0),
            CalcResult::Array(_) | CalcResult::Lambda(_) => CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Arrays not supported yet".to_string(),
            },
        }
    }

    pub(crate) fn fn_t(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        // FIXME: Implicit intersection
        let result = self.evaluate_node_in_context(&args[0], cell);
        match result {
            CalcResult::String(_) => result,
            error @ CalcResult::Error { .. } => error,
            _ => CalcResult::String("".to_string()),
        }
    }

    // VALUETOTEXT(value)
    pub(crate) fn fn_valuetotext(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(error) => match error {
                CalcResult::Error { error, .. } => error.to_string(),
                _ => "".to_string(),
            },
        };
        CalcResult::String(text)
    }
}
