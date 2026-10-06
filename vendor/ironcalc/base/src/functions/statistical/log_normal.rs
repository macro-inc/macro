use statrs::distribution::{Continuous, ContinuousCDF, LogNormal};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_log_norm_dist(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let mean = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let std_dev = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let cumulative = match self.get_boolean(&args[3], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        // Excel domain checks
        if x <= 0.0 || std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for LOGNORM.DIST".to_string(),
            };
        }

        let dist = match LogNormal::new(mean, std_dev) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameter for LOGNORM.DIST".to_string(),
                }
            }
        };

        let result = if cumulative { dist.cdf(x) } else { dist.pdf(x) };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for LOGNORM.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    pub(crate) fn fn_log_norm_inv(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        use statrs::distribution::{ContinuousCDF, LogNormal};

        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let p = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let mean = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let std_dev = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // Excel domain checks
        if p <= 0.0 || p >= 1.0 || std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for LOGNORM.INV".to_string(),
            };
        }

        let dist = match LogNormal::new(mean, std_dev) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameter for LOGNORM.INV".to_string(),
                }
            }
        };

        let result = dist.inverse_cdf(p);

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for LOGNORM.INV".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // LOGNORMDIST(x, mean, standard_dev) — always cumulative=TRUE, 3 args
    pub(crate) fn fn_lognormdist_compat(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let mut new_args = args.to_vec();
        new_args.push(Node::BooleanKind(true));
        self.fn_log_norm_dist(&new_args, cell)
    }
}
