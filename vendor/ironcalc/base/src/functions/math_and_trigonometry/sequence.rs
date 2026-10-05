use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::functions::math_and_trigonometry::array_size::check_array_size;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    /// `=SEQUENCE(rows, [cols], [start], [step])`
    ///
    /// Returns a 2-D array of sequential numbers.
    ///   * rows  – number of rows (required, ≥ 1)
    ///   * cols  – number of columns (default 1)
    ///   * start – first value (default 1)
    ///   * step  – increment between values (default 1)
    pub(crate) fn fn_sequence(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let rows = {
            let v = self.evaluate_node_in_context(&args[0], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => {
                        let n = n.floor() as i64;
                        if n < 1 {
                            if n == 0 {
                                return CalcResult::new_error(
                                    Error::CALC,
                                    cell,
                                    "rows must be >= 1".to_string(),
                                );
                            }
                            return CalcResult::new_error(
                                Error::VALUE,
                                cell,
                                "rows must be >= 1".to_string(),
                            );
                        }
                        n as usize
                    }
                    Err(e) => return e,
                }
            }
        };

        let columns = if args.len() >= 2 {
            let v = self.evaluate_node_in_context(&args[1], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => {
                        let n = n.floor() as i64;
                        if n < 1 {
                            if n == 0 {
                                return CalcResult::new_error(
                                    Error::CALC,
                                    cell,
                                    "columns must be >= 1".to_string(),
                                );
                            }
                            return CalcResult::new_error(
                                Error::VALUE,
                                cell,
                                "columns must be >= 1".to_string(),
                            );
                        }
                        n as usize
                    }
                    Err(e) => return e,
                }
            }
        } else {
            1
        };

        if let Some((error, message)) = check_array_size(rows, columns) {
            return CalcResult::new_error(error, cell, message);
        }

        let start = if args.len() >= 3 {
            let v = self.evaluate_node_in_context(&args[2], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1.0
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => n,
                    Err(e) => return e,
                }
            }
        } else {
            1.0
        };

        let step = if args.len() >= 4 {
            let v = self.evaluate_node_in_context(&args[3], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1.0
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => n,
                    Err(e) => return e,
                }
            }
        } else {
            1.0
        };

        let mut result = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(columns);
            for c in 0..columns {
                let idx = (r * columns + c) as f64;
                row.push(ArrayNode::Number(start + idx * step));
            }
            result.push(row);
        }

        CalcResult::Array(result)
    }
}
