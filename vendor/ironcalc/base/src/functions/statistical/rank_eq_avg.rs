use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    // Helper to collect numeric values from the 2nd argument of RANK.*
    fn collect_rank_values(
        &mut self,
        arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        let values = match self.evaluate_node_in_context(arg, cell) {
            CalcResult::Array(array) => match self.values_from_array(array) {
                Ok(v) => v,
                Err(e) => {
                    return Err(CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: format!("Unsupported array argument: {}", e),
                    })
                }
            },
            CalcResult::Range { left, right } => self.values_from_range(left, right)?,
            CalcResult::Boolean(value) => {
                if !matches!(arg, Node::ReferenceKind { .. }) {
                    vec![Some(if value { 1.0 } else { 0.0 })]
                } else {
                    return Err(CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "Unsupported argument type".to_string(),
                    });
                }
            }
            _ => {
                return Err(CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Unsupported argument type".to_string(),
                })
            }
        };

        let numeric_values: Vec<f64> = values.into_iter().flatten().collect();
        Ok(numeric_values)
    }

    // RANK.EQ(number, ref, [order])
    pub(crate) fn fn_rank_eq(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(2..=3).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        // number
        let number = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // ref
        let mut values = match self.collect_rank_values(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if values.is_empty() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "No numeric values for RANK.EQ".to_string(),
            };
        }

        // order: default 0 (descending)
        let order = if args.len() == 2 {
            0.0
        } else {
            match self.get_number_no_bools(&args[2], cell) {
                Ok(f) => f,
                Err(e) => return e,
            }
        };

        values.retain(|v| !v.is_nan());

        // "better" = greater (descending) or smaller (ascending)
        let mut better = 0;
        let mut equal = 0;

        if order == 0.0 {
            // descending
            for v in &values {
                if *v > number {
                    better += 1;
                } else if *v == number {
                    equal += 1;
                }
            }
        } else {
            // ascending
            for v in &values {
                if *v < number {
                    better += 1;
                } else if *v == number {
                    equal += 1;
                }
            }
        }

        if equal == 0 {
            return CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Number not found in reference for RANK.EQ".to_string(),
            };
        }

        let rank = (better as f64) + 1.0;
        CalcResult::Number(rank)
    }

    // RANK.AVG(number, ref, [order])
    pub(crate) fn fn_rank_avg(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(2..=3).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        // number
        let number = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        // ref
        let mut values = match self.collect_rank_values(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if values.is_empty() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "No numeric values for RANK.AVG".to_string(),
            };
        }

        // order: default 0 (descending)
        let order = if args.len() == 2 {
            0.0
        } else {
            match self.get_number_no_bools(&args[2], cell) {
                Ok(f) => f,
                Err(e) => return e,
            }
        };

        values.retain(|v| !v.is_nan());

        // > or < depending on order
        let mut better = 0;
        let mut equal = 0;

        if order == 0.0 {
            // descending
            for v in &values {
                if *v > number {
                    better += 1;
                } else if *v == number {
                    equal += 1;
                }
            }
        } else {
            // ascending
            for v in &values {
                if *v < number {
                    better += 1;
                } else if *v == number {
                    equal += 1;
                }
            }
        }

        if equal == 0 {
            return CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Number not found in reference for RANK.AVG".to_string(),
            };
        }

        // For ties, average of the ranks. If the equal values occupy positions
        // (better+1) ..= (better+equal), the average is:
        // better + (equal + 1) / 2
        let better_f = better as f64;
        let equal_f = equal as f64;
        let rank = better_f + (equal_f + 1.0) / 2.0;

        CalcResult::Number(rank)
    }
}
