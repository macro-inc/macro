use statrs::distribution::{ContinuousCDF, Normal};

use crate::expressions::token::Error;
use crate::expressions::types::CellReferenceIndex;
use crate::{calc_result::CalcResult, expressions::parser::Node, model::Model};

impl<'a> Model<'a> {
    // Z.TEST(array, x, [sigma])
    pub(crate) fn fn_z_test(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // 2 or 3 arguments
        if args.len() < 2 || args.len() > 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let array_arg = self.evaluate_node_in_context(&args[0], cell);

        // Flatten first argument into Vec<Option<f64>> (numeric / non-numeric)
        let values = match array_arg {
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => v,
                Err(error) => return error,
            },
            CalcResult::Array(array) => match self.values_from_array(array) {
                Ok(v) => v,
                Err(error) => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        format!("Error in array argument: {:?}", error),
                    );
                }
            },
            CalcResult::Number(v) => vec![Some(v)],
            error @ CalcResult::Error { .. } => return error,
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Z.TEST first argument must be a range or array".to_string(),
                );
            }
        };

        // Collect basic stats on numeric entries
        let mut sum = 0.0;
        let mut count: u64 = 0;

        for x in values.iter().flatten() {
            sum += x;
            count += 1;
        }

        // Excel: if array has no numeric values -> #N/A
        if count == 0 {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "Z.TEST array has no numeric data".to_string(),
            );
        }

        let n = count as f64;
        let mean = sum / n;

        // x argument (hypothesized population mean)
        let x_value = match self.evaluate_node_in_context(&args[1], cell) {
            CalcResult::Number(v) => v,
            error @ CalcResult::Error { .. } => return error,
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Z.TEST second argument (x) must be numeric".to_string(),
                );
            }
        };

        // Optional sigma
        let mut sigma: Option<f64> = None;
        if args.len() == 3 {
            match self.evaluate_node_in_context(&args[2], cell) {
                CalcResult::Number(v) => {
                    if v == 0.0 {
                        return CalcResult::new_error(
                            Error::NUM,
                            cell,
                            "Z.TEST sigma cannot be zero".to_string(),
                        );
                    }
                    sigma = Some(v);
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Z.TEST sigma (third argument) must be numeric".to_string(),
                    );
                }
            }
        }

        // If sigma omitted, use sample standard deviation STDEV(array)
        let sigma_value = if let Some(s) = sigma {
            s
        } else {
            // Excel: if only one numeric value and sigma omitted -> #DIV/0!
            if count <= 1 {
                return CalcResult::new_error(
                    Error::DIV,
                    cell,
                    "Z.TEST requires at least two values when sigma is omitted".to_string(),
                );
            }

            // Compute sum of squared deviations
            let mut sumsq_dev = 0.0;
            for x in values.iter().flatten() {
                let d = x - mean;
                sumsq_dev += d * d;
            }

            let var = sumsq_dev / (n - 1.0);
            if var <= 0.0 {
                return CalcResult::new_error(
                    Error::DIV,
                    cell,
                    "Z.TEST standard deviation is zero".to_string(),
                );
            }

            var.sqrt()
        };

        // Compute z statistic: (mean - x) / (sigma / sqrt(n))
        let denom = sigma_value / n.sqrt();
        if denom == 0.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Z.TEST denominator is zero".to_string(),
            );
        }

        let z = (mean - x_value) / denom;

        // Standard normal CDF
        let dist = match Normal::new(0.0, 1.0) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Cannot create standard normal distribution in Z.TEST".to_string(),
                );
            }
        };

        let mut p = 1.0 - dist.cdf(z);

        // clamp tiny FP noise
        if p < 0.0 && p > -1e-15 {
            p = 0.0;
        }
        if p > 1.0 && p < 1.0 + 1e-15 {
            p = 1.0;
        }

        CalcResult::Number(p)
    }
}
