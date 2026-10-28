use statrs::function::erf::{erf, erfc};

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

use super::transcendental::{bessel_i, bessel_j, bessel_k, bessel_y};
// https://root.cern/doc/v610/TMath_8cxx_source.html

// Notice that the parameters for Bessel functions in Excel and here have inverted order
// EXCEL_BESSEL(x, n) => bessel(n, x)

impl<'a> Model<'a> {
    pub(crate) fn fn_besseli(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = n.trunc() as i32;
        let result = bessel_i(n, x);
        if result.is_infinite() || result.is_nan() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        CalcResult::Number(result)
    }
    pub(crate) fn fn_besselj(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = n.trunc() as i32;
        if n < 0 {
            // In Excel this ins #NUM!
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        let result = bessel_j(n, x);
        if result.is_infinite() || result.is_nan() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_besselk(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = n.trunc() as i32;
        let result = bessel_k(n, x);
        if result.is_infinite() || result.is_nan() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_bessely(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let n = n.trunc() as i32;
        if n < 0 {
            // In Excel this ins #NUM!
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        let result = bessel_y(n, x);
        if result.is_infinite() || result.is_nan() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameter for Bessel function".to_string(),
            };
        }
        CalcResult::Number(result)
    }

    pub(crate) fn fn_erf(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if args.len() == 2 {
            let y = match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => f,
                Err(s) => return s,
            };
            CalcResult::Number(erf(y) - erf(x))
        } else {
            CalcResult::Number(erf(x))
        }
    }

    pub(crate) fn fn_erfprecise(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        };
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        CalcResult::Number(erf(x))
    }

    pub(crate) fn fn_erfc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        };
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        CalcResult::Number(erfc(x))
    }

    pub(crate) fn fn_erfcprecise(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        };
        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        CalcResult::Number(erfc(x))
    }
}
