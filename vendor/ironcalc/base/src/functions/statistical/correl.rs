use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // CORREL(array1, array2) - Returns the correlation coefficient of two data sets
    pub(crate) fn fn_correl(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_, _, values_left, values_right) = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_y2 = 0.0;
        let mut sum_xy = 0.0;

        for (x_opt, y_opt) in values_left.into_iter().zip(values_right) {
            if let (Some(x), Some(y)) = (x_opt, y_opt) {
                n += 1.0;
                sum_x += x;
                sum_y += y;
                sum_x2 += x * x;
                sum_y2 += y * y;
                sum_xy += x * y;
            }
        }

        // Need at least 2 valid pairs
        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "CORREL requires at least two numeric data points in each range".to_string(),
            );
        }

        let num = n * sum_xy - sum_x * sum_y;
        let denom_x = n * sum_x2 - sum_x * sum_x;
        let denom_y = n * sum_y2 - sum_y * sum_y;
        let denom = (denom_x * denom_y).sqrt();

        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Division by zero in CORREL".to_string(),
            );
        }

        let r = num / denom;
        CalcResult::Number(r)
    }

    // SLOPE(known_y's, known_x's) - Returns the slope of the linear regression line
    pub(crate) fn fn_slope(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_rows, _cols, values_y, values_x) = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_xy = 0.0;

        let len = values_y.len().min(values_x.len());
        for i in 0..len {
            if let (Some(y), Some(x)) = (values_y[i], values_x[i]) {
                n += 1.0;
                sum_x += x;
                sum_y += y;
                sum_x2 += x * x;
                sum_xy += x * y;
            }
        }

        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "SLOPE requires at least two numeric data points".to_string(),
            );
        }

        let denom = n * sum_x2 - sum_x * sum_x;
        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Division by zero in SLOPE".to_string(),
            );
        }

        let num = n * sum_xy - sum_x * sum_y;
        let slope = num / denom;

        CalcResult::Number(slope)
    }

    // INTERCEPT(known_y's, known_x's) - Returns the y-intercept of the linear regression line
    pub(crate) fn fn_intercept(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_rows, _cols, values_y, values_x) = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_xy = 0.0;

        let len = values_y.len().min(values_x.len());
        for i in 0..len {
            if let (Some(y), Some(x)) = (values_y[i], values_x[i]) {
                n += 1.0;
                sum_x += x;
                sum_y += y;
                sum_x2 += x * x;
                sum_xy += x * y;
            }
        }

        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "INTERCEPT requires at least two numeric data points".to_string(),
            );
        }

        let denom = n * sum_x2 - sum_x * sum_x;
        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Division by zero in INTERCEPT".to_string(),
            );
        }

        let num = n * sum_xy - sum_x * sum_y;
        let slope = num / denom;
        let intercept = (sum_y - slope * sum_x) / n;

        CalcResult::Number(intercept)
    }

    // STEYX(known_y's, known_x's) - Returns the standard error of the predicted y-values
    pub(crate) fn fn_steyx(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (_rows, _cols, values_y, values_x) = match self.fn_get_two_matrices(args, cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_xy = 0.0;

        // We need the actual pairs again later for residuals
        let mut pairs: Vec<(f64, f64)> = Vec::new();

        let len = values_y.len().min(values_x.len());
        for i in 0..len {
            if let (Some(y), Some(x)) = (values_y[i], values_x[i]) {
                n += 1.0;
                sum_x += x;
                sum_y += y;
                sum_x2 += x * x;
                sum_xy += x * y;
                pairs.push((x, y));
            }
        }

        // Need at least 3 points for STEYX (n - 2 in denominator)
        if n < 3.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STEYX requires at least three numeric data points".to_string(),
            );
        }

        let denom = n * sum_x2 - sum_x * sum_x;
        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Division by zero in STEYX".to_string(),
            );
        }

        let num = n * sum_xy - sum_x * sum_y;
        let slope = num / denom;
        let intercept = (sum_y - slope * sum_x) / n;

        // Sum of squared residuals: Σ (y - ŷ)^2, ŷ = intercept + slope * x
        let mut sse = 0.0;
        for (x, y) in pairs {
            let y_hat = intercept + slope * x;
            let diff = y - y_hat;
            sse += diff * diff;
        }

        let dof = n - 2.0;
        if dof <= 0.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "STEYX has non-positive degrees of freedom".to_string(),
            );
        }

        let sey = (sse / dof).sqrt();
        if !sey.is_finite() {
            return CalcResult::new_error(Error::DIV, cell, "Numerical error in STEYX".to_string());
        }

        CalcResult::Number(sey)
    }
}
