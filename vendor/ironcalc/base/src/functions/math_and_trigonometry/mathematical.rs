use crate::arithmetic::power;
use crate::cast::NumberOrArray;
use crate::constants::EXCEL_PRECISION;
use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::number_format::{to_excel_precision, to_precision};
use crate::single_number_fn;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};
use std::f64::consts::PI;

impl<'a> Model<'a> {
    pub(crate) fn fn_min(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.min_or_max(args, cell, f64::min)
    }

    pub(crate) fn fn_max(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.min_or_max(args, cell, f64::max)
    }

    /// MIN and MAX: `pick` keeps the one of two numbers the function is after.
    ///
    /// In references and arrays only the numbers count; text and booleans are
    /// ignored. A value given directly as an argument has to be a number:
    /// booleans and text that reads as a number are converted, any other text
    /// is an error.
    fn min_or_max(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        pick: fn(f64, f64) -> f64,
    ) -> CalcResult {
        let mut result = f64::NAN;
        for arg in args {
            // A reference stays a reference, also to a single cell
            match self.evaluate_node_with_reference(arg, cell) {
                CalcResult::Number(value) => result = pick(value, result),
                CalcResult::Boolean(value) => result = pick(if value { 1.0 } else { 0.0 }, result),
                CalcResult::String(value) => match self.cast_number(&value) {
                    Some(value) => result = pick(value, result),
                    None => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Argument cannot be cast into number".to_string(),
                        );
                    }
                },
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
                                CalcResult::Number(value) => {
                                    result = pick(value, result);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for node in row {
                            match node {
                                ArrayNode::Number(value) => result = pick(value, result),
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: String::new(),
                                    }
                                }
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                // An argument left out, as in `MAX(,-1)`, counts as 0
                CalcResult::EmptyArg => result = pick(0.0, result),
                CalcResult::EmptyCell | CalcResult::Lambda(_) => {}
            };
        }
        if result.is_nan() || result.is_infinite() {
            return CalcResult::Number(0.0);
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_base(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(2..=3).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }

        // number to convert
        let mut value = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc() as i64,
            Err(s) => return s,
        };
        // radix
        let radix = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc() as i64,
            Err(s) => return s,
        };
        // optional min_length
        let min_length = if arg_count == 3 {
            match self.get_number(&args[2], cell) {
                Ok(f) => {
                    if f < 0.0 {
                        return CalcResult::Error {
                            error: Error::NUM,
                            origin: cell,
                            message: "Minimum length must be non-negative".to_string(),
                        };
                    }
                    f.trunc() as usize
                }
                Err(s) => return s,
            }
        } else {
            0
        };

        if !(2..=36).contains(&radix) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Radix must be between 2 and 36".to_string(),
            };
        }

        // number must be >= 0
        if value < 0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Number must be non-negative".to_string(),
            };
        }

        let mut buf = String::new();
        if value == 0 {
            buf.push('0');
        } else {
            while value > 0 {
                let digit = (value % radix) as u8;
                let ch = match digit {
                    0..=9 => (b'0' + digit) as char,
                    10..=35 => (b'A' + (digit - 10)) as char,
                    _ => unreachable!(),
                };
                buf.push(ch);
                value /= radix;
            }
            // we built it in reverse
            buf = buf.chars().rev().collect();
        }

        // pad with leading zeros if needed
        if buf.len() < min_length {
            let mut padded = String::with_capacity(min_length);
            for _ in 0..(min_length - buf.len()) {
                padded.push('0');
            }
            padded.push_str(&buf);
            buf = padded;
        }

        CalcResult::String(buf)
    }

    pub(crate) fn fn_decimal(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let radix = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc() as i32,
            Err(s) => return s,
        };
        if !(2..=36).contains(&radix) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Radix must be between 2 and 36".to_string(),
            };
        }
        match i64::from_str_radix(&text, radix as u32) {
            Ok(n) => CalcResult::Number(n as f64),
            Err(_) => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: format!("'{}' is not a valid number in base {}", text, radix),
            },
        }
    }

    /// SUM(number1, [number2], ...)
    ///
    /// The SUM function adds values. You can add individual values, cell references or ranges or a mix of all three.
    ///
    /// # Details
    /// Generally each argument is evaluated and the result is converted to a number. However there are some special
    /// cases:
    /// - **Args evaluating to CalcResult::Range**: The sum of all the numbers in the range is calculated. No
    ///   conversions are performed, non-numeric values are ignored and errors are propagated.
    /// - **Node::ReferenceKind args**: Similar to ranges, conversions are not performed on the evaulated value of the
    ///   referenced cell and errors are propagated.
    /// - **Args evaluating to CalcResult::Error**: Errors are propagated.
    pub(crate) fn fn_sum(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut result = 0.0;
        for arg in args {
            // Handle reference special case. Behaviour of a reference is equivalent to a range of one cell.
            let arg = match arg {
                Node::ReferenceKind {
                    column,
                    absolute_column,
                    row,
                    absolute_row,
                    sheet_index,
                    sheet_name,
                } => &Node::RangeKind {
                    sheet_name: sheet_name.clone(),
                    sheet_index: *sheet_index,
                    absolute_row1: *absolute_row,
                    absolute_column1: *absolute_column,
                    row1: *row,
                    column1: *column,
                    absolute_row2: *absolute_row,
                    absolute_column2: *absolute_column,
                    row2: *row,
                    column2: *column,
                },
                _ => arg,
            };

            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    // TODO: We should do this for all functions that run through ranges
                    // Running cargo test for the ironcalc takes around .8 seconds with this speedup
                    // and ~ 3.5 seconds without it. Note that once properly in place sheet.dimension should be almost a noop
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
                                    result += value;
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for value in row {
                            match value {
                                ArrayNode::Number(value) => {
                                    result += value;
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                calc_result => {
                    let cast_result = self.cast_to_number(calc_result, cell);
                    match cast_result {
                        Ok(f) => result += f,
                        Err(s) => return s,
                    }
                }
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_sumsq(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut result = 0.0;
        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => result += value * value,
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    // TODO: We should do this for all functions that run through ranges
                    // Running cargo test for the ironcalc takes around .8 seconds with this speedup
                    // and ~ 3.5 seconds without it. Note that once properly in place sheet.dimension should be almost a noop
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
                                    result += value * value;
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(array) => {
                    for row in array {
                        for value in row {
                            match value {
                                ArrayNode::Number(value) => {
                                    result += value * value;
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // We ignore booleans and strings
                }
            };
        }
        CalcResult::Number(result)
    }

    /// PRODUCT(number1, [number2], ...)
    ///
    /// The PRODUCT function multiplies values. You can add individual values, cell references or ranges or a mix of all
    /// three.
    ///
    /// # Details
    /// Generally each argument is evaluated and the result is converted to a number. However there are some special
    /// cases:
    /// - **Args evaluating to CalcResult::Range**: The product of all the numbers in the range is calculated. No
    ///   conversions are performed, non-numeric values are ignored and errors are propagated.
    /// - **Node::ReferenceKind args**: Similar to ranges, conversions are not performed on the evaulated value of the
    ///   referenced cell and errors are propagated.
    /// - **Args evaluating to CalcResult::Error**: Errors are propagated.
    pub(crate) fn fn_product(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let mut result = 1.0;
        let mut seen_value = false;

        for arg in args {
            // Handle reference special case. Behaviour of a reference is equivalent to a range of one cell.
            let arg = match arg {
                Node::ReferenceKind {
                    column,
                    absolute_column,
                    row,
                    absolute_row,
                    sheet_index,
                    sheet_name,
                } => &Node::RangeKind {
                    sheet_name: sheet_name.clone(),
                    sheet_index: *sheet_index,
                    absolute_row1: *absolute_row,
                    absolute_column1: *absolute_column,
                    row1: *row,
                    column1: *column,
                    absolute_row2: *absolute_row,
                    absolute_column2: *absolute_column,
                    row2: *row,
                    column2: *column,
                },
                _ => arg,
            };
            let cell_value = self.evaluate_node_in_context(arg, cell);

            match cell_value {
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    // TODO: We should do this for all functions that run through ranges. See fn_sum for more details
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
                            let cell_value = self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            });

                            match cell_value {
                                CalcResult::Number(value) => {
                                    seen_value = true;
                                    result *= value;
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                // MACRO: the numbers of a computed array, e.g. PRODUCT(IF(A1:A9>0,A1:A9,1)).
                CalcResult::Array(array) => {
                    for value in array.iter().flatten() {
                        match value {
                            ArrayNode::Number(value) => {
                                seen_value = true;
                                result *= value;
                            }
                            ArrayNode::Error(error) => {
                                return CalcResult::new_error(error.clone(), cell, String::new())
                            }
                            _ => {}
                        }
                    }
                }
                calc_result => {
                    seen_value = true;
                    let cast_result = self.cast_to_number(calc_result, cell);
                    match cast_result {
                        Ok(f) => result *= f,
                        Err(s) => return s,
                    }
                }
            };
        }
        if !seen_value {
            return CalcResult::Number(0.0);
        }
        CalcResult::Number(result)
    }

    /// SUMIF(criteria_range, criteria, [sum_range])
    /// if sum_range is missing then criteria_range will be used.
    ///
    /// The `criteria` argument may be a single value, a range or an array; in the
    /// latter two cases SUMIF spills one sum per criterion (see [`Model::sumif`]).
    pub(crate) fn fn_sumif(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // When sum_range is missing, criteria_range doubles as the sum_range.
        let (criteria_range, criteria, sum_range) = match args.len() {
            2 => (&args[0], &args[1], &args[0]),
            3 => (&args[0], &args[1], &args[2]),
            _ => return CalcResult::new_args_number_error(cell),
        };
        self.sumif(criteria_range, criteria, sum_range, cell)
    }

    /// SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)
    pub(crate) fn fn_sumifs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let mut total = 0.0;
        let sum = |value| total += value;
        if let Err(e) = self.apply_ifs(args, cell, sum) {
            return e;
        }
        CalcResult::Number(total)
    }

    pub(crate) fn fn_round(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            // Incorrect number of arguments
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => to_precision(f, 15),
            Err(s) => return s,
        };
        let number_of_digits = match self.get_number(&args[1], cell) {
            Ok(f) => {
                if f > 0.0 {
                    f.floor()
                } else {
                    f.ceil()
                }
            }
            Err(s) => return s,
        };
        let scale = 10.0_f64.powf(number_of_digits);
        CalcResult::Number((value * scale).round() / scale)
    }

    pub(crate) fn fn_roundup(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => to_precision(f, 15),
            Err(s) => return s,
        };
        let number_of_digits = match self.get_number(&args[1], cell) {
            Ok(f) => {
                if f > 0.0 {
                    f.floor()
                } else {
                    f.ceil()
                }
            }
            Err(s) => return s,
        };
        let scale = 10.0_f64.powf(number_of_digits);
        if value > 0.0 {
            CalcResult::Number((value * scale).ceil() / scale)
        } else {
            CalcResult::Number((value * scale).floor() / scale)
        }
    }

    pub(crate) fn fn_rounddown(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => to_precision(f, 15),
            Err(s) => return s,
        };
        let number_of_digits = match self.get_number(&args[1], cell) {
            Ok(f) => {
                if f > 0.0 {
                    f.floor()
                } else {
                    f.ceil()
                }
            }
            Err(s) => return s,
        };
        let scale = 10.0_f64.powf(number_of_digits);
        if value > 0.0 {
            CalcResult::Number((value * scale).floor() / scale)
        } else {
            CalcResult::Number((value * scale).ceil() / scale)
        }
    }

    // (number, divisor)
    pub(crate) fn fn_mod(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let divisor = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if divisor == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Divide by 0".to_string(),
            };
        }
        let result = value - divisor * (value / divisor).floor();
        CalcResult::Number(result)
    }

    pub(crate) fn fn_quotient(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let divisor = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if divisor == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Divide by 0".to_string(),
            };
        }

        let result = value / divisor;
        CalcResult::Number(result.signum() * result.abs().floor())
    }

    pub(crate) fn fn_floor(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if significance == 0.0 {
            if value == 0.0 {
                return CalcResult::Number(0.0);
            }
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Divide by 0".to_string(),
            };
        }
        if significance < 0.0 && value > 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Significance must be positive when value is positive".to_string(),
            };
        }

        // Apply Excel precision to the ratio to handle floating-point rounding errors
        let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
        let result = f64::floor(ratio) * significance;
        CalcResult::Number(result)
    }

    pub(crate) fn fn_ceiling(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if significance == 0.0 {
            // This behaviour is different from FLOOR where division by zero returns an error
            return CalcResult::Number(0.0);
        }
        if significance < 0.0 && value > 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Significance must be positive when value is positive".to_string(),
            };
        }
        // Apply Excel precision fix
        let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
        let result = f64::ceil(ratio) * significance;
        CalcResult::Number(result)
    }

    pub(crate) fn fn_ceiling_math(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let arg_count = args.len();
        if !(1..=3).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = if arg_count > 1 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.abs(),
                Err(s) => return s,
            }
        } else {
            1.0
        };
        let mode = if arg_count > 2 {
            match self.get_number(&args[2], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if significance == 0.0 {
            return CalcResult::Number(0.0);
        }
        if value < 0.0 && mode != 0.0 {
            // Apply Excel precision fix
            let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
            let result = f64::floor(ratio) * significance;
            CalcResult::Number(result)
        } else {
            // Apply Excel precision fix
            let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
            let result = f64::ceil(ratio) * significance;
            CalcResult::Number(result)
        }
    }

    pub(crate) fn fn_ceiling_precise(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let arg_count = args.len();
        if !(1..=2).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = if arg_count > 1 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.abs(),
                Err(s) => return s,
            }
        } else {
            1.0
        };
        if significance == 0.0 {
            return CalcResult::Number(0.0);
        }
        // Apply Excel precision fix
        let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
        let result = f64::ceil(ratio) * significance;
        CalcResult::Number(result)
    }

    pub(crate) fn fn_iso_ceiling(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // ISO.CEILING is equivalent to CEILING.PRECISE
        self.fn_ceiling_precise(args, cell)
    }

    pub(crate) fn fn_floor_math(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(1..=3).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = if arg_count > 1 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            1.0
        };
        let mode = if arg_count > 2 {
            match self.get_number(&args[2], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if significance == 0.0 {
            return CalcResult::Number(0.0);
        }
        let significance = significance.abs();
        if value < 0.0 && mode != 0.0 {
            // Apply Excel precision to handle floating-point rounding errors
            let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
            let result = f64::ceil(ratio) * significance;
            CalcResult::Number(result)
        } else {
            // Apply Excel precision to handle floating-point rounding errors
            let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
            let result = f64::floor(ratio) * significance;
            CalcResult::Number(result)
        }
    }

    pub(crate) fn fn_floor_precise(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let arg_count = args.len();
        if !(1..=2).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let significance = if arg_count > 1 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.abs(),
                Err(s) => return s,
            }
        } else {
            1.0
        };
        if significance == 0.0 {
            return CalcResult::Number(0.0);
        }

        // Apply Excel precision to handle floating-point rounding errors
        let ratio = to_excel_precision(value / significance, EXCEL_PRECISION);
        let result = f64::floor(ratio) * significance;
        CalcResult::Number(result)
    }

    pub(crate) fn fn_mround(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // MROUND(number, multiple)
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let value = self.evaluate_node_in_context(&args[0], cell);

        let multiple = self.evaluate_node_in_context(&args[1], cell);

        // if either is empty => #N/A
        if matches!(value, CalcResult::EmptyArg) || matches!(multiple, CalcResult::EmptyArg) {
            return CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Bad argument for MROUND".to_string(),
            };
        }

        // Booleans are not cast
        if matches!(value, CalcResult::Boolean(_)) {
            return CalcResult::new_error(Error::VALUE, cell, "Expecting number".to_string());
        }

        if matches!(multiple, CalcResult::Boolean(_)) {
            return CalcResult::new_error(Error::VALUE, cell, "Expecting number".to_string());
        }

        let value = match self.cast_to_number(value, cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let multiple = match self.cast_to_number(multiple, cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if multiple == 0.0 {
            return CalcResult::Number(0.0);
        }
        if (value > 0.0 && multiple < 0.0) || (value < 0.0 && multiple > 0.0) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "number and multiple must have the same sign".to_string(),
            };
        }
        let result = (value / multiple).round() * multiple;
        CalcResult::Number(result)
    }

    pub(crate) fn fn_trunc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let num_digits = if args.len() == 2 {
            match self.get_number(&args[1], cell) {
                Ok(f) => {
                    if f > 0.0 {
                        f.floor()
                    } else {
                        f.ceil()
                    }
                }
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if !(-15.0..=15.0).contains(&num_digits) {
            return CalcResult::Number(value);
        }
        let v = if value >= 0.0 {
            f64::floor(value * 10f64.powf(num_digits)) / 10f64.powf(num_digits)
        } else {
            f64::ceil(value * 10f64.powf(num_digits)) / 10f64.powf(num_digits)
        };
        if value.is_finite() && v.is_infinite() {
            return CalcResult::Number(value);
        }
        CalcResult::Number(v)
    }

    single_number_fn!(fn_log10, |f| if f <= 0.0 {
        Err(Error::NUM)
    } else {
        Ok(f64::log10(f))
    });
    single_number_fn!(fn_ln, |f| if f <= 0.0 {
        Err(Error::NUM)
    } else {
        Ok(f64::ln(f))
    });
    single_number_fn!(fn_sin, |f| Ok(f64::sin(f)));
    single_number_fn!(fn_cos, |f| Ok(f64::cos(f)));
    single_number_fn!(fn_tan, |f| Ok(f64::tan(f)));
    single_number_fn!(fn_sinh, |f| Ok(f64::sinh(f)));
    single_number_fn!(fn_cosh, |f| Ok(f64::cosh(f)));
    single_number_fn!(fn_tanh, |f| Ok(f64::tanh(f)));
    single_number_fn!(fn_asin, |f| Ok(f64::asin(f)));
    single_number_fn!(fn_acos, |f| Ok(f64::acos(f)));
    single_number_fn!(fn_atan, |f| Ok(f64::atan(f)));
    single_number_fn!(fn_asinh, |f| Ok(f64::asinh(f)));
    single_number_fn!(fn_acosh, |f| Ok(f64::acosh(f)));
    single_number_fn!(fn_atanh, |f| Ok(f64::atanh(f)));
    single_number_fn!(fn_abs, |f| Ok(f64::abs(f)));
    single_number_fn!(fn_sqrt, |f| if f < 0.0 {
        Err(Error::NUM)
    } else {
        Ok(f64::sqrt(f))
    });
    single_number_fn!(fn_sqrtpi, |f: f64| if f < 0.0 {
        Err(Error::NUM)
    } else {
        Ok((f * PI).sqrt())
    });

    single_number_fn!(fn_acot, |f| {
        let v = f64::atan(1.0 / f);
        if f >= 0.0 {
            Ok(v)
        } else {
            // To be compatible with Excel we need a different branch
            // when f < 0
            Ok(v + PI)
        }
    });
    single_number_fn!(fn_acoth, |f: f64| if f.abs() == 1.0 {
        Err(Error::NUM)
    } else {
        Ok(0.5 * (f64::ln((f + 1.0) / (f - 1.0))))
    });
    single_number_fn!(fn_cot, |f| if f == 0.0 {
        Err(Error::DIV)
    } else {
        Ok(f64::cos(f) / f64::sin(f))
    });
    single_number_fn!(fn_coth, |f: f64| if f == 0.0 {
        Err(Error::DIV)
    } else if f.abs() > 20.0 {
        // for values > 20.0 this is exact in f64
        Ok(f.signum())
    } else {
        Ok(f64::cosh(f) / f64::sinh(f))
    });
    single_number_fn!(fn_csc, |f| if f == 0.0 {
        Err(Error::DIV)
    } else {
        Ok(1.0 / f64::sin(f))
    });
    single_number_fn!(fn_csch, |f| if f == 0.0 {
        Err(Error::DIV)
    } else {
        Ok(1.0 / f64::sinh(f))
    });
    single_number_fn!(fn_sec, |f| Ok(1.0 / f64::cos(f)));
    single_number_fn!(fn_sech, |f| Ok(1.0 / f64::cosh(f)));
    single_number_fn!(fn_exp, |f: f64| Ok(f64::exp(f)));
    single_number_fn!(fn_fact, |x: f64| {
        let x = x.floor();
        if x < 0.0 {
            return Err(Error::NUM);
        }
        let mut acc = 1.0;
        let mut k = 2.0;
        while k <= x {
            acc *= k;
            k += 1.0;
        }
        Ok(acc)
    });
    single_number_fn!(fn_factdouble, |x: f64| {
        let x = x.floor();
        if x < -1.0 {
            return Err(Error::NUM);
        }
        if x < 0.0 {
            return Ok(1.0);
        }
        let mut acc = 1.0;
        let mut k = if x % 2.0 == 0.0 { 2.0 } else { 1.0 };
        while k <= x {
            acc *= k;
            k += 2.0;
        }
        Ok(acc)
    });
    single_number_fn!(fn_sign, |f| {
        if f == 0.0 {
            Ok(0.0)
        } else {
            Ok(f64::signum(f))
        }
    });
    single_number_fn!(fn_degrees, |f| Ok(f * (180.0 / PI)));
    single_number_fn!(fn_radians, |f| Ok(f * (PI / 180.0)));
    single_number_fn!(fn_odd, |f| {
        let sign = f64::signum(f);
        Ok(sign * (f64::ceil((f64::abs(f) - 1.0) / 2.0) * 2.0 + 1.0))
    });
    single_number_fn!(fn_even, |f| Ok(f64::signum(f)
        * f64::ceil(f64::abs(f) / 2.0)
        * 2.0));
    single_number_fn!(fn_int, |f| Ok(f64::floor(f)));

    pub(crate) fn fn_pi(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        CalcResult::Number(PI)
    }

    pub(crate) fn fn_atan2(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let y = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if x == 0.0 && y == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Arguments can't be both zero".to_string(),
            };
        }
        CalcResult::Number(f64::atan2(y, x))
    }

    pub(crate) fn fn_log(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let n_args = args.len();
        if !(1..=2).contains(&n_args) {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let y = if n_args == 1 {
            10.0
        } else {
            match self.get_number(&args[1], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        };
        if x <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Number must be positive".to_string(),
            };
        }
        if y == 1.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Logarithm base cannot be 1".to_string(),
            };
        }
        if y <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Logarithm base must be positive".to_string(),
            };
        }
        CalcResult::Number(f64::log(x, y))
    }

    // POWER(number, power)
    // If the number or the power are arrays it works element by element.
    pub(crate) fn fn_power(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = self.get_number_or_array(&args[0], cell);
        let y = self.get_number_or_array(&args[1], cell);
        let (x, y) = match (x, y) {
            (Ok(NumberOrArray::Number(x)), Ok(NumberOrArray::Number(y))) => (x, y),
            (x, y) => return self.arithmetic_on_values(x, y, cell, &power),
        };
        match power(x, y) {
            Ok(result) => CalcResult::Number(result),
            Err(error) => {
                let message = if x == 0.0 && y == 0.0 {
                    "Arguments can't be both zero"
                } else if error == Error::DIV {
                    "POWER returned infinity"
                } else {
                    // This might happen for some combinations of negative base and exponent
                    "Invalid arguments for POWER"
                };
                CalcResult::Error {
                    error,
                    origin: cell,
                    message: message.to_string(),
                }
            }
        }
    }

    pub(crate) fn fn_combin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let n = match self.get_number(&args[0], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        let k = match self.get_number(&args[1], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        if n < 0.0 || k < 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Arguments must be non-negative integers".to_string(),
            };
        }
        if k > n {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "k cannot be greater than n".to_string(),
            };
        }
        let k = k as usize;
        let mut result = 1.0;
        for i in 0..k {
            let t = i as f64;
            result *= (n - t) / (t + 1.0);
        }
        CalcResult::Number(result)
    }

    // PERCENTOF(part, total) — returns SUM(part) / SUM(total) as a decimal fraction.
    pub(crate) fn fn_percentof(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let part = match self.fn_sum(&args[0..1], cell) {
            CalcResult::Number(v) => v,
            other => return other,
        };
        let total = match self.fn_sum(&args[1..2], cell) {
            CalcResult::Number(v) => v,
            other => return other,
        };
        if total == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number(part / total)
    }

    pub(crate) fn fn_combina(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let n = match self.get_number(&args[0], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        let k = match self.get_number(&args[1], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        if n < 0.0 || k < 0.0 || (n == 0.0 && k > 0.0) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Arguments must be non-negative integers".to_string(),
            };
        }
        let k = k as usize;
        let mut result = 1.0;
        for i in 0..k {
            let t = i as f64;
            result *= (n + t) / (t + 1.0);
        }
        CalcResult::Number(result)
    }
}
