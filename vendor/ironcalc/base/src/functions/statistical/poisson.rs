use statrs::distribution::{Discrete, DiscreteCDF, Poisson};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // =POISSON.DIST(x, mean, cumulative)
    pub(crate) fn fn_poisson_dist(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        // x
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // mean (lambda)
        let lambda = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[2], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if x < 0.0 || lambda < 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for POISSON.DIST".to_string(),
            };
        }

        // Guard against large x
        if x > (u64::MAX as f64) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "x is too large for POISSON.DIST".to_string(),
            };
        }

        let k = x.trunc() as u64;

        // Special-case lambda = 0: degenerate distribution at 0
        if lambda == 0.0 {
            let result = if cumulative {
                // For x >= 0, P(X <= x) = 1
                1.0
            } else {
                // P(X = 0) = 1, P(X = k>0) = 0
                if k == 0 {
                    1.0
                } else {
                    0.0
                }
            };
            return CalcResult::Number(result);
        }

        let dist = match Poisson::new(lambda) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for POISSON.DIST".to_string(),
                }
            }
        };

        let prob = if cumulative { dist.cdf(k) } else { dist.pmf(k) };

        if !prob.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for POISSON.DIST".to_string(),
            };
        }

        CalcResult::Number(prob)
    }
}
