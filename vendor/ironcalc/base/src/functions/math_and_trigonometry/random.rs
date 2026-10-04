use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::functions::math_and_trigonometry::array_size::check_array_size;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

#[cfg(not(target_arch = "wasm32"))]
fn random() -> f64 {
    rand::random()
}

#[cfg(target_arch = "wasm32")]
fn random() -> f64 {
    use js_sys::Math;
    Math::random()
}

impl<'a> Model<'a> {
    pub(crate) fn fn_rand(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        CalcResult::Number(random())
    }

    // TODO: Add tests for RANDBETWEEN
    pub(crate) fn fn_randbetween(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        let y = match self.get_number(&args[1], cell) {
            Ok(f) => f.ceil() + 1.0,
            Err(s) => return s,
        };
        if x > y {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: format!("{x}>{y}"),
            };
        }
        CalcResult::Number((x + random() * (y - x)).floor())
    }

    /// `=RANDARRAY([rows], [cols], [min], [max], [whole_number])`
    ///
    /// Returns a 2-D array of random numbers.
    ///   * rows         – number of rows (default 1)
    ///   * cols         – number of columns (default 1)
    ///   * min          – minimum value (default 0)
    ///   * max          – maximum value (default 1)
    ///   * whole_number – FALSE = decimal, TRUE = integer (default FALSE)
    pub(crate) fn fn_randarray(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() > 5 {
            return CalcResult::new_args_number_error(cell);
        }

        let rows = if !args.is_empty() {
            let v = self.evaluate_node_in_context(&args[0], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => {
                        let n = n.floor() as i64;
                        if n == 0 {
                            return CalcResult::new_error(
                                Error::CALC,
                                cell,
                                "rows must be >= 1".to_string(),
                            );
                        }
                        if n < 0 {
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
        } else {
            1
        };

        let columns = if args.len() >= 2 {
            let v = self.evaluate_node_in_context(&args[1], cell);
            if matches!(v, CalcResult::EmptyArg) {
                1
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => {
                        let n = n.floor() as i64;
                        if n == 0 {
                            return CalcResult::new_error(
                                Error::CALC,
                                cell,
                                "columns must be >= 1".to_string(),
                            );
                        }
                        if n < 0 {
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

        let min = if args.len() >= 3 {
            let v = self.evaluate_node_in_context(&args[2], cell);
            if matches!(v, CalcResult::EmptyArg) {
                0.0
            } else {
                match self.cast_to_number(v, cell) {
                    Ok(n) => n,
                    Err(e) => return e,
                }
            }
        } else {
            0.0
        };

        let max = if args.len() >= 4 {
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

        if min > max {
            return CalcResult::new_error(Error::VALUE, cell, "min must be <= max".to_string());
        }

        // get_boolean already maps EmptyArg → false, which is the correct default.
        let whole_number = if args.len() >= 5 {
            match self.get_boolean(&args[4], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };

        let mut result = Vec::with_capacity(rows);
        for _ in 0..rows {
            let mut row = Vec::with_capacity(columns);
            for _ in 0..columns {
                let val = if whole_number {
                    let min_int = min.floor();
                    let max_int = max.floor();
                    let span = max_int - min_int + 1.0;
                    min_int + (random() * span).floor()
                } else {
                    min + random() * (max - min)
                };
                row.push(ArrayNode::Number(val));
            }
            result.push(row);
        }

        CalcResult::Array(result)
    }
}
