use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // PERMUT(number, number_chosen) = n! / (n-k)! = n*(n-1)*...*(n-k+1)
    pub(crate) fn fn_permut(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let n = match self.get_number(&args[0], cell) {
            Ok(v) => v.floor() as i64,
            Err(e) => return e,
        };

        let k = match self.get_number(&args[1], cell) {
            Ok(v) => v.floor() as i64,
            Err(e) => return e,
        };

        if n < 0 || k < 0 || k > n {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERMUT: requires 0 ≤ k ≤ n".to_string(),
            );
        }

        // n * (n-1) * ... * (n-k+1)
        let result = ((n - k + 1)..=n).map(|i| i as f64).product::<f64>();
        CalcResult::Number(result)
    }

    // PERMUTATIONA(number, number_chosen) = n^k (permutations with repetition)
    pub(crate) fn fn_permutationa(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let n = match self.get_number(&args[0], cell) {
            Ok(v) => v.floor() as i64,
            Err(e) => return e,
        };

        let k = match self.get_number(&args[1], cell) {
            Ok(v) => v.floor() as i64,
            Err(e) => return e,
        };

        if n < 0 || k < 0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERMUTATIONA: requires n ≥ 0 and k ≥ 0".to_string(),
            );
        }

        let result = (n as f64).powf(k as f64);
        CalcResult::Number(result)
    }
}
