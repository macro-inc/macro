use crate::expressions::parser::ArrayNode;
use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

// ─── Matrix helpers ──────────────────────────────────────────────────────────

/// Gauss-Jordan elimination: solves A·x = b in-place on the augmented [A|b] matrix.
/// Returns None if the matrix is singular (pivot < eps).
fn solve_system(a: &[Vec<f64>], b: &[f64]) -> Option<Vec<f64>> {
    let k = a.len();
    let mut m: Vec<Vec<f64>> = (0..k)
        .map(|i| {
            let mut row = a[i].clone();
            row.push(b[i]);
            row
        })
        .collect();

    for col in 0..k {
        // partial pivoting
        let pivot_row = (col..k)
            .max_by(|&r1, &r2| {
                m[r1][col]
                    .abs()
                    .partial_cmp(&m[r2][col].abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or(col);
        m.swap(col, pivot_row);

        let pivot = m[col][col];
        if pivot.abs() < 1e-12 {
            return None;
        }

        for val in &mut m[col][col..=k] {
            *val /= pivot;
        }

        let col_slice: Vec<f64> = m[col][col..=k].to_vec();
        for (row, mrow) in m.iter_mut().enumerate() {
            if row != col {
                let factor = mrow[col];
                for (offset, &v) in col_slice.iter().enumerate() {
                    mrow[col + offset] -= factor * v;
                }
            }
        }
    }

    Some((0..k).map(|i| m[i][k]).collect())
}

/// Inverts a square matrix via Gauss-Jordan on [A|I].
/// Returns None if singular.
fn invert_matrix(a: &[Vec<f64>]) -> Option<Vec<Vec<f64>>> {
    let k = a.len();
    let mut m: Vec<Vec<f64>> = (0..k)
        .map(|i| {
            let mut row = a[i].clone();
            for j in 0..k {
                row.push(if i == j { 1.0 } else { 0.0 });
            }
            row
        })
        .collect();

    for col in 0..k {
        let pivot_row = (col..k)
            .max_by(|&r1, &r2| {
                m[r1][col]
                    .abs()
                    .partial_cmp(&m[r2][col].abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or(col);
        m.swap(col, pivot_row);

        let pivot = m[col][col];
        if pivot.abs() < 1e-12 {
            return None;
        }

        for val in &mut m[col][col..2 * k] {
            *val /= pivot;
        }

        let col_slice: Vec<f64> = m[col][col..2 * k].to_vec();
        for (row, mrow) in m.iter_mut().enumerate() {
            if row != col {
                let factor = mrow[col];
                for (offset, &v) in col_slice.iter().enumerate() {
                    mrow[col + offset] -= factor * v;
                }
            }
        }
    }

    Some((0..k).map(|i| m[i][k..].to_vec()).collect())
}

// ─── Data collection ─────────────────────────────────────────────────────────

struct RegressionData {
    /// Y values (n × 1)
    y: Vec<f64>,
    /// X matrix (n rows × p cols); p = 0 if auto-generated {1..n}
    x: Vec<Vec<f64>>,
    /// Number of X columns
    p: usize,
}

impl<'a> Model<'a> {
    /// Collect Y and X data for regression functions.
    /// `x_arg`: None → auto-generate x = 1, 2, ..., n
    fn collect_regression_data(
        &mut self,
        y_arg: &Node,
        x_arg: Option<&Node>,
        cell: CellReferenceIndex,
    ) -> Result<RegressionData, CalcResult> {
        // Collect Y
        let y_raw = self.collect_matrix_from_node(y_arg, cell)?;
        let y: Vec<f64> = y_raw.into_iter().flatten().collect();
        let n = y.len();

        if n < 2 {
            return Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Regression requires at least 2 data points".to_string(),
            ));
        }

        let (x, p) = match x_arg {
            None => {
                // Auto-generate x = 1, 2, ..., n (single column)
                let x_auto: Vec<Vec<f64>> = (1..=n).map(|i| vec![i as f64]).collect();
                (x_auto, 1)
            }
            Some(x_node) => {
                let x_mat = self.collect_matrix_from_node(x_node, cell)?;
                let rows = x_mat.len();
                let p = if rows > 0 { x_mat[0].len() } else { 0 };

                if rows != n {
                    return Err(CalcResult::new_error(
                        Error::REF,
                        cell,
                        "Regression: known_y and known_x must have the same number of rows"
                            .to_string(),
                    ));
                }
                (x_mat, p)
            }
        };

        Ok(RegressionData { y, x, p })
    }

    /// Collect all values from a node as a 2D matrix (rows × cols).
    fn collect_matrix_from_node(
        &mut self,
        arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<Vec<f64>>, CalcResult> {
        match self.evaluate_node_in_context(arg, cell) {
            CalcResult::Range { left, right } => {
                let n_rows = (right.row - left.row + 1) as usize;
                let n_cols = (right.column - left.column + 1) as usize;
                let mut matrix = vec![vec![0.0_f64; n_cols]; n_rows];
                for (r, row) in matrix.iter_mut().enumerate() {
                    for (c, val) in row.iter_mut().enumerate() {
                        let ref_idx = crate::expressions::types::CellReferenceIndex {
                            sheet: left.sheet,
                            row: left.row + r as i32,
                            column: left.column + c as i32,
                        };
                        match self.evaluate_cell(ref_idx) {
                            CalcResult::Number(v) => *val = v,
                            CalcResult::EmptyCell | CalcResult::EmptyArg => {}
                            err @ CalcResult::Error { .. } => return Err(err),
                            _ => {
                                return Err(CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "Regression: non-numeric value in data range".to_string(),
                                ))
                            }
                        }
                    }
                }
                Ok(matrix)
            }
            CalcResult::Array(arr) => {
                let mut matrix = Vec::new();
                for row in arr {
                    let mut mrow = Vec::new();
                    for item in row {
                        match item {
                            crate::expressions::parser::ArrayNode::Number(v) => mrow.push(v),
                            crate::expressions::parser::ArrayNode::Empty => mrow.push(0.0),
                            crate::expressions::parser::ArrayNode::Error(e) => {
                                return Err(CalcResult::new_error(e, cell, "".to_string()))
                            }
                            _ => mrow.push(0.0),
                        }
                    }
                    matrix.push(mrow);
                }
                Ok(matrix)
            }
            CalcResult::Number(n) => Ok(vec![vec![n]]),
            CalcResult::EmptyCell | CalcResult::EmptyArg => Ok(vec![]),
            _ => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expected numeric range or array".to_string(),
            )),
        }
    }
}

// ─── Regression core ─────────────────────────────────────────────────────────

/// Result of the core linear regression.
struct RegResult {
    /// Coefficients in Excel output order: [β_p, β_{p-1}, ..., β_1, β_0]
    /// (last x column first, intercept last, or omitted if const=FALSE)
    coeffs: Vec<f64>,
    /// Standard errors in the same order (only if stats=TRUE)
    std_errors: Option<Vec<f64>>,
    r_squared: Option<f64>,
    se_y: Option<f64>,
    f_stat: Option<f64>,
    df_res: Option<f64>,
    ss_reg: Option<f64>,
    ss_res: Option<f64>,
}

/// Core linear regression for any number of predictors.
/// Design matrix columns: [1, x_1, x_2, ..., x_p] (or [x_1, ..., x_p] if !const_term).
/// Returns coefficients in internal order: [β_0, β_1, ..., β_p] (intercept first if const).
fn linear_regression(
    y: &[f64],
    x: &[Vec<f64>],
    p: usize,
    const_term: bool,
    compute_stats: bool,
) -> Option<RegResult> {
    let n = y.len();
    let k = p + const_term as usize; // number of parameters

    if n < k || k == 0 {
        return None;
    }

    // Build D'D (k×k) and D'Y (k×1)
    let mut dtd = vec![vec![0.0_f64; k]; k];
    let mut dty = vec![0.0_f64; k];

    for i in 0..n {
        // Build design row d[i]: length k
        let d: Vec<f64> = if const_term {
            let mut row = vec![1.0_f64];
            row.extend_from_slice(&x[i]);
            row
        } else {
            x[i].clone()
        };

        for r in 0..k {
            dty[r] += d[r] * y[i];
            for c in 0..k {
                dtd[r][c] += d[r] * d[c];
            }
        }
    }

    // Solve (D'D) β = D'Y
    let beta = solve_system(&dtd, &dty)?;
    // beta[0] = β_0 (intercept if const), beta[1..] = β_1..β_p

    // Excel output order: reverse x coefficients, intercept last.
    // When const=FALSE the intercept is forced to 0, but Excel still outputs a
    // p+1 wide array with 0 in the intercept column.
    let coeffs: Vec<f64> = {
        let x_part: Vec<f64> = beta[const_term as usize..].iter().rev().cloned().collect();
        let mut out = x_part;
        out.push(if const_term { beta[0] } else { 0.0 });
        out
    };

    if !compute_stats {
        return Some(RegResult {
            coeffs,
            std_errors: None,
            r_squared: None,
            se_y: None,
            f_stat: None,
            df_res: None,
            ss_reg: None,
            ss_res: None,
        });
    }

    // Compute fitted values and residuals
    let fitted: Vec<f64> = (0..n)
        .map(|i| {
            let d: Vec<f64> = if const_term {
                let mut row = vec![1.0_f64];
                row.extend_from_slice(&x[i]);
                row
            } else {
                x[i].clone()
            };
            d.iter().zip(beta.iter()).map(|(di, bi)| di * bi).sum()
        })
        .collect();

    let ss_res: f64 = y
        .iter()
        .zip(fitted.iter())
        .map(|(yi, fi)| (yi - fi).powi(2))
        .sum();
    let df = n as f64 - k as f64;

    let (mean_y, ss_tot) = if const_term {
        let mean = y.iter().sum::<f64>() / n as f64;
        let ss_tot: f64 = y.iter().map(|yi| (yi - mean).powi(2)).sum();
        (mean, ss_tot)
    } else {
        let ss_tot: f64 = y.iter().map(|yi| yi.powi(2)).sum();
        (0.0, ss_tot)
    };

    let ss_reg = ss_tot - ss_res;
    let r_sq = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        1.0
    };
    let r_sq = r_sq.clamp(0.0, 1.0);

    let se_y = if df > 0.0 {
        (ss_res / df).sqrt()
    } else {
        f64::NAN
    };

    let df_model = p as f64; // number of x predictors (not counting intercept)
    let f_stat = if df > 0.0 && df_model > 0.0 {
        (ss_reg / df_model) / (ss_res / df)
    } else {
        f64::NAN
    };

    // Standard errors: sqrt(se_y² · (D'D)^{-1}_{j,j})
    let se_beta: Vec<f64> = {
        let inv = invert_matrix(&dtd)?;
        let var_y = if df > 0.0 { ss_res / df } else { f64::NAN };
        (0..k).map(|j| (var_y * inv[j][j]).sqrt()).collect()
    };

    // Reorder standard errors to match coefficients output order.
    // const=FALSE: intercept se is #N/A (represented as NaN here).
    let std_errors: Vec<f64> = {
        let x_part: Vec<f64> = se_beta[const_term as usize..]
            .iter()
            .rev()
            .cloned()
            .collect();
        let mut out = x_part;
        out.push(if const_term { se_beta[0] } else { f64::NAN });
        out
    };

    let _ = mean_y;

    Some(RegResult {
        coeffs,
        std_errors: Some(std_errors),
        r_squared: Some(r_sq),
        se_y: Some(se_y),
        f_stat: Some(f_stat),
        df_res: Some(df),
        ss_reg: Some(ss_reg),
        ss_res: Some(ss_res),
    })
}

/// Build LINEST/LOGEST output array from a RegResult.
/// ncols = coeffs.len() (one column per coefficient)
fn build_output_array(reg: RegResult, stats: bool) -> CalcResult {
    let ncols = reg.coeffs.len();

    let row0: Vec<ArrayNode> = reg.coeffs.iter().map(|&v| ArrayNode::Number(v)).collect();

    if !stats {
        return CalcResult::Array(vec![row0]);
    }

    // Row 1: standard errors
    let row1: Vec<ArrayNode> = reg
        .std_errors
        .as_deref()
        .unwrap_or(&vec![f64::NAN; ncols])
        .iter()
        .map(|&v| {
            if v.is_nan() {
                ArrayNode::Error(Error::NA)
            } else {
                ArrayNode::Number(v)
            }
        })
        .collect();

    // Row 2: [R², se_y, #N/A, ...]
    let mut row2 = vec![ArrayNode::Error(Error::NA); ncols];
    row2[0] = ArrayNode::Number(reg.r_squared.unwrap_or(f64::NAN));
    if ncols > 1 {
        let se = reg.se_y.unwrap_or(f64::NAN);
        row2[1] = if se.is_nan() {
            ArrayNode::Error(Error::NA)
        } else {
            ArrayNode::Number(se)
        };
    }

    // Row 3: [F, df, #N/A, ...]
    let mut row3 = vec![ArrayNode::Error(Error::NA); ncols];
    row3[0] = match reg.f_stat {
        Some(f) if !f.is_nan() => ArrayNode::Number(f),
        _ => ArrayNode::Error(Error::NA),
    };
    if ncols > 1 {
        row3[1] = match reg.df_res {
            Some(df) if !df.is_nan() => ArrayNode::Number(df),
            _ => ArrayNode::Error(Error::NA),
        };
    }

    // Row 4: [SS_reg, SS_res, #N/A, ...]
    let mut row4 = vec![ArrayNode::Error(Error::NA); ncols];
    row4[0] = match reg.ss_reg {
        Some(v) if !v.is_nan() => ArrayNode::Number(v),
        _ => ArrayNode::Error(Error::NA),
    };
    if ncols > 1 {
        row4[1] = match reg.ss_res {
            Some(v) if !v.is_nan() => ArrayNode::Number(v),
            _ => ArrayNode::Error(Error::NA),
        };
    }

    CalcResult::Array(vec![row0, row1, row2, row3, row4])
}

// ─── Public function implementations ─────────────────────────────────────────

impl<'a> Model<'a> {
    // LINEST(known_y's, [known_x's], [const], [stats])
    pub(crate) fn fn_linest(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let x_arg = args.get(1);
        let const_term = match eval_optional_bool(self, args.get(2), cell, true) {
            Ok(b) => b,
            Err(e) => return e,
        };
        let stats = match eval_optional_bool(self, args.get(3), cell, false) {
            Ok(b) => b,
            Err(e) => return e,
        };

        let data = match self.collect_regression_data(&args[0], x_arg, cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        match linear_regression(&data.y, &data.x, data.p, const_term, stats) {
            Some(reg) => build_output_array(reg, stats),
            None => CalcResult::new_error(Error::NUM, cell, "LINEST: singular matrix".to_string()),
        }
    }

    // LOGEST(known_y's, [known_x's], [const], [stats])
    // Fits y = b * m1^x1 * m2^x2 * ... via linear regression on ln(y).
    pub(crate) fn fn_logest(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let x_arg = args.get(1);
        let const_term = match eval_optional_bool(self, args.get(2), cell, true) {
            Ok(b) => b,
            Err(e) => return e,
        };
        let stats = match eval_optional_bool(self, args.get(3), cell, false) {
            Ok(b) => b,
            Err(e) => return e,
        };

        let mut data = match self.collect_regression_data(&args[0], x_arg, cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        // Transform y → ln(y); return #NUM! if any y ≤ 0
        for yi in &data.y {
            if *yi <= 0.0 {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "LOGEST: all known_y values must be positive".to_string(),
                );
            }
        }
        data.y = data.y.iter().map(|&v| v.ln()).collect();

        match linear_regression(&data.y, &data.x, data.p, const_term, stats) {
            Some(mut reg) => {
                // Transform coefficients: exp(each)
                for c in &mut reg.coeffs {
                    *c = c.exp();
                }
                // Stats rows (rows 1-4) are about the log-linear fit, not transformed
                build_output_array(reg, stats)
            }
            None => CalcResult::new_error(Error::NUM, cell, "LOGEST: singular matrix".to_string()),
        }
    }

    // TREND(known_y's, [known_x's], [new_x's], [const])
    // Returns an array of predicted y values from linear regression.
    pub(crate) fn fn_trend(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let x_arg = args.get(1);
        let const_term = if args.len() >= 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            true
        };

        let data = match self.collect_regression_data(&args[0], x_arg, cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        let reg = match linear_regression(&data.y, &data.x, data.p, const_term, false) {
            Some(r) => r,
            None => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "TREND: singular matrix".to_string(),
                )
            }
        };

        // Rebuild beta in internal order: [β_0, β_1, ..., β_p]
        let beta = reconstruct_beta(&reg.coeffs, const_term, data.p);

        // Collect new_x values (or use known_x if omitted)
        let new_x_mat = if args.len() >= 3 {
            match self.collect_matrix_from_node(&args[2], cell) {
                Ok(m) => m,
                Err(e) => return e,
            }
        } else {
            data.x.clone()
        };

        let predicted: Vec<Vec<ArrayNode>> = new_x_mat
            .iter()
            .map(|row| {
                let pred = predict(&beta, row, const_term);
                vec![ArrayNode::Number(pred)]
            })
            .collect();

        CalcResult::Array(predicted)
    }

    // GROWTH(known_y's, [known_x's], [new_x's], [const])
    // Returns predicted values from exponential regression: y = b * m^x.
    pub(crate) fn fn_growth(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=4).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }

        let x_arg = args.get(1);
        let const_term = if args.len() >= 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            true
        };

        let mut data = match self.collect_regression_data(&args[0], x_arg, cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        for yi in &data.y {
            if *yi <= 0.0 {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "GROWTH: all known_y values must be positive".to_string(),
                );
            }
        }
        data.y = data.y.iter().map(|&v| v.ln()).collect();

        let reg = match linear_regression(&data.y, &data.x, data.p, const_term, false) {
            Some(r) => r,
            None => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "GROWTH: singular matrix".to_string(),
                )
            }
        };

        let beta_log = reconstruct_beta(&reg.coeffs, const_term, data.p);

        let new_x_mat = if args.len() >= 3 {
            match self.collect_matrix_from_node(&args[2], cell) {
                Ok(m) => m,
                Err(e) => return e,
            }
        } else {
            data.x.clone()
        };

        let predicted: Vec<Vec<ArrayNode>> = new_x_mat
            .iter()
            .map(|row| {
                let log_pred = predict(&beta_log, row, const_term);
                vec![ArrayNode::Number(log_pred.exp())]
            })
            .collect();

        CalcResult::Array(predicted)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Evaluate an optional boolean argument, returning `default` when the argument
/// is absent or an empty cell/arg (which Excel treats as omitted).
fn eval_optional_bool(
    model: &mut Model<'_>,
    arg: Option<&Node>,
    cell: CellReferenceIndex,
    default: bool,
) -> Result<bool, CalcResult> {
    let node = match arg {
        None => return Ok(default),
        Some(n) => n,
    };
    match model.evaluate_node_in_context(node, cell) {
        CalcResult::EmptyArg | CalcResult::EmptyCell => Ok(default),
        CalcResult::Boolean(b) => Ok(b),
        CalcResult::Number(n) => Ok(n != 0.0),
        err @ CalcResult::Error { .. } => Err(err),
        _ => Ok(default),
    }
}

/// Reconstruct internal beta vector [β_0, β_1, ..., β_p] from Excel-order coefficients.
fn reconstruct_beta(coeffs: &[f64], const_term: bool, p: usize) -> Vec<f64> {
    // coeffs is: [β_p, β_{p-1}, ..., β_1, β_0] (if const) or [β_p, ..., β_1]
    let mut beta = vec![0.0_f64; p + const_term as usize];
    if const_term {
        // intercept is the last element of coeffs
        beta[0] = *coeffs.last().unwrap_or(&0.0);
        // x coefficients are reversed
        for j in 0..p {
            beta[j + 1] = coeffs[p - 1 - j];
        }
    } else {
        for j in 0..p {
            beta[j] = coeffs[p - 1 - j];
        }
    }
    beta
}

/// Predict y for a single x row given beta in internal order.
fn predict(beta: &[f64], x_row: &[f64], const_term: bool) -> f64 {
    let mut pred = if const_term { beta[0] } else { 0.0 };
    let x_start = const_term as usize;
    for (j, &xj) in x_row.iter().enumerate() {
        if x_start + j < beta.len() {
            pred += beta[x_start + j] * xj;
        }
    }
    pred
}
