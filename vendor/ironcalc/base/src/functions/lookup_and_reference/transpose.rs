use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        types::CellReferenceIndex,
    },
    model::Model,
};

impl<'a> Model<'a> {
    // ── TRANSPOSE ─────────────────────────────────────────────────────────────

    /// `=TRANSPOSE(array)`
    ///
    /// Returns the transpose of the array: rows become columns and vice versa.
    pub(crate) fn fn_transpose(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();
        let num_cols = data[0].len();

        let result: Vec<Vec<ArrayNode>> = (0..num_cols)
            .map(|j| (0..num_rows).map(|i| data[i][j].clone()).collect())
            .collect();

        CalcResult::Array(result)
    }
}
