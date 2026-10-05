use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, types::CellReferenceIndex},
    model::Model,
    number_format::to_precision,
};

impl<'a> Model<'a> {
    // DELTA(number1, [number2])
    pub(crate) fn fn_delta(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(1..=2).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let number1 = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(error) => return error,
        };
        let number2 = if arg_count > 1 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => f,
                Err(error) => return error,
            }
        } else {
            0.0
        };

        if to_precision(number1, 16) == to_precision(number2, 16) {
            CalcResult::Number(1.0)
        } else {
            CalcResult::Number(0.0)
        }
    }

    // GESTEP(number, [step])
    pub(crate) fn fn_gestep(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(1..=2).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let number = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(error) => return error,
        };
        let step = if arg_count > 1 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => f,
                Err(error) => return error,
            }
        } else {
            0.0
        };
        if to_precision(number, 16) >= to_precision(step, 16) {
            CalcResult::Number(1.0)
        } else {
            CalcResult::Number(0.0)
        }
    }
}
