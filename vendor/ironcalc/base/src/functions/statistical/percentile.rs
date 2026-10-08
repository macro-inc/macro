use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

impl<'a> Model<'a> {
    pub(crate) fn collect_sorted_values(
        &mut self,
        arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        let raw = match self.evaluate_node_in_context(arg, cell) {
            CalcResult::Range { left, right } => {
                let v = self.values_from_range(left, right)?;
                v.into_iter().flatten().collect::<Vec<_>>()
            }
            CalcResult::Array(arr) => match self.values_from_array(arr) {
                Ok(v) => v.into_iter().flatten().collect::<Vec<_>>(),
                Err(e) => {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        format!("{:?}", e),
                    ))
                }
            },
            CalcResult::Number(n) => vec![n],
            CalcResult::EmptyCell | CalcResult::EmptyArg => vec![],
            _ => {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Expected numeric range".to_string(),
                ))
            }
        };

        let mut sorted = raw;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        Ok(sorted)
    }

    // PERCENTILE.INC(array, k) — k ∈ [0, 1] inclusive
    pub(crate) fn fn_percentile_inc(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let sorted = match self.collect_sorted_values(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if sorted.is_empty() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERCENTILE.INC: empty array".to_string(),
            );
        }

        let k = match self.get_number(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if !(0.0..=1.0).contains(&k) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERCENTILE.INC: k must be between 0 and 1".to_string(),
            );
        }

        CalcResult::Number(percentile_inc_impl(&sorted, k))
    }

    // PERCENTILE.EXC(array, k) — k ∈ (0, 1) exclusive; k must be >= 1/(n+1) and <= n/(n+1)
    pub(crate) fn fn_percentile_exc(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let sorted = match self.collect_sorted_values(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if sorted.is_empty() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERCENTILE.EXC: empty array".to_string(),
            );
        }

        let k = match self.get_number(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let n = sorted.len() as f64;
        if k <= 0.0 || k >= 1.0 || k < 1.0 / (n + 1.0) || k > n / (n + 1.0) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "PERCENTILE.EXC: k out of valid range".to_string(),
            );
        }

        // 0-indexed rank = k*(n+1) - 1
        let rank = k * (n + 1.0) - 1.0;
        let low = rank.floor() as usize;
        let high = (low + 1).min(sorted.len() - 1);
        let frac = rank - rank.floor();
        let result = sorted[low] + frac * (sorted[high] - sorted[low]);

        CalcResult::Number(result)
    }

    // PERCENTRANK.INC(array, x, [significance]) — returns rank as fraction ∈ [0,1]
    pub(crate) fn fn_percentrank_inc(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if !(2..=3).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let sorted = match self.collect_sorted_values(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if sorted.len() < 2 {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "PERCENTRANK.INC: array must have at least 2 values".to_string(),
            );
        }

        let x = match self.get_number(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let sig = if args.len() == 3 {
            match self.get_number(&args[2], cell) {
                Ok(v) => {
                    let s = v.floor() as i32;
                    if s < 1 {
                        return CalcResult::new_error(
                            Error::NUM,
                            cell,
                            "PERCENTRANK.INC: significance must be >= 1".to_string(),
                        );
                    }
                    s
                }
                Err(e) => return e,
            }
        } else {
            3
        };

        let n = sorted.len();
        if x < sorted[0] || x > sorted[n - 1] {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "PERCENTRANK.INC: x not in range of array".to_string(),
            );
        }

        let rank = percentrank_inc_impl(&sorted, x);
        let factor = 10f64.powi(sig);
        let result = (rank * factor).floor() / factor;

        CalcResult::Number(result)
    }

    // PERCENTRANK.EXC(array, x, [significance]) — returns rank as fraction ∈ [0,1]
    pub(crate) fn fn_percentrank_exc(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if !(2..=3).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let sorted = match self.collect_sorted_values(&args[0], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        if sorted.is_empty() {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "PERCENTRANK.EXC: empty array".to_string(),
            );
        }

        let x = match self.get_number(&args[1], cell) {
            Ok(v) => v,
            Err(e) => return e,
        };

        let sig = if args.len() == 3 {
            match self.get_number(&args[2], cell) {
                Ok(v) => {
                    let s = v.floor() as i32;
                    if s < 1 {
                        return CalcResult::new_error(
                            Error::NUM,
                            cell,
                            "PERCENTRANK.EXC: significance must be >= 1".to_string(),
                        );
                    }
                    s
                }
                Err(e) => return e,
            }
        } else {
            3
        };

        let n = sorted.len();
        // EXC range is strictly inside the array bounds
        if x < sorted[0] || x > sorted[n - 1] {
            return CalcResult::new_error(
                Error::NA,
                cell,
                "PERCENTRANK.EXC: x not strictly inside range of array".to_string(),
            );
        }

        let rank = percentrank_exc_impl(&sorted, x);
        let factor = 10f64.powi(sig);
        let result = (rank * factor).floor() / factor;

        CalcResult::Number(result)
    }
}

/// PERCENTILE.INC interpolation: rank = k*(n-1) in 0-indexed sorted array.
pub(crate) fn percentile_inc_impl(sorted: &[f64], k: f64) -> f64 {
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let rank = k * (n - 1) as f64;
    let low = rank.floor() as usize;
    let high = (low + 1).min(n - 1);
    let frac = rank - rank.floor();
    sorted[low] + frac * (sorted[high] - sorted[low])
}

/// PERCENTRANK.INC: virtual position in sorted array, divided by (n-1).
pub(crate) fn percentrank_inc_impl(sorted: &[f64], x: f64) -> f64 {
    let n = sorted.len();
    // Number of values strictly less than x
    let k = sorted.partition_point(|&v| v < x);

    if k == n || (k < n && sorted[k] == x) {
        // x exactly matches sorted[k] or x >= all values
        return k as f64 / (n - 1) as f64;
    }

    // x is between sorted[k-1] and sorted[k]
    let frac = (x - sorted[k - 1]) / (sorted[k] - sorted[k - 1]);
    (k as f64 - 1.0 + frac) / (n - 1) as f64
}

/// PERCENTRANK.EXC: rank = (virtual_position + 1) / (n + 1).
pub(crate) fn percentrank_exc_impl(sorted: &[f64], x: f64) -> f64 {
    let n = sorted.len();
    let k = sorted.partition_point(|&v| v < x);

    let virtual_pos = if k < n && sorted[k] == x {
        k as f64
    } else if k > 0 && k < n {
        let frac = (x - sorted[k - 1]) / (sorted[k] - sorted[k - 1]);
        k as f64 - 1.0 + frac
    } else {
        k as f64
    };

    (virtual_pos + 1.0) / (n + 1) as f64
}
