use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_expon_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // EXPON.DIST(x, lambda, cumulative)
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let lambda = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[2], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if x < 0.0 || lambda <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for EXPON.DIST".to_string(),
            };
        }

        let result = if cumulative {
            // CDF
            1.0 - (-lambda * x).exp()
        } else {
            // PDF
            lambda * (-lambda * x).exp()
        };

        if result.is_nan() || result.is_infinite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for EXPON.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }
}
