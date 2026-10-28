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
    // ── SUMPRODUCT ────────────────────────────────────────────────────────────

    /// `=SUMPRODUCT(array1, [array2], ...)`
    ///
    /// Multiplies corresponding elements across all arrays and returns the sum.
    /// Non-numeric values (text, booleans, empty) are treated as 0.
    /// All arrays must have the same dimensions; a mismatch yields `#VALUE!`.
    pub(crate) fn fn_sumproduct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        // Evaluate all arrays up front.
        let mut arrays: Vec<Vec<Vec<f64>>> = Vec::with_capacity(args.len());
        let mut ref_rows: Option<usize> = None;
        let mut ref_cols: Option<usize> = None;

        for arg in args {
            let arr = match self.eval_to_array(arg, cell) {
                Ok(a) => a,
                Err(e) => return e,
            };
            let rows = arr.len();
            let cols = if rows == 0 { 0 } else { arr[0].len() };

            if let Some(r) = ref_rows {
                if rows != r || cols != ref_cols.unwrap_or(0) {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "SUMPRODUCT: arrays must have the same dimensions".to_string(),
                    );
                }
            } else {
                ref_rows = Some(rows);
                ref_cols = Some(cols);
            }

            // Coerce to f64: non-numeric → 0.0, errors propagate.
            let mut num_arr: Vec<Vec<f64>> = Vec::with_capacity(rows);
            for row in &arr {
                let mut num_row: Vec<f64> = Vec::with_capacity(row.len());
                for node in row {
                    let v = match node {
                        ArrayNode::Number(v) => *v,
                        ArrayNode::Boolean(_) | ArrayNode::String(_) | ArrayNode::Empty => 0.0,
                        ArrayNode::Error(e) => {
                            return CalcResult::Error {
                                error: e.clone(),
                                origin: cell,
                                message: String::new(),
                            }
                        }
                    };
                    num_row.push(v);
                }
                num_arr.push(num_row);
            }
            arrays.push(num_arr);
        }

        let rows = ref_rows.unwrap_or(0);
        let cols = ref_cols.unwrap_or(0);
        let mut total = 0.0f64;

        for i in 0..rows {
            for j in 0..cols {
                let product = arrays.iter().map(|a| a[i][j]).product::<f64>();
                total += product;
            }
        }

        CalcResult::Number(total)
    }
}
