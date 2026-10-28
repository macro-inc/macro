use statrs::distribution::{Discrete, DiscreteCDF, Hypergeometric};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // =HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, cumulative)
    pub(crate) fn fn_hyp_geom_dist(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 5 {
            return CalcResult::new_args_number_error(cell);
        }

        // sample_s (number of successes in the sample)
        let sample_s = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // number_sample (sample size)
        let number_sample = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // population_s (number of successes in the population)
        let population_s = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        // number_pop (population size)
        let number_pop = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[4], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if sample_s < 0.0 || sample_s > f64::min(number_sample, population_s) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for HYPGEOM.DIST".to_string(),
            };
        }

        if sample_s < f64::max(0.0, number_sample + population_s - number_pop) {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for HYPGEOM.DIST".to_string(),
            };
        }

        if number_sample <= 0.0 || number_sample > number_pop {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for HYPGEOM.DIST".to_string(),
            };
        }

        if population_s <= 0.0 || population_s > number_pop {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for HYPGEOM.DIST".to_string(),
            };
        }

        let n_pop = number_pop as u64;
        let k_pop = population_s as u64;
        let n_sample = number_sample as u64;
        let k = sample_s as u64;

        let dist = match Hypergeometric::new(n_pop, k_pop, n_sample) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for hypergeometric distribution".to_string(),
                )
            }
        };

        let prob = if cumulative { dist.cdf(k) } else { dist.pmf(k) };

        if !prob.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for HYPGEOM.DIST".to_string(),
            };
        }

        CalcResult::Number(prob)
    }

    // HYPGEOMDIST(sample_s, number_sample, population_s, number_pop) — always PMF (cumulative=FALSE)
    pub(crate) fn fn_hypgeomdist_compat(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }
        let mut new_args = args.to_vec();
        new_args.push(Node::BooleanKind(false));
        self.fn_hyp_geom_dist(&new_args, cell)
    }
}
