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
    // ── TOCOL ─────────────────────────────────────────────────────────────────

    /// `=TOCOL(array, [ignore], [scan_by_col])`
    ///
    /// Flattens an array into a single column.
    ///   * ignore: 0=keep all (default), 1=ignore blanks, 2=ignore errors, 3=ignore both
    ///   * scan_by_col: FALSE=row-by-row (default), TRUE=column-by-column
    pub(crate) fn fn_tocol(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        match self.flatten_array_impl(args, cell) {
            Ok(flat) => CalcResult::Array(flat.into_iter().map(|v| vec![v]).collect()),
            Err(e) => e,
        }
    }

    // ── TOROW ─────────────────────────────────────────────────────────────────

    /// `=TOROW(array, [ignore], [scan_by_col])`
    ///
    /// Flattens an array into a single row.
    ///   * ignore: 0=keep all (default), 1=ignore blanks, 2=ignore errors, 3=ignore both
    ///   * scan_by_col: FALSE=row-by-row (default), TRUE=column-by-column
    pub(crate) fn fn_torow(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        match self.flatten_array_impl(args, cell) {
            Ok(flat) => CalcResult::Array(vec![flat]),
            Err(e) => e,
        }
    }

    fn flatten_array_impl(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Result<Vec<ArrayNode>, CalcResult> {
        if args.is_empty() || args.len() > 3 {
            return Err(CalcResult::new_args_number_error(cell));
        }

        let data = self.eval_to_array(&args[0], cell)?;

        let ignore: u8 = if args.len() >= 2 {
            {
                let n = self.get_number(&args[1], cell)?;
                let n = n as i64;
                if !(0..=3).contains(&n) {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "ignore must be 0, 1, 2, or 3".to_string(),
                    ));
                }
                n as u8
            }
        } else {
            0
        };

        let scan_by_col: bool = if args.len() >= 3 {
            self.get_boolean(&args[2], cell)?
        } else {
            false
        };

        let num_rows = data.len();
        let num_cols = if num_rows > 0 { data[0].len() } else { 0 };

        let mut flat: Vec<ArrayNode> = Vec::with_capacity(num_rows * num_cols);

        if scan_by_col {
            for j in 0..num_cols {
                for row in &data {
                    flat.push(row[j].clone());
                }
            }
        } else {
            for row in &data {
                for val in row {
                    flat.push(val.clone());
                }
            }
        }

        let result: Vec<ArrayNode> = flat
            .into_iter()
            .filter(|node| {
                let is_blank = matches!(node, ArrayNode::Empty);
                let is_error = matches!(node, ArrayNode::Error(_));
                match ignore {
                    1 => !is_blank,
                    2 => !is_error,
                    3 => !is_blank && !is_error,
                    _ => true,
                }
            })
            .collect();

        if result.is_empty() {
            return Err(CalcResult::new_error(
                Error::CALC,
                cell,
                "TOCOL/TOROW returned empty array".to_string(),
            ));
        }

        Ok(result)
    }
}
