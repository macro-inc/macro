use statrs::distribution::{Continuous, ContinuousCDF, StudentsT};

use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

fn mean(xs: &[f64]) -> f64 {
    let n = xs.len();
    if n == 0 {
        return 0.0;
    }
    let mut s = 0.0;
    for &x in xs {
        s += x;
    }
    s / (n as f64)
}

pub(crate) fn sample_var(xs: &[f64]) -> f64 {
    let n = xs.len();
    if n < 2 {
        return 0.0;
    }
    let m = mean(xs);
    let mut s = 0.0;
    for &x in xs {
        let d = x - m;
        s += d * d;
    }
    s / ((n - 1) as f64)
}

enum TTestType {
    Paired,
    TwoSampleEqualVar,
    TwoSampleUnequalVar,
}

enum TTestTails {
    OneTailed,
    TwoTailed,
}

impl<'a> Model<'a> {
    // T.DIST(x, deg_freedom, cumulative)
    pub(crate) fn fn_t_dist(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let df = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        let cumulative = match self.get_boolean(&args[2], cell) {
            Ok(b) => b,
            Err(e) => return e,
        };

        if df < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "deg_freedom must be >= 1 in T.DIST".to_string(),
            };
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for T.DIST".to_string(),
                }
            }
        };

        let result = if cumulative { dist.cdf(x) } else { dist.pdf(x) };

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for T.DIST".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // T.DIST.2T(x, deg_freedom)
    pub(crate) fn fn_t_dist_2t(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let df = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        if x < 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "x must be >= 0 in T.DIST.2T".to_string(),
            };
        }

        if df < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "deg_freedom must be >= 1 in T.DIST.2T".to_string(),
            };
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for T.DIST.2T".to_string(),
                }
            }
        };

        let upper_tail = 1.0 - dist.cdf(x);
        let mut result = 2.0 * upper_tail;

        result = result.clamp(0.0, 1.0);

        if !result.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for T.DIST.2T".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // T.DIST.RT(x, deg_freedom)
    pub(crate) fn fn_t_dist_rt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let df = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        if df < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "deg_freedom must be >= 1 in T.DIST.RT".to_string(),
            };
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for T.DIST.RT".to_string(),
                }
            }
        };

        let result = 1.0 - dist.cdf(x);

        if !result.is_finite() || result < 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for T.DIST.RT".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // T.INV(probability, deg_freedom)
    pub(crate) fn fn_t_inv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let p = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let df = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        if p <= 0.0 || p >= 1.0 || df < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for T.INV".to_string(),
            };
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for T.INV".to_string(),
                }
            }
        };

        let x = dist.inverse_cdf(p);

        if !x.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for T.INV".to_string(),
            };
        }

        CalcResult::Number(x)
    }

    // T.INV.2T(probability, deg_freedom)
    pub(crate) fn fn_t_inv_2t(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let p = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };

        let df = match self.get_number(&args[1], cell) {
            Ok(f) => f.trunc(),
            Err(e) => return e,
        };

        if p <= 0.0 || p > 1.0 || df < 1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid parameters for T.INV.2T".to_string(),
            };
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::Error {
                    error: Error::NUM,
                    origin: cell,
                    message: "Invalid parameters for T.INV.2T".to_string(),
                }
            }
        };

        // Two-sided: F(x) = 1 - p/2
        let target_cdf = 1.0 - p / 2.0;
        let x = dist.inverse_cdf(target_cdf);

        if !x.is_finite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result for T.INV.2T".to_string(),
            };
        }

        CalcResult::Number(x.abs())
    }

    // T.TEST(array1, array2, tails, type)
    pub(crate) fn fn_t_test(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }

        let values1_opts = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => v,
                Err(error) => return error,
            },
            CalcResult::Array(a) => match self.values_from_array(a) {
                Ok(v) => v,
                Err(error) => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        format!("Error in first array: {:?}", error),
                    );
                }
            },
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "First argument must be a range or array".to_string(),
                );
            }
        };

        let values2_opts = match self.evaluate_node_in_context(&args[1], cell) {
            CalcResult::Range { left, right } => match self.values_from_range(left, right) {
                Ok(v) => v,
                Err(error) => return error,
            },
            CalcResult::Array(a) => match self.values_from_array(a) {
                Ok(v) => v,
                Err(error) => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        format!("Error in second array: {:?}", error),
                    );
                }
            },
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Second argument must be a range or array".to_string(),
                );
            }
        };

        let tails = match self.get_number(&args[2], cell) {
            Ok(f) => {
                let tf = f.trunc();
                if tf == 1.0 {
                    TTestTails::OneTailed
                } else if tf == 2.0 {
                    TTestTails::TwoTailed
                } else {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "tails must be 1 or 2".to_string(),
                    );
                }
            }
            Err(e) => return e,
        };
        let test_type = match self.get_number(&args[3], cell) {
            Ok(f) => {
                let tf = f.trunc();
                match tf {
                    1.0 => TTestType::Paired,
                    2.0 => TTestType::TwoSampleEqualVar,
                    3.0 => TTestType::TwoSampleUnequalVar,
                    _ => {
                        return CalcResult::new_error(
                            Error::NUM,
                            cell,
                            "type must be 1, 2, or 3".to_string(),
                        );
                    }
                }
            }
            Err(e) => return e,
        };

        let (values1, values2): (Vec<f64>, Vec<f64>) = if matches!(test_type, TTestType::Paired) {
            values1_opts
                .into_iter()
                .zip(values2_opts)
                .filter_map(|(o1, o2)| match (o1, o2) {
                    (Some(v1), Some(v2)) => Some((v1, v2)),
                    _ => None, // skip if either is None
                })
                .unzip()
        } else {
            // keep only numeric entries, ignore non-numeric (Option::None)
            let v1: Vec<f64> = values1_opts.into_iter().flatten().collect();
            let v2: Vec<f64> = values2_opts.into_iter().flatten().collect();
            (v1, v2)
        };

        let n1 = values1.len();
        let n2 = values2.len();

        if n1 == 0 || n2 == 0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "T.TEST requires non-empty samples".to_string(),
            );
        }

        let (t_stat, df) = match test_type {
            TTestType::Paired => {
                if n1 != n2 {
                    return CalcResult::new_error(
                        Error::NA,
                        cell,
                        "For paired T.TEST, both samples must have the same length".to_string(),
                    );
                }
                if n1 < 2 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Paired T.TEST requires at least two pairs".to_string(),
                    );
                }

                let mut diffs = Vec::with_capacity(n1);
                for i in 0..n1 {
                    diffs.push(values1[i] - values2[i]);
                }

                let nd = diffs.len();
                let md = mean(&diffs);
                let vd = sample_var(&diffs);
                if vd <= 0.0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Zero variance in paired T.TEST".to_string(),
                    );
                }
                let sd = vd.sqrt();
                let t_stat = md / (sd / (nd as f64).sqrt());
                let df = (nd - 1) as f64;
                (t_stat, df)
            }

            // 2: two-sample, equal variance (homoscedastic)
            TTestType::TwoSampleEqualVar => {
                if n1 < 2 || n2 < 2 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Two-sample T.TEST type 2 requires at least two values in each sample"
                            .to_string(),
                    );
                }

                let m1 = mean(&values1);
                let m2 = mean(&values2);
                let v1 = sample_var(&values1);
                let v2 = sample_var(&values2);

                let df_i = (n1 + n2 - 2) as i32;
                if df_i <= 0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Degrees of freedom must be positive in T.TEST type 2".to_string(),
                    );
                }
                let df = df_i as f64;

                let sp2 = (((n1 - 1) as f64) * v1 + ((n2 - 1) as f64) * v2) / df; // pooled variance

                if sp2 <= 0.0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Zero pooled variance in T.TEST type 2".to_string(),
                    );
                }

                let denom = (sp2 * (1.0 / (n1 as f64) + 1.0 / (n2 as f64))).sqrt();
                if denom == 0.0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Zero denominator in T.TEST type 2".to_string(),
                    );
                }

                let t_stat = (m1 - m2) / denom;
                (t_stat, df)
            }

            // two-sample, unequal variance (Welch)
            TTestType::TwoSampleUnequalVar => {
                if n1 < 2 || n2 < 2 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Two-sample T.TEST type 3 requires at least two values in each sample"
                            .to_string(),
                    );
                }

                let m1 = mean(&values1);
                let m2 = mean(&values2);
                let v1 = sample_var(&values1);
                let v2 = sample_var(&values2);

                let s1n = v1 / (n1 as f64);
                let s2n = v2 / (n2 as f64);
                let denom = (s1n + s2n).sqrt();
                if denom == 0.0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Zero denominator in T.TEST type 3".to_string(),
                    );
                }

                let t_stat = (m1 - m2) / denom;

                let num_df = (s1n + s2n).powi(2);
                let den_df = (s1n * s1n) / ((n1 - 1) as f64) + (s2n * s2n) / ((n2 - 1) as f64);
                if den_df == 0.0 {
                    return CalcResult::new_error(
                        Error::DIV,
                        cell,
                        "Invalid degrees of freedom in T.TEST type 3".to_string(),
                    );
                }
                let df = num_df / den_df;
                (t_stat, df)
            }
        };

        if df <= 0.0 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Degrees of freedom must be positive in T.TEST".to_string(),
            );
        }

        let dist = match StudentsT::new(0.0, 1.0, df) {
            Ok(d) => d,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid parameters for Student's t distribution".to_string(),
                );
            }
        };

        let t_abs = t_stat.abs();
        let cdf = dist.cdf(t_abs);

        let mut p = match tails {
            TTestTails::OneTailed => 1.0 - cdf,
            TTestTails::TwoTailed => 2.0 * (1.0 - cdf),
        };

        // clamp tiny fp noise
        if p < 0.0 && p > -1e-15 {
            p = 0.0;
        }
        if p > 1.0 && p < 1.0 + 1e-15 {
            p = 1.0;
        }

        CalcResult::Number(p)
    }

    // TDIST(x, deg_freedom, tails) — x≥0; tails=1→T.DIST.RT, tails=2→T.DIST.2T
    pub(crate) fn fn_tdist_compat(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if x < 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "TDIST: x must be >= 0".to_string());
        }
        let tails = match self.get_number(&args[2], cell) {
            Ok(f) => f.trunc() as i64,
            Err(e) => return e,
        };
        match tails {
            1 => self.fn_t_dist_rt(&args[0..2], cell),
            2 => self.fn_t_dist_2t(&args[0..2], cell),
            _ => CalcResult::new_error(Error::NUM, cell, "TDIST: tails must be 1 or 2".to_string()),
        }
    }
}
