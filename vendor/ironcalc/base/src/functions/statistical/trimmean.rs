use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // TRIMMEAN(array, percent)
    // Returns the mean of the interior of a data set, after removing percent/2 from each tail.
    pub(crate) fn fn_trimmean(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values = match self.collect_numeric_flat(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if values.is_empty() {
            return CalcResult::new_error(Error::NUM, cell, "TRIMMEAN: empty array".to_string());
        }

        let percent = match self.get_number(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if !(0.0..1.0).contains(&percent) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "TRIMMEAN: percent must be in [0, 1)".to_string(),
            );
        }

        let n = values.len();
        // Number of values to remove from each end (floored)
        let trim = (n as f64 * percent / 2.0).floor() as usize;

        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let trimmed = &values[trim..n - trim];

        if trimmed.is_empty() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "TRIMMEAN: all values trimmed".to_string(),
            );
        }

        let mean = trimmed.iter().sum::<f64>() / trimmed.len() as f64;
        CalcResult::Number(mean)
    }
}
