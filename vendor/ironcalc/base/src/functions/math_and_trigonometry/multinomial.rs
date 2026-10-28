use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

fn log_factorial(n: u64) -> f64 {
    (1..=n).map(|i| (i as f64).ln()).sum()
}

impl<'a> Model<'a> {
    // ── MULTINOMIAL ───────────────────────────────────────────────────────────

    /// `=MULTINOMIAL(number1, [number2], ...)`
    ///
    /// Returns `(n1 + n2 + ... + nk)! / (n1! * n2! * ... * nk!)`.
    /// All arguments must be non-negative integers (or numbers truncated to int).
    pub(crate) fn fn_multinomial(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }

        let mut values: Vec<u64> = Vec::new();

        for arg in args {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(v) => {
                    if v < 0.0 {
                        return CalcResult::new_error(
                            Error::NUM,
                            cell,
                            "MULTINOMIAL requires non-negative values".to_string(),
                        );
                    }
                    values.push(v.trunc() as u64);
                }
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    for row in left.row..=right.row {
                        for column in left.column..=right.column {
                            match self.evaluate_cell(
                                crate::expressions::types::CellReferenceIndex {
                                    sheet: left.sheet,
                                    row,
                                    column,
                                },
                            ) {
                                CalcResult::Number(v) => {
                                    if v < 0.0 {
                                        return CalcResult::new_error(
                                            Error::NUM,
                                            cell,
                                            "MULTINOMIAL requires non-negative values".to_string(),
                                        );
                                    }
                                    values.push(v.trunc() as u64);
                                }
                                CalcResult::EmptyCell | CalcResult::EmptyArg => values.push(0),
                                err @ CalcResult::Error { .. } => return err,
                                _ => {
                                    return CalcResult::new_error(
                                        Error::VALUE,
                                        cell,
                                        "MULTINOMIAL requires numeric values".to_string(),
                                    )
                                }
                            }
                        }
                    }
                }
                CalcResult::Array(arr) => {
                    for row in arr {
                        for node in row {
                            match node {
                                ArrayNode::Number(v) => {
                                    if v < 0.0 {
                                        return CalcResult::new_error(
                                            Error::NUM,
                                            cell,
                                            "MULTINOMIAL requires non-negative values".to_string(),
                                        );
                                    }
                                    values.push(v.trunc() as u64);
                                }
                                ArrayNode::Empty => values.push(0),
                                ArrayNode::Error(e) => {
                                    return CalcResult::Error {
                                        error: e,
                                        origin: cell,
                                        message: String::new(),
                                    }
                                }
                                _ => {
                                    return CalcResult::new_error(
                                        Error::VALUE,
                                        cell,
                                        "MULTINOMIAL requires numeric values".to_string(),
                                    )
                                }
                            }
                        }
                    }
                }
                CalcResult::EmptyCell | CalcResult::EmptyArg => values.push(0),
                err @ CalcResult::Error { .. } => return err,
                _ => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "MULTINOMIAL requires numeric values".to_string(),
                    )
                }
            }
        }

        // Compute (sum)! / (n1! * n2! * ... * nk!) using f64 to handle large values.
        // Use the log-factorial approach for numerical stability.
        let sum: u64 = values.iter().sum();
        let log_result = log_factorial(sum) - values.iter().map(|&v| log_factorial(v)).sum::<f64>();
        let result = log_result.exp();
        if !result.is_finite() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "MULTINOMIAL: result overflow".to_string(),
            );
        }
        CalcResult::Number(result.round())
    }
}
