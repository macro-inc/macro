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
    // ── MMULT ─────────────────────────────────────────────────────────────────

    /// `=MMULT(array1, array2)`
    ///
    /// Returns the matrix product of two arrays. The number of columns of
    /// `array1` must equal the number of rows of `array2`. All entries must
    /// be numeric. Empty cells, booleans, and strings in either argument yield
    /// `#VALUE!`. Errors are propagated. Overflow yields `#NUM!`.
    pub(crate) fn fn_mmult(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        // Omitted arguments (e.g. =MMULT(,)) are not valid matrices.
        if matches!(args[0], Node::EmptyArgKind) || matches!(args[1], Node::EmptyArgKind) {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "MMULT requires non-empty arrays".to_string(),
            );
        }

        let a = match self.eval_to_array(&args[0], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let b = match self.eval_to_array(&args[1], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        if a.is_empty() || a[0].is_empty() || b.is_empty() || b[0].is_empty() {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "MMULT requires non-empty arrays".to_string(),
            );
        }

        let m = a.len();
        let k = a[0].len();
        let k2 = b.len();
        let n = b[0].len();

        if k != k2 {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "MMULT dimension mismatch".to_string(),
            );
        }

        // Coerce one ArrayNode into f64 (or return an early error).
        // MMULT does not coerce booleans or empty cells — those yield #VALUE!.
        fn coerce(node: &ArrayNode, cell: CellReferenceIndex) -> Result<f64, CalcResult> {
            match node {
                ArrayNode::Number(v) => Ok(*v),
                ArrayNode::Boolean(_) | ArrayNode::Empty | ArrayNode::String(_) => {
                    Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "MMULT requires numeric values".to_string(),
                    ))
                }
                ArrayNode::Error(e) => Err(CalcResult::new_error(
                    e.clone(),
                    cell,
                    "MMULT received an error value".to_string(),
                )),
            }
        }

        // Pre-coerce both matrices so we fail fast and avoid repeated work.
        let mut a_num = vec![vec![0.0f64; k]; m];
        for i in 0..m {
            if a[i].len() != k {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "MMULT array1 is not rectangular".to_string(),
                );
            }
            for j in 0..k {
                match coerce(&a[i][j], cell) {
                    Ok(v) => a_num[i][j] = v,
                    Err(e) => return e,
                }
            }
        }

        let mut b_num = vec![vec![0.0f64; n]; k];
        for i in 0..k {
            if b[i].len() != n {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "MMULT array2 is not rectangular".to_string(),
                );
            }
            for j in 0..n {
                match coerce(&b[i][j], cell) {
                    Ok(v) => b_num[i][j] = v,
                    Err(e) => return e,
                }
            }
        }

        let mut result: Vec<Vec<ArrayNode>> = Vec::with_capacity(m);
        // Classic matrix multiplication: C[i][j] = sum over p of A[i][p] * B[p][j].
        // Clippy can't see that i and j each address both matrices in the inner
        // loop, so named indices stay clearer than iterator combinators here.
        #[allow(clippy::needless_range_loop)]
        for i in 0..m {
            let mut row = Vec::with_capacity(n);
            for j in 0..n {
                let mut s = 0.0f64;
                for p in 0..k {
                    s += a_num[i][p] * b_num[p][j];
                }
                if s.is_infinite() || s.is_nan() {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "MMULT result overflow".to_string(),
                    );
                }
                row.push(ArrayNode::Number(s));
            }
            result.push(row);
        }

        CalcResult::Array(result)
    }
}
