use statrs::distribution::{Continuous, ContinuousCDF, Weibull};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // WEIBULL.DIST(x, alpha, beta, cumulative)
    pub(crate) fn fn_weibull_dist(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let alpha = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let beta = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[3], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for WEIBULL.DIST".to_string(),
            };
        }

        // statrs::Weibull: shape = k (alpha), scale = lambda (beta)
        let dist = match Weibull::new(alpha, beta) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for WEIBULL.DIST".to_string(),
                }
            }
        };

        let result = if cumulative { dist.cdf(x) } else { dist.pdf(x) };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for WEIBULL.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }
}
