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
    // ── EXPAND ────────────────────────────────────────────────────────────────

    /// `=EXPAND(array, rows, [columns], [pad_with])`
    ///
    /// Expands or pads an array to the specified dimensions.
    ///   * rows    – target row count (must be >= current rows)
    ///   * columns – target column count (must be >= current columns); defaults to current columns
    ///   * pad_with – value to fill new cells with; defaults to #N/A
    pub(crate) fn fn_expand(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        let src_rows = data.len();
        let src_cols = data.first().map(|r| r.len()).unwrap_or(0);

        let target_rows = match self.get_number(&args[1], cell) {
            Ok(n) => n as usize,
            Err(e) => return e,
        };

        let target_cols = if args.len() >= 3 {
            match self.get_number(&args[2], cell) {
                Ok(n) => n as usize,
                Err(e) => return e,
            }
        } else {
            src_cols
        };

        if target_rows < src_rows {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "rows must be >= array row count".to_string(),
            );
        }
        if target_cols < src_cols {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "columns must be >= array column count".to_string(),
            );
        }

        let pad = if args.len() == 4 {
            let v = self.evaluate_node_in_context(&args[3], cell);
            match v {
                CalcResult::Number(n) => ArrayNode::Number(n),
                CalcResult::Boolean(b) => ArrayNode::Boolean(b),
                CalcResult::String(s) => ArrayNode::String(s),
                CalcResult::EmptyCell | CalcResult::EmptyArg => ArrayNode::Number(0.0),
                CalcResult::Error { error, .. } => ArrayNode::Error(error),
                _ => ArrayNode::Error(Error::VALUE),
            }
        } else {
            ArrayNode::Error(Error::NA)
        };

        let mut result: Vec<Vec<ArrayNode>> = Vec::with_capacity(target_rows);
        for r in 0..target_rows {
            let mut row: Vec<ArrayNode> = Vec::with_capacity(target_cols);
            for c in 0..target_cols {
                let val = data
                    .get(r)
                    .and_then(|src| src.get(c))
                    .cloned()
                    .unwrap_or_else(|| pad.clone());
                row.push(val);
            }
            result.push(row);
        }

        CalcResult::Array(result)
    }
}
