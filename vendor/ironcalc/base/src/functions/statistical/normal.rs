use statrs::distribution::{Continuous, ContinuousCDF, Normal, StudentsT};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // NORM.DIST(x, mean, standard_dev, cumulative)
    pub(crate) fn fn_norm_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
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

        // Excel: standard_dev must be > 0
        if std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "standard_dev must be > 0 in NORM.DIST".to_string(),
            };
        }

        let dist = match Normal::new(mean, std_dev) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for NORM.DIST".to_string(),
                }
            }
        };

        let result = if cumulative { dist.cdf(x) } else { dist.pdf(x) };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for NORM.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // NORM.INV(probability, mean, standard_dev)
    pub(crate) fn fn_norm_inv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
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

        if p <= 0.0 || p >= 1.0 || std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for NORM.INV".to_string(),
            };
        }

        let dist = match Normal::new(mean, std_dev) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for NORM.INV".to_string(),
                }
            }
        };

        let x = dist.inverse_cdf(p);

        if !x.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for NORM.INV".to_string(),
            };
        }

        CalcResult::Number(x)
    }

    // NORM.S.DIST(z, cumulative)
    pub(crate) fn fn_norm_s_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let z = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let cumulative = match self.get_boolean(&args[1], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        let dist = match Normal::new(0.0, 1.0) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::ERROR,
                    origin: cell,
                    message: "Failed to construct standard normal distribution".to_string(),
                }
            }
        };

        let result = if cumulative { dist.cdf(z) } else { dist.pdf(z) };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for NORM.S.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // NORM.S.INV(probability)
    pub(crate) fn fn_norm_s_inv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }

        let p = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        if p <= 0.0 || p >= 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "probability must be in (0,1) in NORM.S.INV".to_string(),
            };
        }

        let dist = match Normal::new(0.0, 1.0) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::ERROR,
                    origin: cell,
                    message: "Failed to construct standard normal distribution".to_string(),
                }
            }
        };

        let z = dist.inverse_cdf(p);

        if !z.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for NORM.S.INV".to_string(),
            };
        }

        CalcResult::Number(z)
    }

    pub(crate) fn fn_confidence_norm(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let alpha = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let std_dev = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let size = match self.get_number(&args[2], cell) {
            Ok(f) => f.floor(),
            Err(e) => return e,
        };

        if alpha <= 0.0 || alpha >= 1.0 || std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for CONFIDENCE.NORM".to_string(),
            };
        }
        if size < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Sample size must be at least 1".to_string(),
            };
        }

        let normal = match Normal::new(0.0, 1.0) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::ERROR,
                    cell,
                    "Failed to construct normal distribution".to_string(),
                )
            }
        };

        let quantile = normal.inverse_cdf(1.0 - alpha / 2.0);
        if !quantile.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid quantile for CONFIDENCE.NORM".to_string(),
            };
        }

        let margin = quantile * std_dev / size.sqrt();
        CalcResult::Number(margin)
    }

    pub(crate) fn fn_confidence_t(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let alpha = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let std_dev = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let size = match self.get_number(&args[2], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // Domain checks
        if alpha <= 0.0 || alpha >= 1.0 || std_dev <= 0.0 || size <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for CONFIDENCE.T".to_string(),
            };
        }

        // Need at least 2 observations so df = n - 1 > 0
        if size < 2.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Sample size must be at least 2".to_string(),
            };
        }

        let df = size - 1.0;

        let t_dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::ERROR,
                    cell,
                    "Failed to construct Student's t distribution".to_string(),
                )
            }
        };

        // Two-sided CI => use 1 - alpha/2
        let t_crit = t_dist.inverse_cdf(1.0 - alpha / 2.0);
        if !t_crit.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid quantile for CONFIDENCE.T".to_string(),
            };
        }

        let margin = t_crit * std_dev / size.sqrt();
        CalcResult::Number(margin)
    }

    // NORMSDIST(z) — always cumulative=TRUE, 1 arg
    pub(crate) fn fn_normsdist_compat(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let new_args = vec![args[0].clone(), Node::BooleanKind(true)];
        self.fn_norm_s_dist(&new_args, cell)
    }
}
