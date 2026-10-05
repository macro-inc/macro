use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

impl<'a> Model<'a> {
    // ── SERIESSUM ─────────────────────────────────────────────────────────────

    /// `=SERIESSUM(x, n, m, coefficients)`
    ///
    /// Returns the sum of a power series:
    ///   coeff[0]*x^n + coeff[1]*x^(n+m) + coeff[2]*x^(n+2m) + ...
    pub(crate) fn fn_seriessum(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number_no_bools(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if x == 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "SERIESSUM: x=0".to_string());
        }
        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let m = match self.get_number_no_bools(&args[2], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let coeffs = match self.eval_to_array(&args[3], cell) {
            Ok(a) => a,
            Err(e) => return e,
        };

        let mut sum = 0.0f64;
        let mut i = 0u64;
        for row in &coeffs {
            for node in row {
                let coeff = match node {
                    ArrayNode::Number(v) => *v,
                    ArrayNode::Boolean(b) => {
                        if *b {
                            1.0
                        } else {
                            0.0
                        }
                    }
                    ArrayNode::Empty => 0.0,
                    ArrayNode::String(_) => {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "SERIESSUM: coefficients must be numeric".to_string(),
                        )
                    }
                    ArrayNode::Error(e) => {
                        return CalcResult::new_error(
                            e.clone(),
                            cell,
                            "SERIESSUM received an error value".to_string(),
                        )
                    }
                };
                let exponent = n + (i as f64) * m;
                sum += coeff * x.powf(exponent);
                i += 1;
            }
        }

        if !sum.is_finite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "SERIESSUM: result is not finite".to_string(),
            );
        }
        CalcResult::Number(sum)
    }
}
