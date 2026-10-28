use statrs::distribution::{Continuous, ContinuousCDF, Gamma};
use statrs::function::gamma::{gamma, ln_gamma};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_gamma(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if x < 0.0 && x.floor() == x {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Gamma function".to_string(),
            };
        }
        let result = gamma(x);
        if result.is_nan() || result.is_infinite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Gamma function".to_string(),
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_gamma_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // GAMMA.DIST(x, alpha, beta, cumulative)
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let alpha = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let beta_scale = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[3], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if x < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "x must be >= 0 in GAMMA.DIST".to_string(),
            );
        }
        if alpha <= 0.0 || beta_scale <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "alpha and beta must be > 0 in GAMMA.DIST".to_string(),
            );
        }

        let rate = 1.0 / beta_scale;

        let dist = match Gamma::new(alpha, rate) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for Gamma distribution".to_string(),
                )
            }
        };

        let result = if cumulative { dist.cdf(x) } else { dist.pdf(x) };

        if result.is_nan() || result.is_infinite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid result for GAMMA.DIST".to_string(),
            );
        }

        CalcResult::Number(result)
    }

    pub(crate) fn fn_gamma_inv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // GAMMA.INV(probability, alpha, beta)
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let p = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let alpha = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let beta_scale = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        if !(0.0..=1.0).contains(&p) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "probability must be in [0,1] in GAMMA.INV".to_string(),
            );
        }

        if alpha <= 0.0 || beta_scale <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "alpha and beta must be > 0 in GAMMA.INV".to_string(),
            );
        }

        let rate = 1.0 / beta_scale;

        let dist = match Gamma::new(alpha, rate) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for Gamma distribution".to_string(),
                )
            }
        };

        let x = dist.inverse_cdf(p);
        if x.is_nan() || x.is_infinite() || x < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid result for GAMMA.INV".to_string(),
            );
        }

        CalcResult::Number(x)
    }

    pub(crate) fn fn_gamma_ln(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if x < 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Gamma function".to_string(),
            };
        }
        let result = ln_gamma(x);
        if result.is_nan() || result.is_infinite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Gamma Ln function".to_string(),
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_gamma_ln_precise(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        self.fn_gamma_ln(args, cell)
    }
}
