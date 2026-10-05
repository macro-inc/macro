use crate::{
    calc_result::CalcResult,
    expressions::{parser::ArrayNode, parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

fn array_node_to_calc_result(node: &ArrayNode, cell: CellReferenceIndex) -> CalcResult {
    match node {
        ArrayNode::Number(n) => CalcResult::Number(*n),
        ArrayNode::Boolean(b) => CalcResult::Boolean(*b),
        ArrayNode::String(s) => CalcResult::String(s.clone()),
        ArrayNode::Error(e) => CalcResult::Error {
            error: e.clone(),
            origin: cell,
            message: String::new(),
        },
        ArrayNode::Empty => CalcResult::EmptyCell,
    }
}

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
    /// `=MAP(array1, [array2, ...], lambda)`
    ///
    /// Applies the lambda element-wise across one or more arrays of equal dimensions.
    /// The lambda receives one scalar value from each array per call.
    pub(crate) fn fn_map(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let n_arrays = args.len() - 1;

        let lambda_result = self.evaluate_node_in_context(&args[n_arrays], cell);
        if lambda_result.is_error() {
            return lambda_result;
        }

        let mut arrays: Vec<Vec<Vec<ArrayNode>>> = Vec::with_capacity(n_arrays);
        for arg in &args[..n_arrays] {
            let data = match self.eval_to_array(arg, cell) {
                Ok(d) => d,
                Err(e) => return e,
            };
            arrays.push(data);
        }

        if arrays[0].is_empty() || arrays[0][0].is_empty() {
            return CalcResult::new_error(Error::VALUE, cell, "empty array".to_string());
        }

        let num_rows = arrays[0].len();
        let num_cols = arrays[0][0].len();

        for arr in &arrays[1..] {
            if arr.len() != num_rows || arr.is_empty() || arr[0].len() != num_cols {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "MAP: all arrays must have the same dimensions".to_string(),
                );
            }
        }

        let mut result = vec![vec![ArrayNode::Empty; num_cols]; num_rows];

        for i in 0..num_rows {
            for j in 0..num_cols {
                let values: Vec<CalcResult> = arrays
                    .iter()
                    .map(|arr| array_node_to_calc_result(&arr[i][j], cell))
                    .collect();
                let cell_result = self.call_lambda_with_values(lambda_result.clone(), values, cell);
                result[i][j] = calc_result_to_array_node(cell_result);
            }
        }

        CalcResult::Array(result)
    }

    /// `=REDUCE([initial_value], array, lambda)`
    ///
    /// Accumulates a result by applying the lambda to each element of `array`.
    /// The lambda takes `(accumulator, current_value)` and returns the new accumulator.
    /// With 2 arguments the first element of the array seeds the accumulator.
    pub(crate) fn fn_reduce(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (array_idx, lambda_idx, has_initial) = if args.len() == 3 {
            (1, 2, true)
        } else {
            (0, 1, false)
        };

        let lambda_result = self.evaluate_node_in_context(&args[lambda_idx], cell);
        if lambda_result.is_error() {
            return lambda_result;
        }

        let data = match self.eval_to_array(&args[array_idx], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        let elements: Vec<&ArrayNode> = data.iter().flat_map(|row| row.iter()).collect();

        if elements.is_empty() {
            return CalcResult::new_error(Error::VALUE, cell, "empty array".to_string());
        }

        let (mut accumulator, start) = if has_initial {
            let init = self.evaluate_node_in_context(&args[0], cell);
            if init.is_error() {
                return init;
            }
            (init, 0)
        } else {
            (array_node_to_calc_result(elements[0], cell), 1)
        };

        for element in &elements[start..] {
            let current = array_node_to_calc_result(element, cell);
            accumulator = self.call_lambda_with_values(
                lambda_result.clone(),
                vec![accumulator, current],
                cell,
            );
            if accumulator.is_error() {
                return accumulator;
            }
        }

        accumulator
    }
}
