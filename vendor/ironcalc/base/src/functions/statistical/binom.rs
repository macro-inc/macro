use statrs::distribution::{Binomial, Discrete, DiscreteCDF};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_binom_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        // number_s
        let number_s = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // trials
        let trials = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // probability_s
        let p = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // cumulative (logical)
        let cumulative = match self.get_boolean(&args[3], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        // Domain checks
        if trials < 0.0
            || number_s < 0.0
            || number_s > trials
            || p.is_nan()
            || !(0.0..=1.0).contains(&p)
        {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid parameters for BINOM.DIST".to_string(),
            );
        }

        // Limit to u64
        if trials > u64::MAX as f64 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Number of trials too large".to_string(),
            );
        }

        let n = trials as u64;
        let k = number_s as u64;

        let dist = match Binomial::new(p, n) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for binomial distribution".to_string(),
                )
            }
        };

        let prob = if cumulative { dist.cdf(k) } else { dist.pmf(k) };

        if prob.is_nan() || prob.is_infinite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid result for BINOM.DIST".to_string(),
            );
        }

        CalcResult::Number(prob)
    }

    pub(crate) fn fn_binom_dist_range(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() < 3 || args.len() > 4 {
            return CalcResult::new_args_number_error(cell);
        }

        // trials
        let trials = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // probability_s
        let p = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // number_s (lower)
        let number_s = match self.get_number(&args[2], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // number_s2 (upper, optional)
        let number_s2 = if args.len() == 4 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f.trunc(),
                Err(e) => return e,
            }
        } else {
            number_s
        };

        if trials < 0.0
            || number_s < 0.0
            || number_s2 < 0.0
            || number_s > number_s2
            || number_s2 > trials
            || p.is_nan()
            || !(0.0..=1.0).contains(&p)
        {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid parameters for BINOM.DIST.RANGE".to_string(),
            );
        }

        if trials > u64::MAX as f64 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Number of trials too large".to_string(),
            );
        }

        let n = trials as u64;
        let lower = number_s as u64;
        let upper = number_s2 as u64;

        let dist = match Binomial::new(p, n) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for binomial distribution".to_string(),
                )
            }
        };

        let prob = if lower == 0 {
            dist.cdf(upper)
        } else {
            let cdf_upper = dist.cdf(upper);
            let cdf_below_lower = dist.cdf(lower - 1);
            cdf_upper - cdf_below_lower
        };

        if prob.is_nan() || prob.is_infinite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid result for BINOM.DIST.RANGE".to_string(),
            );
        }

        CalcResult::Number(prob)
    }

    pub(crate) fn fn_binom_inv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        // trials
        let trials = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // probability_s
        let p = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // alpha
        let alpha = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        if trials < 0.0
            || trials > u64::MAX as f64
            || p.is_nan()
            || !(0.0..1.0).contains(&p)
            || alpha.is_nan()
            || alpha <= 0.0
            || alpha >= 1.0
        {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Invalid parameters for BINOM.INV".to_string(),
            );
        }

        let n = trials as u64;

        let dist = match Binomial::new(p, n) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for binomial distribution".to_string(),
                )
            }
        };

        // Smallest k with CDF(k) >= alpha. statrs' generic `inverse_cdf` can panic
        // (an unwrap inside its bisection), e.g. for BINOM.INV(1, 0.001, 0.1).
        let (mut lo, mut hi) = (0u64, n);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if statrs::distribution::DiscreteCDF::cdf(&dist, mid) >= alpha {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }

        CalcResult::Number(lo as f64)
    }

    pub(crate) fn fn_negbinom_dist(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        use statrs::distribution::{Discrete, DiscreteCDF, NegativeBinomial};

        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let number_f = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };
        let number_s = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };
        let probability_s = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let cumulative = match self.get_boolean(&args[3], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if number_f < 0.0 || number_s < 1.0 || probability_s <= 0.0 || probability_s >= 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for NEGBINOM.DIST".to_string(),
            };
        }

        // Guard against absurdly large failures that won't fit in u64
        if number_f > (u64::MAX as f64) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for NEGBINOM.DIST".to_string(),
            };
        }

        let dist = match NegativeBinomial::new(number_s, probability_s) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameter for NEGBINOM.DIST".to_string(),
                }
            }
        };

        let f_u = number_f as u64;
        let result = if cumulative {
            dist.cdf(f_u)
        } else {
            dist.pmf(f_u)
        };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for NEGBINOM.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // NEGBINOMDIST(number_f, number_s, probability_s) — always PMF (cumulative=FALSE), 3 args
    pub(crate) fn fn_negbinomdist_compat(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let mut new_args = args.to_vec();
        new_args.push(Node::BooleanKind(false));
        self.fn_negbinom_dist(&new_args, cell)
    }
}
