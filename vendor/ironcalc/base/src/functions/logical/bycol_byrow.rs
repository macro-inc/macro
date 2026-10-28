use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    functions::math_and_trigonometry::array_size::check_array_size,
    model::Model,
};

fn calc_result_to_array_node(result: CalcResult) -> ArrayNode {
    match result {
        CalcResult::Number(n) => ArrayNode::Number(n),
        CalcResult::Boolean(b) => ArrayNode::Boolean(b),
        CalcResult::String(s) => ArrayNode::String(s),
        CalcResult::Error { error, .. } => ArrayNode::Error(error),
        CalcResult::EmptyCell | CalcResult::EmptyArg => ArrayNode::Empty,
        _ => ArrayNode::Error(Error::VALUE),
    }
}

impl<'a> Model<'a> {
    /// `=BYCOL(array, lambda)`
    ///
    /// Applies a LAMBDA to each column of `array`, returning a 1-row array of results.
    /// The lambda receives each column as an N×1 array.
    pub(crate) fn fn_bycol(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::new_error(Error::VALUE, cell, "empty array".to_string());
        }

        let lambda_result = self.evaluate_node_in_context(&args[1], cell);
        if lambda_result.is_error() {
            return lambda_result;
        }

        let num_cols = data[0].len();
        let mut results = Vec::with_capacity(num_cols);

        for j in 0..num_cols {
            let column: Vec<Vec<ArrayNode>> = data.iter().map(|row| vec![row[j].clone()]).collect();
            let result = self.call_lambda(lambda_result.clone(), &[Node::ArrayKind(column)], cell);
            results.push(calc_result_to_array_node(result));
        }

        CalcResult::Array(vec![results])
    }

    /// `=BYROW(array, lambda)`
    ///
    /// Applies a LAMBDA to each row of `array`, returning a 1-column array of results.
    /// The lambda receives each row as a 1×M array.
    pub(crate) fn fn_byrow(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let data = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if data.is_empty() || data[0].is_empty() {
            return CalcResult::new_error(Error::VALUE, cell, "empty array".to_string());
        }

        let lambda_result = self.evaluate_node_in_context(&args[1], cell);
        if lambda_result.is_error() {
            return lambda_result;
        }

        let mut results = Vec::with_capacity(data.len());

        for row in &data {
            let result = self.call_lambda(
                lambda_result.clone(),
                &[Node::ArrayKind(vec![row.clone()])],
                cell,
            );
            results.push(vec![calc_result_to_array_node(result)]);
        }

        CalcResult::Array(results)
    }

    /// `=MAKEARRAY(rows, cols, lambda)`
    ///
    /// Returns an array of the given size by calling `lambda(row, col)` (1-based) for each cell.
    pub(crate) fn fn_makearray(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let rows = match self.get_number(&args[0], cell) {
            Ok(f) => {
                let n = f.floor() as i64;
                if n < 1 {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "rows must be >= 1".to_string(),
                    );
                }
                n as usize
            }
            Err(e) => return e,
        };

        let cols = match self.get_number(&args[1], cell) {
            Ok(f) => {
                let n = f.floor() as i64;
                if n < 1 {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "cols must be >= 1".to_string(),
                    );
                }
                n as usize
            }
            Err(e) => return e,
        };

        if let Some((error, message)) = check_array_size(rows, cols) {
            return CalcResult::new_error(error, cell, message);
        }

        let lambda_result = self.evaluate_node_in_context(&args[2], cell);
        if lambda_result.is_error() {
            return lambda_result;
        }

        let mut result = Vec::with_capacity(rows);
        for r in 1..=rows {
            let mut row = Vec::with_capacity(cols);
            for c in 1..=cols {
                let cell_result = self.call_lambda_with_values(
                    lambda_result.clone(),
                    vec![CalcResult::Number(r as f64), CalcResult::Number(c as f64)],
                    cell,
                );
                row.push(calc_result_to_array_node(cell_result));
            }
            result.push(row);
        }

        CalcResult::Array(result)
    }
}
