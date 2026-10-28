use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_geomean(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<f64> = Vec::new();
        if let Err(e) = self.for_each_value(args, cell, |f| values.push(f)) {
            return e;
        }

        if values.is_empty() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "GEOMEAN requires at least one numeric value".to_string(),
            );
        }

        if values.iter().any(|&v| v <= 0.0) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "GEOMEAN requires all values to be positive".to_string(),
            );
        }

        // Compute via log-sum to avoid overflow for large values
        let n = values.len() as f64;
        let log_sum: f64 = values.iter().map(|v| v.ln()).sum();
        CalcResult::Number((log_sum / n).exp())
    }
}
