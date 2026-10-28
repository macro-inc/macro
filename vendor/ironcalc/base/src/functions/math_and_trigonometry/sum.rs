use crate::expressions::types::CellReferenceIndex;

use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

type TwoMatricesResult = (i32, i32, Vec<Option<f64>>, Vec<Option<f64>>);

// Helper to check if two shapes are the same or compatible 1D shapes
fn is_same_shape_or_1d(rows1: i32, cols1: i32, rows2: i32, cols2: i32) -> bool {
    (rows1 == rows2 && cols1 == cols2)
        || (rows1 == 1 && cols2 == 1 && cols1 == rows2)
        || (rows2 == 1 && cols1 == 1 && cols2 == rows1)
}

impl<'a> Model<'a> {
    // SUMX2MY2(array_x, array_y) - Returns the sum of the difference of squares
    pub(crate) fn fn_sumx2my2(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let result = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(s) => return s,
        };

        let (_, _, values_left, values_right) = result;

        let mut sum = 0.0;
        for (x_opt, y_opt) in values_left.into_iter().zip(values_right) {
            let x = x_opt.unwrap_or(0.0);
            let y = y_opt.unwrap_or(0.0);
            sum += x * x - y * y;
        }

        CalcResult::Number(sum)
    }

    // SUMX2PY2(array_x, array_y) - Returns the sum of the sum of squares
    pub(crate) fn fn_sumx2py2(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let result = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(s) => return s,
        };

        let (_rows, _cols, values_left, values_right) = result;

        let mut sum = 0.0;
        for (x_opt, y_opt) in values_left.into_iter().zip(values_right) {
            let x = x_opt.unwrap_or(0.0);
            let y = y_opt.unwrap_or(0.0);
            sum += x * x + y * y;
        }

        CalcResult::Number(sum)
    }

    // SUMXMY2(array_x, array_y) - Returns the sum of squares of differences
    pub(crate) fn fn_sumxmy2(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let result = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(s) => return s,
        };

        let (_, _, values_left, values_right) = result;

        let mut sum = 0.0;
        for (x_opt, y_opt) in values_left.into_iter().zip(values_right) {
            let x = x_opt.unwrap_or(0.0);
            let y = y_opt.unwrap_or(0.0);
            let diff = x - y;
            sum += diff * diff;
        }

        CalcResult::Number(sum)
    }

    // Helper function to extract and validate two matrices (ranges or arrays) with compatible shapes.
    // Returns (rows, cols, values_left, values_right) or an error.
    pub(crate) fn fn_get_two_matrices(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Result<TwoMatricesResult, CalcResult> {
        if args.len() != 2 {
            return Err(CalcResult::new_args_number_error(cell));
        }
        let x_range = self.evaluate_node_in_context(&args[0], cell);
        let y_range = self.evaluate_node_in_context(&args[1], cell);

        let result = match (x_range, y_range) {
            (
                CalcResult::Range {
                    left: l1,
                    right: r1,
                },
                CalcResult::Range {
                    left: l2,
                    right: r2,
                },
            ) => {
                if l1.sheet != l2.sheet {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges are in different sheets".to_string(),
                    ));
                }
                let rows1 = r1.row - l1.row + 1;
                let cols1 = r1.column - l1.column + 1;
                let rows2 = r2.row - l2.row + 1;
                let cols2 = r2.column - l2.column + 1;
                if !is_same_shape_or_1d(rows1, cols1, rows2, cols2) {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges must be of the same shape".to_string(),
                    ));
                }
                let values_left = self.values_from_range(l1, r1)?;
                let values_right = self.values_from_range(l2, r2)?;
                (rows1, cols1, values_left, values_right)
            }
            (
                CalcResult::Array(left),
                CalcResult::Range {
                    left: l2,
                    right: r2,
                },
            ) => {
                let rows2 = r2.row - l2.row + 1;
                let cols2 = r2.column - l2.column + 1;

                let rows1 = left.len() as i32;
                let cols1 = if rows1 > 0 { left[0].len() as i32 } else { 0 };
                if !is_same_shape_or_1d(rows1, cols1, rows2, cols2) {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Array and range must be of the same shape".to_string(),
                    ));
                }
                let values_left = match self.values_from_array(left) {
                    Err(error) => {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            format!("Error in first array: {:?}", error),
                        ));
                    }
                    Ok(v) => v,
                };
                let values_right = self.values_from_range(l2, r2)?;
                (rows2, cols2, values_left, values_right)
            }
            (
                CalcResult::Range {
                    left: l1,
                    right: r1,
                },
                CalcResult::Array(right),
            ) => {
                let rows1 = r1.row - l1.row + 1;
                let cols1 = r1.column - l1.column + 1;

                let rows2 = right.len() as i32;
                let cols2 = if rows2 > 0 { right[0].len() as i32 } else { 0 };
                if !is_same_shape_or_1d(rows1, cols1, rows2, cols2) {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Range and array must be of the same shape".to_string(),
                    ));
                }
                let values_left = self.values_from_range(l1, r1)?;
                let values_right = match self.values_from_array(right) {
                    Err(error) => {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            format!("Error in second array: {:?}", error),
                        ));
                    }
                    Ok(v) => v,
                };
                (rows1, cols1, values_left, values_right)
            }
            (CalcResult::Array(left), CalcResult::Array(right)) => {
                let rows1 = left.len() as i32;
                let rows2 = right.len() as i32;
                let cols1 = if rows1 > 0 { left[0].len() as i32 } else { 0 };
                let cols2 = if rows2 > 0 { right[0].len() as i32 } else { 0 };

                if !is_same_shape_or_1d(rows1, cols1, rows2, cols2) {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Arrays must be of the same shape".to_string(),
                    ));
                }
                let values_left = match self.values_from_array(left) {
                    Err(error) => {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            format!("Error in first array: {:?}", error),
                        ));
                    }
                    Ok(v) => v,
                };
                let values_right = match self.values_from_array(right) {
                    Err(error) => {
                        return Err(CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            format!("Error in second array: {:?}", error),
                        ));
                    }
                    Ok(v) => v,
                };
                (rows1, cols1, values_left, values_right)
            }
            _ => {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Both arguments must be ranges or arrays".to_string(),
                ));
            }
        };
        Ok(result)
    }
}
