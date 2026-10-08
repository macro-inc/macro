use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // PROB(x_range, prob_range, lower_limit, [upper_limit])
    // Returns the probability that values in x_range fall between lower_limit and upper_limit.
    pub(crate) fn fn_prob(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(3..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        // Collect x values
        let x_vals = match self.collect_numeric_flat(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        // Collect probability values
        let prob_vals = match self.collect_numeric_flat(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if x_vals.len() != prob_vals.len() {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "PROB: x_range and prob_range must have the same size".to_string(),
            );
        }

        if x_vals.is_empty() {
            return CalcResult::new_error(Error::DIV, cell, "PROB: empty ranges".to_string());
        }

        // Validate probabilities: each in (0, 1] (sum must = 1)
        let prob_sum: f64 = prob_vals.iter().sum();
        for &p in &prob_vals {
            if !(0.0..=1.0).contains(&p) {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "PROB: all probabilities must be between 0 and 1".to_string(),
                );
            }
        }
        // Allow a small tolerance for floating-point imprecision
        if (prob_sum - 1.0).abs() > 1e-14 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PROB: probabilities must sum to 1".to_string(),
            );
        }

        let lower = match self.get_number(&args[2], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let upper = if args.len() == 4 {
            match self.get_number(&args[3], cell) {
                Ok(v) => v,
                Err(e) => return e,
            }
        } else {
            lower
        };

        if lower > upper {
            return CalcResult::Number(0.0);
        }

        let result = x_vals
            .iter()
            .zip(prob_vals.iter())
            .filter(|(&x, _)| x >= lower && x <= upper)
            .map(|(_, &p)| p)
            .sum();

        CalcResult::Number(result)
    }

    pub(crate) fn collect_numeric_flat(
        &mut self,
        arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        match self.evaluate_node_in_context(arg, cell) {
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => Ok(v.into_iter().flatten().collect()),
                Err(e) => Err(e),
            },
            CalcResult::Array(arr) => match self.values_from_array(arr) {
                Ok(v) => Ok(v.into_iter().flatten().collect()),
                Err(e) => Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    format!("{:?}", e),
                )),
            },
            CalcResult::Number(n) => Ok(vec![n]),
            _ => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expected numeric range".to_string(),
            )),
        }
    }
}
