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
    /// `=TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with])`
    ///
    /// Splits text into a 2-D array using column and/or row delimiters.
    /// Each delimiter argument can be a single string or an array of strings — any
    /// matching delimiter triggers a split.
    ///   * text          – text to split (required)
    ///   * col_delimiter – one or more delimiters that split into columns (required)
    ///   * row_delimiter – one or more delimiters that split into rows (default: no row split)
    ///   * ignore_empty  – TRUE to skip empty segments (default FALSE)
    ///   * match_mode    – 0 = case-sensitive (default), 1 = case-insensitive
    ///   * pad_with      – value to pad short rows (default: #N/A error)
    pub(crate) fn fn_textsplit(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 6 {
            return CalcResult::new_args_number_error(cell);
        }

        let text = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(e) => return e,
        };

        let col_delims = match self.extract_delimiters(&args[1], cell) {
            Ok(d) => d,
            Err(e) => return e,
        };

        // An explicit empty string "" as a delimiter is invalid.
        // An omitted col_delimiter (empty vec) is allowed when row_delimiter is provided.
        if col_delims.iter().any(|d| d.is_empty()) {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "col_delimiter must not be empty string".to_string(),
            );
        }

        let row_delims: Vec<String> = if args.len() >= 3 {
            // A bare empty-arg (omitted) → no row splitting
            let val = self.evaluate_node_in_context(&args[2], cell);
            if matches!(val, CalcResult::EmptyArg) {
                vec![]
            } else {
                match self.extract_delimiters(&args[2], cell) {
                    Ok(d) => d.into_iter().filter(|s| !s.is_empty()).collect(),
                    Err(e) => return e,
                }
            }
        } else {
            vec![]
        };

        if col_delims.is_empty() && row_delims.is_empty() {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "TEXTSPLIT requires at least one delimiter".to_string(),
            );
        }

        let ignore_empty = if args.len() >= 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            false
        };

        let case_insensitive = if args.len() >= 5 {
            match self.get_number(&args[4], cell) {
                Ok(n) => n != 0.0,
                Err(e) => return e,
            }
        } else {
            false
        };

        let pad_with: Option<ArrayNode> = if args.len() >= 6 {
            let val = self.evaluate_node_in_context(&args[5], cell);
            match val {
                CalcResult::EmptyArg => None,
                CalcResult::Number(n) => Some(ArrayNode::Number(n)),
                CalcResult::Boolean(b) => Some(ArrayNode::Boolean(b)),
                CalcResult::String(s) => Some(ArrayNode::String(s)),
                CalcResult::Error { error, .. } => Some(ArrayNode::Error(error)),
                _ => None,
            }
        } else {
            None
        };

        let na_node = ArrayNode::Error(Error::NA);
        let pad_node = pad_with.as_ref().unwrap_or(&na_node);

        // Normalize to comparison strings for optional case-insensitive matching.
        // For ASCII delimiters to_lowercase() is a 1:1 byte mapping, so positions
        // derived from `cmp_text` are valid indices into the original `text`.
        let cmp_text: String;
        let cmp_col_delims: Vec<String>;
        let cmp_row_delims: Vec<String>;
        if case_insensitive {
            cmp_text = text.to_lowercase();
            cmp_col_delims = col_delims.iter().map(|s| s.to_lowercase()).collect();
            cmp_row_delims = row_delims.iter().map(|s| s.to_lowercase()).collect();
        } else {
            cmp_text = text.clone();
            cmp_col_delims = col_delims.clone();
            cmp_row_delims = row_delims.clone();
        }

        let rows_of_cols: Vec<Vec<String>> = if !cmp_row_delims.is_empty() {
            // Split into rows first, then each row into columns.
            let row_parts = split_by_any(&text, &cmp_text, &cmp_row_delims);
            let cmp_row_parts = split_by_any(&cmp_text, &cmp_text, &cmp_row_delims);

            row_parts
                .into_iter()
                .zip(cmp_row_parts)
                .filter_map(|(orig_row, cmp_row_part)| {
                    if ignore_empty && orig_row.is_empty() {
                        return None;
                    }
                    let cols = split_by_any(&orig_row, &cmp_row_part, &cmp_col_delims);
                    let cols = if ignore_empty {
                        cols.into_iter().filter(|s| !s.is_empty()).collect()
                    } else {
                        cols
                    };
                    Some(cols)
                })
                .collect()
        } else {
            // No row delimiter — single row.
            let cols = split_by_any(&text, &cmp_text, &cmp_col_delims);
            let cols = if ignore_empty {
                cols.into_iter().filter(|s| !s.is_empty()).collect()
            } else {
                cols
            };
            vec![cols]
        };

        if rows_of_cols.is_empty() || rows_of_cols.iter().all(|r| r.is_empty()) {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "TEXTSPLIT produced no output".to_string(),
            );
        }

        let max_cols = rows_of_cols.iter().map(|r| r.len()).max().unwrap_or(0);

        let result: Vec<Vec<ArrayNode>> = rows_of_cols
            .into_iter()
            .map(|row| {
                let mut arr: Vec<ArrayNode> = row.into_iter().map(ArrayNode::String).collect();
                while arr.len() < max_cols {
                    arr.push(pad_node.clone());
                }
                arr
            })
            .collect();

        CalcResult::Array(result)
    }

    /// Evaluate a node and return all string values it contains.
    /// Handles single strings, inline arrays (`{"a","b"}`), and range references.
    fn extract_delimiters(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Vec<String>, CalcResult> {
        let result = self.evaluate_node_in_context(node, cell);
        match result {
            CalcResult::String(s) => Ok(vec![s]),
            CalcResult::Number(n) => Ok(vec![n.to_string()]),
            CalcResult::EmptyArg | CalcResult::EmptyCell => Ok(vec![]),
            CalcResult::Array(arr) => {
                let mut delims = Vec::new();
                for row in arr {
                    for item in row {
                        match item {
                            ArrayNode::String(s) => delims.push(s),
                            ArrayNode::Number(n) => delims.push(n.to_string()),
                            ArrayNode::Empty => {}
                            _ => {
                                return Err(CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "delimiter must be a string".to_string(),
                                ))
                            }
                        }
                    }
                }
                Ok(delims)
            }
            CalcResult::Range { left, right } => {
                let range = self.evaluate_range(left, right);
                let mut delims = Vec::new();
                for row in range {
                    for item in row {
                        match item {
                            ArrayNode::String(s) => delims.push(s),
                            ArrayNode::Number(n) => delims.push(n.to_string()),
                            ArrayNode::Empty => {}
                            _ => {
                                return Err(CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "delimiter must be a string".to_string(),
                                ))
                            }
                        }
                    }
                }
                Ok(delims)
            }
            err @ CalcResult::Error { .. } => Err(err),
            _ => Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "delimiter must be a string".to_string(),
            )),
        }
    }
}

/// Split `original` by the first (earliest) occurrence of any non-empty delimiter
/// in `cmp_delims`, using `cmp` (a parallel comparison string, e.g. lowercased) to
/// locate match positions. The same byte offsets are applied to `original`.
///
/// This works correctly as long as `cmp` and `original` share the same byte layout
/// for non-delimiter characters — true for ASCII case-insensitive comparisons.
fn split_by_any(original: &str, cmp: &str, cmp_delims: &[String]) -> Vec<String> {
    let delims: Vec<&str> = cmp_delims
        .iter()
        .map(String::as_str)
        .filter(|s| !s.is_empty())
        .collect();

    if delims.is_empty() {
        return vec![original.to_string()];
    }

    let mut result = Vec::new();
    let mut pos = 0usize;

    loop {
        // Find the earliest match among all delimiters.
        let best = delims
            .iter()
            .filter_map(|d| cmp[pos..].find(d).map(|i| (pos + i, d.len())))
            .min_by_key(|(p, _)| *p);

        match best {
            None => {
                result.push(original[pos..].to_string());
                break;
            }
            Some((match_pos, delim_len)) => {
                result.push(original[pos..match_pos].to_string());
                pos = match_pos + delim_len;
            }
        }
    }

    result
}
