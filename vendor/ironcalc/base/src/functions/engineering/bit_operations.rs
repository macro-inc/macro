use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

// 2^48-1
const MAX: f64 = 281474976710655.0;

impl<'a> Model<'a> {
    // BITAND( number1, number2)
    pub(crate) fn fn_bitand(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number1 = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let number2 = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if number1.trunc() != number1 || number2.trunc() != number2 {
            return CalcResult::new_error(Error::NUM, cell, "numbers must be integers".to_string());
        }
        if number1 < 0.0 || number2 < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be positive or zero".to_string(),
            );
        }

        if number1 > MAX || number2 > MAX {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be less than 2^48-1".to_string(),
            );
        }

        let number1 = number1.trunc() as i64;
        let number2 = number2.trunc() as i64;
        let result = number1 & number2;
        CalcResult::Number(result as f64)
    }

    // BITOR(number1, number2)
    pub(crate) fn fn_bitor(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number1 = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let number2 = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if number1.trunc() != number1 || number2.trunc() != number2 {
            return CalcResult::new_error(Error::NUM, cell, "numbers must be integers".to_string());
        }
        if number1 < 0.0 || number2 < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be positive or zero".to_string(),
            );
        }

        if number1 > MAX || number2 > MAX {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be less than 2^48-1".to_string(),
            );
        }

        let number1 = number1.trunc() as i64;
        let number2 = number2.trunc() as i64;
        let result = number1 | number2;
        CalcResult::Number(result as f64)
    }

    // BITXOR(number1, number2)
    pub(crate) fn fn_bitxor(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number1 = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let number2 = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if number1.trunc() != number1 || number2.trunc() != number2 {
            return CalcResult::new_error(Error::NUM, cell, "numbers must be integers".to_string());
        }
        if number1 < 0.0 || number2 < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be positive or zero".to_string(),
            );
        }

        if number1 > MAX || number2 > MAX {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be less than 2^48-1".to_string(),
            );
        }

        let number1 = number1.trunc() as i64;
        let number2 = number2.trunc() as i64;
        let result = number1 ^ number2;
        CalcResult::Number(result as f64)
    }

    // BITLSHIFT(number, shift_amount)
    pub(crate) fn fn_bitlshift(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let shift = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if number.trunc() != number {
            return CalcResult::new_error(Error::NUM, cell, "numbers must be integers".to_string());
        }
        if number < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be positive or zero".to_string(),
            );
        }

        if number > MAX {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be less than 2^48-1".to_string(),
            );
        }

        if shift.abs() > 53.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "shift amount must be less than 53".to_string(),
            );
        }

        let number = number.trunc() as i64;
        let shift = shift.trunc() as i64;
        let result = if shift > 0 {
            number << shift
        } else {
            number >> -shift
        };
        let result = result as f64;
        if result.abs() > MAX {
            return CalcResult::new_error(Error::NUM, cell, "BITLSHIFT overflow".to_string());
        }
        CalcResult::Number(result)
    }

    // BITRSHIFT(number, shift_amount)
    pub(crate) fn fn_bitrshift(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let shift = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if number.trunc() != number {
            return CalcResult::new_error(Error::NUM, cell, "numbers must be integers".to_string());
        }
        if number < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be positive or zero".to_string(),
            );
        }

        if number > MAX {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "numbers must be less than 2^48-1".to_string(),
            );
        }

        if shift.abs() > 53.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "shift amount must be less than 53".to_string(),
            );
        }

        let number = number.trunc() as i64;
        let shift = shift.trunc() as i64;
        let result = if shift > 0 {
            number >> shift
        } else {
            number << -shift
        };
        let result = result as f64;
        if result.abs() > MAX {
            return CalcResult::new_error(Error::NUM, cell, "BITRSHIFT overflow".to_string());
        }
        CalcResult::Number(result)
    }
}
