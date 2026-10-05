use crate::expressions::types::CellReferenceIndex;
use crate::{calc_result::CalcResult, expressions::parser::Node, model::Model};

impl<'a> Model<'a> {
    // PHI(x) = standard normal PDF at x
    pub(crate) fn fn_phi(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // Standard normal PDF: (1 / sqrt(2π)) * exp(-x^2 / 2)
        let result = (-(x * x) / 2.0).exp() / (2.0 * std::f64::consts::PI).sqrt();

        CalcResult::Number(result)
    }
}
