use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

impl<'a> Model<'a> {
    // ── CHOOSECOLS ────────────────────────────────────────────────────────────

    /// `=CHOOSECOLS(array, col_num1, [col_num2], ...)`
    ///
    /// Returns the specified columns from an array or range.
    /// Column numbers are 1-based; negative numbers select from the right.
    pub(crate) fn fn_choosecols(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_cols = data[0].len() as i64;

        let mut col_indices: Vec<usize> = Vec::with_capacity(args.len() - 1);
        for arg in &args[1..] {
            let n = match self.get_number(arg, cell) {
                Ok(n) => n as i64,
                Err(e) => return e,
            };
            if n == 0 || n.abs() > num_cols {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Column number out of range".to_string(),
                );
            }
            let idx = if n > 0 {
                (n - 1) as usize
            } else {
                (num_cols + n) as usize
            };
            col_indices.push(idx);
        }

        let result = data
            .iter()
            .map(|row| col_indices.iter().map(|&c| row[c].clone()).collect())
            .collect();

        CalcResult::Array(result)
    }

    // ── CHOOSEROWS ────────────────────────────────────────────────────────────

    /// `=CHOOSEROWS(array, row_num1, [row_num2], ...)`
    ///
    /// Returns the specified rows from an array or range.
    /// Row numbers are 1-based; negative numbers select from the bottom.
    pub(crate) fn fn_chooserows(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() {
            return CalcResult::Array(vec![]);
        }

        let num_rows = data.len() as i64;

        let mut result = Vec::with_capacity(args.len() - 1);
        for arg in &args[1..] {
            let n = match self.get_number(arg, cell) {
                Ok(n) => n as i64,
                Err(e) => return e,
            };
            if n == 0 || n.abs() > num_rows {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Row number out of range".to_string(),
                );
            }
            let idx = if n > 0 {
                (n - 1) as usize
            } else {
                (num_rows + n) as usize
            };
            result.push(data[idx].clone());
        }

        CalcResult::Array(result)
    }
}
