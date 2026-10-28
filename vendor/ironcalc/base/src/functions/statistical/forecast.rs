use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // FORECAST(x, known_y's, known_x's) / FORECAST.LINEAR(x, known_y's, known_x's)
    // Returns the predicted y value for a given x using simple linear regression.
    fn fn_forecast_linear_impl(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let (_, _, values_y, values_x) = match self.fn_get_two_matrices(&args[1..], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let mut n = 0.0_f64;
        let mut sum_x = 0.0_f64;
        let mut sum_y = 0.0_f64;
        let mut sum_x2 = 0.0_f64;
        let mut sum_xy = 0.0_f64;

        let len = values_y.len().min(values_x.len());
        for i in 0..len {
            if let (Some(y), Some(xi)) = (values_y[i], values_x[i]) {
                n += 1.0;
                sum_x += xi;
                sum_y += y;
                sum_x2 += xi * xi;
                sum_xy += xi * y;
            }
        }

        if n < 2.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "FORECAST requires at least two numeric data points".to_string(),
            );
        }

        let denom = n * sum_x2 - sum_x * sum_x;
        if denom == 0.0 || !denom.is_finite() {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Division by zero in FORECAST: all x values are equal".to_string(),
            );
        }

        let slope = (n * sum_xy - sum_x * sum_y) / denom;
        let intercept = (sum_y - slope * sum_x) / n;
        let result = intercept + slope * x;

        if !result.is_finite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Numerical error in FORECAST".to_string(),
            );
        }

        CalcResult::Number(result)
    }

    pub(crate) fn fn_forecast(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.fn_forecast_linear_impl(args, cell)
    }

    pub(crate) fn fn_forecast_linear(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        self.fn_forecast_linear_impl(args, cell)
    }

    // The FORECAST.ETS family (exponential triple smoothing) is recognized but
    // not yet implemented; it returns the #N/IMPL! error.
    pub(crate) fn fn_forecast_ets(
        &mut self,
        _args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        CalcResult::new_error(
            Error::NIMPL,
            cell,
            "FORECAST.ETS not implemented".to_string(),
        )
    }

    pub(crate) fn fn_forecast_ets_confint(
        &mut self,
        _args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        CalcResult::new_error(
            Error::NIMPL,
            cell,
            "FORECAST.ETS.CONFINT not implemented".to_string(),
        )
    }

    pub(crate) fn fn_forecast_ets_seasonality(
        &mut self,
        _args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        CalcResult::new_error(
            Error::NIMPL,
            cell,
            "FORECAST.ETS.SEASONALITY not implemented".to_string(),
        )
    }

    pub(crate) fn fn_forecast_ets_stat(
        &mut self,
        _args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        CalcResult::new_error(
            Error::NIMPL,
            cell,
            "FORECAST.ETS.STAT not implemented".to_string(),
        )
    }
}
