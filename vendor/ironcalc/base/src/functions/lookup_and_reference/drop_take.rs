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
    // ── TAKE ──────────────────────────────────────────────────────────────────

    /// `=TAKE(array, rows, [cols])`
    ///
    /// Returns the first (or last, when negative) N rows and/or M columns.
    ///   * rows > 0 → take from the top;  rows < 0 → take from the bottom
    ///   * cols > 0 → take from the left; cols < 0 → take from the right
    ///   * If |rows| or |cols| exceeds the array size, all rows/cols are returned.
    pub(crate) fn fn_take(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();
        let num_cols = data[0].len();

        let rows_arg = match self.get_number(&args[1], cell) {
            Ok(n) => n as i64,
            Err(e) => return e,
        };
        if rows_arg == 0 {
            return CalcResult::new_error(Error::CALC, cell, "rows cannot be 0".to_string());
        }

        let row_range = if rows_arg > 0 {
            let take = (rows_arg as usize).min(num_rows);
            0..take
        } else {
            let take = ((-rows_arg) as usize).min(num_rows);
            (num_rows - take)..num_rows
        };

        let col_range = if args.len() == 3 {
            let cols_arg = match self.get_number(&args[2], cell) {
                Ok(n) => n as i64,
                Err(e) => return e,
            };
            if cols_arg == 0 {
                return CalcResult::new_error(Error::CALC, cell, "cols cannot be 0".to_string());
            }
            if cols_arg > 0 {
                let take = (cols_arg as usize).min(num_cols);
                0..take
            } else {
                let take = ((-cols_arg) as usize).min(num_cols);
                (num_cols - take)..num_cols
            }
        } else {
            0..num_cols
        };

        let result: Vec<Vec<ArrayNode>> = data[row_range]
            .iter()
            .map(|row| row[col_range.clone()].to_vec())
            .collect();

        CalcResult::Array(result)
    }

    // ── DROP ──────────────────────────────────────────────────────────────────

    /// `=DROP(array, rows, [cols])`
    ///
    /// Returns the array with the first (or last, when negative) N rows and/or M columns removed.
    ///   * rows > 0 → drop from the top;  rows < 0 → drop from the bottom
    ///   * cols > 0 → drop from the left; cols < 0 → drop from the right
    pub(crate) fn fn_drop(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len();
        let num_cols = data[0].len();

        let rows_arg = match self.get_number(&args[1], cell) {
            Ok(n) => n as i64,
            Err(e) => return e,
        };

        let row_range = if rows_arg >= 0 {
            let drop = (rows_arg as usize).min(num_rows);
            drop..num_rows
        } else {
            let drop = ((-rows_arg) as usize).min(num_rows);
            0..(num_rows - drop)
        };

        let col_range = if args.len() == 3 {
            let cols_arg = match self.get_number(&args[2], cell) {
                Ok(n) => n as i64,
                Err(e) => return e,
            };
            if cols_arg >= 0 {
                let drop = (cols_arg as usize).min(num_cols);
                drop..num_cols
            } else {
                let drop = ((-cols_arg) as usize).min(num_cols);
                0..(num_cols - drop)
            }
        } else {
            0..num_cols
        };

        if row_range.is_empty() || col_range.is_empty() {
            return CalcResult::new_error(
                Error::CALC,
                cell,
                "DROP returned empty array".to_string(),
            );
        }

        let result: Vec<Vec<ArrayNode>> = data[row_range]
            .iter()
            .map(|row| row[col_range.clone()].to_vec())
            .collect();

        CalcResult::Array(result)
    }
}
