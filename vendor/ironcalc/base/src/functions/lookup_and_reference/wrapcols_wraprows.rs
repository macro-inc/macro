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
    // ── WRAPCOLS ──────────────────────────────────────────────────────────────

    /// `=WRAPCOLS(vector, wrap_count, [pad_with])`
    ///
    /// Wraps the provided row or column vector by columns after a specified
    /// number of values. The vector is read top-to-bottom then left-to-right.
    ///   * wrap_count – number of values per column (must be >= 1)
    ///   * pad_with   – value used to pad the last column; defaults to #N/A
    pub(crate) fn fn_wrapcols(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let flat = match self.flatten_vector(args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let wrap_count = match self.get_number(&args[1], cell) {
            Ok(n) => n as usize,
            Err(e) => return e,
        };
        if wrap_count < 1 {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "wrap_count must be >= 1".to_string(),
            );
        }

        let pad = match self.get_pad_with(args, cell) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let n = flat.len();
        let num_cols = n.div_ceil(wrap_count);

        let mut result: Vec<Vec<ArrayNode>> = vec![Vec::with_capacity(num_cols); wrap_count];
        for (i, val) in flat.into_iter().enumerate() {
            result[i % wrap_count].push(val);
        }
        // Pad the last (partial) column
        for row in &mut result {
            while row.len() < num_cols {
                row.push(pad.clone());
            }
        }

        CalcResult::Array(result)
    }

    // ── WRAPROWS ──────────────────────────────────────────────────────────────

    /// `=WRAPROWS(vector, wrap_count, [pad_with])`
    ///
    /// Wraps the provided row or column vector by rows after a specified number
    /// of values. The vector is read top-to-bottom then left-to-right.
    ///   * wrap_count – number of values per row (must be >= 1)
    ///   * pad_with   – value used to pad the last row; defaults to #N/A
    pub(crate) fn fn_wraprows(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let flat = match self.flatten_vector(args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let wrap_count = match self.get_number(&args[1], cell) {
            Ok(n) => n as usize,
            Err(e) => return e,
        };
        if wrap_count < 1 {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "wrap_count must be >= 1".to_string(),
            );
        }

        let pad = match self.get_pad_with(args, cell) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let mut result: Vec<Vec<ArrayNode>> = Vec::new();
        let mut chunk = Vec::with_capacity(wrap_count);
        for val in flat {
            chunk.push(val);
            if chunk.len() == wrap_count {
                result.push(chunk);
                chunk = Vec::with_capacity(wrap_count);
            }
        }
        if !chunk.is_empty() {
            while chunk.len() < wrap_count {
                chunk.push(pad.clone());
            }
            result.push(chunk);
        }

        CalcResult::Array(result)
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    /// Flatten the first argument of WRAPCOLS/WRAPROWS into a 1-D vector.
    /// Returns an error if the first argument is not a 1-D vector or range.
    fn flatten_vector(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Result<Vec<ArrayNode>, CalcResult> {
        let data = self.eval_to_array(&args[0], cell)?;
        let is_row_vec = data.len() == 1;
        let is_col_vec = data.iter().all(|r| r.len() == 1);
        if !is_row_vec && !is_col_vec {
            return Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "First argument must be a 1-D vector".to_string(),
            ));
        }
        let flat: Vec<ArrayNode> = if is_row_vec {
            data.into_iter().next().unwrap_or_default()
        } else {
            data.into_iter().map(|mut r| r.remove(0)).collect()
        };
        Ok(flat)
    }

    /// Parse the optional `pad_with` argument (3rd arg of WRAPCOLS/WRAPROWS).
    fn get_pad_with(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Result<ArrayNode, CalcResult> {
        if args.len() == 3 {
            let v = self.evaluate_node_in_context(&args[2], cell);
            Ok(match v {
                CalcResult::Number(n) => ArrayNode::Number(n),
                CalcResult::Boolean(b) => ArrayNode::Boolean(b),
                CalcResult::String(s) => ArrayNode::String(s),
                CalcResult::EmptyCell | CalcResult::EmptyArg => ArrayNode::Number(0.0),
                CalcResult::Error { error, .. } => ArrayNode::Error(error),
                _ => ArrayNode::Error(Error::VALUE),
            })
        } else {
            Ok(ArrayNode::Error(Error::NA))
        }
    }
}
