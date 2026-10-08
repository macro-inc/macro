use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // PEARSON(array1, array2)
    pub(crate) fn fn_pearson(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_, _, values_left, values_right) = match self.fn_get_two_matrices(args, cell) {
            Ok(result) => result,
            Err(e) => return e,
        };

        // Flatten into (x, y) pairs, skipping non-numeric entries (None)
        let mut n: f64 = 0.0;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_y2 = 0.0;
        let mut sum_xy = 0.0;

        let len = values_left.len().min(values_right.len());
        for i in 0..len {
            match (values_left[i], values_right[i]) {
                (Some(x), Some(y)) => {
                    n += 1.0;
                    sum_x += x;
                    sum_y += y;
                    sum_x2 += x * x;
                    sum_y2 += y * y;
                    sum_xy += x * y;
                }
                _ => {
                    // Ignore pairs where at least one side is non-numeric
                }
            }
        }

        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "PEARSON requires at least two numeric pairs".to_string(),
            );
        }

        // Pearson correlation:
        // r = [ n*Σxy - (Σx)(Σy) ] / sqrt( [n*Σx² - (Σx)²] [n*Σy² - (Σy)²] )
        let num = n * sum_xy - sum_x * sum_y;
        let denom_x = n * sum_x2 - sum_x * sum_x;
        let denom_y = n * sum_y2 - sum_y * sum_y;

        if denom_x.abs() < 1e-15 || denom_y.abs() < 1e-15 {
            // Zero variance in at least one series
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "PEARSON cannot be computed when one series has zero variance".to_string(),
            );
        }

        let denom = (denom_x * denom_y).sqrt();

        CalcResult::Number(num / denom)
    }

    // RSQ(array1, array2) = CORREL(array1, array2)^2
    pub(crate) fn fn_rsq(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_rows, _cols, values1, values2) = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0_f64;
        let mut sum_x = 0.0_f64;
        let mut sum_y = 0.0_f64;
        let mut sum_x2 = 0.0_f64;
        let mut sum_y2 = 0.0_f64;
        let mut sum_xy = 0.0_f64;

        let len = values1.len().min(values2.len());
        for i in 0..len {
            if let (Some(x), Some(y)) = (values1[i], values2[i]) {
                n += 1.0;
                sum_x += x;
                sum_y += y;
                sum_x2 += x * x;
                sum_y2 += y * y;
                sum_xy += x * y;
            }
        }

        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "RSQ requires at least two numeric data points in each range".to_string(),
            );
        }

        let num = n * sum_xy - sum_x * sum_y;
        let denom_x = n * sum_x2 - sum_x * sum_x;
        let denom_y = n * sum_y2 - sum_y * sum_y;
        let denom = (denom_x * denom_y).sqrt();

        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero in RSQ".to_string());
        }

        let r = num / denom;
        CalcResult::Number(r * r)
    }
}
