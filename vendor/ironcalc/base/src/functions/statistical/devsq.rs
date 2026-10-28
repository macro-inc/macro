use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // DEVSQ(number1, [number2], ...)
    pub(crate) fn fn_devsq(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut sum = 0.0;
        let mut sumsq = 0.0;
        let mut count: u64 = 0;

        // tiny helper so we don't repeat ourselves
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

        if count == 0 {
            // No numeric data at all
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "DEVSQ with no numeric data".to_string(),
            );
        }

        let n = count as f64;
        let mut result = sumsq - (sum * sum) / n;

        // Numerical noise can make result slightly negative when it should be 0
        if result < 0.0 && result > -1e-12 {
            result = 0.0;
        }

        CalcResult::Number(result)
    }
}
