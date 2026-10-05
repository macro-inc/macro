use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn fn_standardize(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // STANDARDIZE(x, mean, standard_dev)
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let mean = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let std_dev = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        if std_dev <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "standard_dev must be > 0 in STANDARDIZE".to_string(),
            };
        }

        let z = (x - mean) / std_dev;

        CalcResult::Number(z)
    }
}
