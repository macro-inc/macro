use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_stdev_p(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut sum = 0.0;
        let mut sumsq = 0.0;
        let mut count: u64 = 0;

        #[inline]
        fn accumulate(sum: &mut f64, sumsq: &mut f64, count: &mut u64, value: f64) {
            *sum += value;
            *sumsq += value * value;
            *count += 1;
        }

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                }
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // ignore non-numeric
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // ignore non-numeric
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // ignore non-numeric
                }
            }
        }

        if count == 0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STDEV.P with no numeric data".to_string(),
            );
        }

        let n = count as f64;
        let mut var = (sumsq - (sum * sum) / n) / n;

        // clamp tiny negatives from FP noise
        if var < 0.0 && var > -1e-12 {
            var = 0.0;
        }

        CalcResult::Number(var.sqrt())
    }

    pub(crate) fn fn_stdev_s(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut sum = 0.0;
        let mut sumsq = 0.0;
        let mut count: u64 = 0;

        #[inline]
        fn accumulate(sum: &mut f64, sumsq: &mut f64, count: &mut u64, value: f64) {
            *sum += value;
            *sumsq += value * value;
            *count += 1;
        }

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                }
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // ignore non-numeric
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // ignore non-numeric
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // ignore non-numeric
                }
            }
        }

        if count <= 1 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STDEV.S requires at least two numeric values".to_string(),
            );
        }

        let n = count as f64;
        let mut var = (sumsq - (sum * sum) / n) / (n - 1.0);

        if var < 0.0 && var > -1e-12 {
            var = 0.0;
        }

        CalcResult::Number(var.sqrt())
    }

    pub(crate) fn fn_stdeva(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut sum = 0.0;
        let mut sumsq = 0.0;
        let mut count: u64 = 0;

        #[inline]
        fn accumulate(sum: &mut f64, sumsq: &mut f64, count: &mut u64, value: f64) {
            *sum += value;
            *sumsq += value * value;
            *count += 1;
        }

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                }
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                CalcResult::String(_) => {
                                    accumulate(&mut sum, &mut sumsq, &mut count, 0.0);
                                }
                                CalcResult::Boolean(value) => {
                                    let val = if value { 1.0 } else { 0.0 };
                                    accumulate(&mut sum, &mut sumsq, &mut count, val);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // ignore non-numeric for now
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // ignore non-numeric for now
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // ignore non-numeric for now
                }
            }
        }

        if count <= 1 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STDEVA requires at least two numeric values".to_string(),
            );
        }

        let n = count as f64;
        let mut var = (sumsq - (sum * sum) / n) / (n - 1.0);

        if var < 0.0 && var > -1e-12 {
            var = 0.0;
        }

        CalcResult::Number(var.sqrt())
    }

    pub(crate) fn fn_stdevpa(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut sum = 0.0;
        let mut sumsq = 0.0;
        let mut count: u64 = 0;

        #[inline]
        fn accumulate(sum: &mut f64, sumsq: &mut f64, count: &mut u64, value: f64) {
            *sum += value;
            *sumsq += value * value;
            *count += 1;
        }

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => {
                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                }
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                CalcResult::String(_) => {
                                    accumulate(&mut sum, &mut sumsq, &mut count, 0.0);
                                }
                                CalcResult::Boolean(value) => {
                                    let val = if value { 1.0 } else { 0.0 };
                                    accumulate(&mut sum, &mut sumsq, &mut count, val);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // ignore non-numeric for now
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
                                    accumulate(&mut sum, &mut sumsq, &mut count, value);
                                }
                                ArrayNode::Error(error) => {
                                    return CalcResult::Error {
                                        error,
                                        origin: cell,
                                        message: "Error in array".to_string(),
                                    }
                                }
                                _ => {
                                    // ignore non-numeric for now
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // ignore non-numeric for now
                }
            }
        }

        if count == 0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STDEVPA with no numeric data".to_string(),
            );
        }

        let n = count as f64;
        let mut var = (sumsq - (sum * sum) / n) / n;

        if var < 0.0 && var > -1e-12 {
            var = 0.0;
        }

        CalcResult::Number(var.sqrt())
    }
}
