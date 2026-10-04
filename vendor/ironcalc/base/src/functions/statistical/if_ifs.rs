use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::types::CellReferenceIndex;
use crate::functions::util::build_criteria;
use crate::{
    calc_result::{CalcResult, Range},
    expressions::parser::{ArrayNode, Node},
    expressions::token::Error,
    model::Model,
};

/// A compiled criterion predicate, as returned by `build_criteria`.
type Criterion<'c> = Box<dyn Fn(&CalcResult) -> bool + 'c>;

/// Converts a single array element into the equivalent scalar `CalcResult`,
/// used to feed `build_criteria` from an inline-array criteria argument.
fn array_node_to_calc_result(node: &ArrayNode, cell: CellReferenceIndex) -> CalcResult {
    match node {
        ArrayNode::Number(n) => CalcResult::Number(*n),
        ArrayNode::Boolean(b) => CalcResult::Boolean(*b),
        ArrayNode::String(s) => CalcResult::String(s.clone()),
        ArrayNode::Error(e) => CalcResult::Error {
            error: e.clone(),
            origin: cell,
            message: "".to_string(),
        },
        ArrayNode::Empty => CalcResult::EmptyCell,
    }
}

impl<'a> Model<'a> {
    pub(crate) fn fn_countif(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 2 {
            let arguments = vec![args[0].clone(), args[1].clone()];
            self.fn_countifs(&arguments, cell)
        } else {
            CalcResult::new_args_number_error(cell)
        }
    }

    /// AVERAGEIF(criteria_range, criteria, [average_range])
    /// if average_rage is missing then criteria_range will be used
    pub(crate) fn fn_averageif(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 2 {
            let arguments = vec![args[0].clone(), args[0].clone(), args[1].clone()];
            self.fn_averageifs(&arguments, cell)
        } else if args.len() == 3 {
            let arguments = vec![args[2].clone(), args[0].clone(), args[1].clone()];
            self.fn_averageifs(&arguments, cell)
        } else {
            CalcResult::new_args_number_error(cell)
        }
    }

    // FIXME: This function shares a lot of code with apply_ifs. Can we merge them?
    pub(crate) fn fn_countifs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let args_count = args.len();
        if args_count < 2 || !args_count.is_multiple_of(2) {
            return CalcResult::new_args_number_error(cell);
        }

        let case_count = args_count / 2;
        // NB: this is a beautiful example of the borrow checker
        // The order of these two definitions cannot be swapped.
        let mut criteria = Vec::new();
        let mut fn_criteria = Vec::new();
        let ranges = &mut Vec::new();
        for case_index in 0..case_count {
            let criterion = self.evaluate_node_in_context(&args[case_index * 2 + 1], cell);
            criteria.push(criterion);
            // NB: We cannot do:
            // fn_criteria.push(build_criteria(&criterion));
            // because criterion doesn't live long enough
            let result = self.evaluate_node_in_context(&args[case_index * 2], cell);
            if result.is_error() {
                return result;
            }
            if let CalcResult::Range { left, right } = result {
                if left.sheet != right.sheet {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges are in different sheets".to_string(),
                    );
                }
                // TODO test ranges are of the same size as sum_range
                ranges.push(Range { left, right });
            } else {
                return CalcResult::new_error(Error::VALUE, cell, "Expected a range".to_string());
            }
        }
        for criterion in criteria.iter() {
            fn_criteria.push(build_criteria(criterion, self.locale));
        }

        let mut total = 0.0;
        let first_range = &ranges[0];
        let left_row = first_range.left.row;
        let left_column = first_range.left.column;
        let right_row = first_range.right.row;
        let right_column = first_range.right.column;

        let dimension = match self.workbook.worksheet(first_range.left.sheet) {
            Ok(s) => s.dimension(),
            Err(_) => {
                return CalcResult::new_error(
                    Error::ERROR,
                    cell,
                    format!("Invalid worksheet index: '{}'", first_range.left.sheet),
                )
            }
        };
        let max_row = dimension.max_row;
        let max_column = dimension.max_column;

        let open_row = left_row == 1 && right_row == LAST_ROW;
        let open_column = left_column == 1 && right_column == LAST_COLUMN;

        // The cells beyond the used area are taken as empty without being
        // read; every range depends on them, so they go on record first.
        for range in ranges.iter() {
            let sheet = range.left.sheet;
            let (top, left) = (range.left.row, range.left.column);
            let (bottom, right) = (range.right.row, range.right.column);
            if open_row {
                let first_skipped = top + (max_row + 1 - left_row);
                self.record_seen_empty_range(sheet, first_skipped, left, bottom, right);
            }
            if open_column {
                let first_skipped = left + (max_column + 1 - left_column);
                let last_walked_row = if open_row {
                    top + (max_row - left_row)
                } else {
                    bottom
                };
                self.record_seen_empty_range(sheet, top, first_skipped, last_walked_row, right);
            }
        }

        for row in left_row..right_row + 1 {
            if open_row && row > max_row {
                // If the row is larger than the max row in the sheet then all cells are empty.
                // We compute it only once
                let mut is_true = true;
                for fn_criterion in fn_criteria.iter() {
                    if !fn_criterion(&CalcResult::EmptyCell) {
                        is_true = false;
                        break;
                    }
                }
                if is_true {
                    total += ((LAST_ROW - max_row) * (right_column - left_column + 1)) as f64;
                }
                break;
            }
            for column in left_column..right_column + 1 {
                if open_column && column > max_column {
                    // If the column is larger than the max column in the sheet then all cells are empty.
                    // We compute it only once
                    let mut is_true = true;
                    for fn_criterion in fn_criteria.iter() {
                        if !fn_criterion(&CalcResult::EmptyCell) {
                            is_true = false;
                            break;
                        }
                    }
                    if is_true {
                        total += (LAST_COLUMN - max_column) as f64;
                    }
                    break;
                }
                let mut is_true = true;
                for case_index in 0..case_count {
                    // We check if value in range n meets criterion n
                    let range = &ranges[case_index];
                    let fn_criterion = &fn_criteria[case_index];
                    let value = self.evaluate_cell(CellReferenceIndex {
                        sheet: range.left.sheet,
                        row: range.left.row + row - first_range.left.row,
                        column: range.left.column + column - first_range.left.column,
                    });
                    if !fn_criterion(&value) {
                        is_true = false;
                        break;
                    }
                }
                if is_true {
                    total += 1.0;
                }
            }
        }
        CalcResult::Number(total)
    }

    pub(crate) fn apply_ifs<F>(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        apply: F,
    ) -> Result<(), CalcResult>
    where
        F: FnMut(f64),
    {
        let args_count = args.len();
        if args_count < 3 || args_count.is_multiple_of(2) {
            return Err(CalcResult::new_args_number_error(cell));
        }
        let arg_0 = self.evaluate_node_in_context(&args[0], cell);
        if arg_0.is_error() {
            return Err(arg_0);
        }
        let sum_range = if let CalcResult::Range { left, right } = arg_0 {
            if left.sheet != right.sheet {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Ranges are in different sheets".to_string(),
                ));
            }
            Range { left, right }
        } else {
            return Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expected a range".to_string(),
            ));
        };

        let case_count = (args_count - 1) / 2;
        // NB: this is a beautiful example of the borrow checker
        // The order of these two definitions cannot be swapped.
        let mut criteria = Vec::new();
        let mut fn_criteria = Vec::new();
        let ranges = &mut Vec::new();
        for case_index in 1..=case_count {
            let criterion = self.evaluate_node_in_context(&args[case_index * 2], cell);
            // NB: criterion might be an error. That's ok
            criteria.push(criterion);
            // NB: We cannot do:
            // fn_criteria.push(build_criteria(&criterion));
            // because criterion doesn't live long enough
            let result = self.evaluate_node_in_context(&args[case_index * 2 - 1], cell);
            if result.is_error() {
                return Err(result);
            }
            if let CalcResult::Range { left, right } = result {
                if left.sheet != right.sheet {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges are in different sheets".to_string(),
                    ));
                }
                // TODO test ranges are of the same size as sum_range
                ranges.push(Range { left, right });
            } else {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Expected a range".to_string(),
                ));
            }
        }
        for criterion in criteria.iter() {
            fn_criteria.push(build_criteria(criterion, self.locale));
        }

        self.run_ifs(&sum_range, ranges.as_slice(), &fn_criteria, cell, apply)
    }

    /// Walks `sum_range` and applies `apply` to every numeric cell whose parallel
    /// cell in each criteria range satisfies the matching criterion. `ranges` and
    /// `fn_criteria` are parallel (one criteria range and one predicate per case).
    ///
    /// Shared by [`Model::apply_ifs`] and the array-criteria path of SUMIF.
    pub(crate) fn run_ifs<F>(
        &mut self,
        sum_range: &Range,
        ranges: &[Range],
        fn_criteria: &[Criterion<'_>],
        cell: CellReferenceIndex,
        mut apply: F,
    ) -> Result<(), CalcResult>
    where
        F: FnMut(f64),
    {
        let left_row = sum_range.left.row;
        let left_column = sum_range.left.column;
        let mut right_row = sum_range.right.row;
        let mut right_column = sum_range.right.column;

        match self.clip_to_used_area(
            sum_range.left.sheet,
            left_row,
            left_column,
            right_row,
            right_column,
        ) {
            Ok((r, c)) => {
                right_row = r;
                right_column = c;
            }
            Err(message) => return Err(CalcResult::new_error(Error::ERROR, cell, message)),
        }

        for row in left_row..right_row + 1 {
            for column in left_column..right_column + 1 {
                let mut is_true = true;
                for (range, fn_criterion) in ranges.iter().zip(fn_criteria.iter()) {
                    // We check if value in range n meets criterion n
                    let value = self.evaluate_cell(CellReferenceIndex {
                        sheet: range.left.sheet,
                        row: range.left.row + row - sum_range.left.row,
                        column: range.left.column + column - sum_range.left.column,
                    });
                    if !fn_criterion(&value) {
                        is_true = false;
                        break;
                    }
                }
                if is_true {
                    let v = self.evaluate_cell(CellReferenceIndex {
                        sheet: sum_range.left.sheet,
                        row,
                        column,
                    });
                    match v {
                        CalcResult::Number(n) => apply(n),
                        CalcResult::Error { .. } => return Err(v),
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    }

    /// Evaluates `node` and requires it to be a single-sheet range.
    fn node_to_range(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<Range, CalcResult> {
        let value = self.evaluate_node_in_context(node, cell);
        if value.is_error() {
            return Err(value);
        }
        if let CalcResult::Range { left, right } = value {
            if left.sheet != right.sheet {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Ranges are in different sheets".to_string(),
                ));
            }
            Ok(Range { left, right })
        } else {
            Err(CalcResult::new_error(
                Error::VALUE,
                cell,
                "Expected a range".to_string(),
            ))
        }
    }

    /// SUMIF where the `criteria` argument may be a single value, a range or an
    /// array. A scalar criterion yields a single sum; a range or array criterion
    /// spills one sum per criterion element, preserving the criteria's shape.
    pub(crate) fn sumif(
        &mut self,
        criteria_range: &Node,
        criteria: &Node,
        sum_range: &Node,
        cell: CellReferenceIndex,
    ) -> CalcResult {
        // Collect the criteria into a 2-D grid of scalar values. A scalar
        // criterion takes the ordinary (non-spilling) SUMIFS path.
        let criteria_grid: Vec<Vec<CalcResult>> = match self
            .evaluate_node_in_context(criteria, cell)
        {
            CalcResult::Range { left, right } => {
                if left.sheet != right.sheet {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges are in different sheets".to_string(),
                    );
                }
                let mut grid = Vec::new();
                for r in left.row..=right.row {
                    let mut row = Vec::new();
                    for c in left.column..=right.column {
                        row.push(self.evaluate_cell(CellReferenceIndex {
                            sheet: left.sheet,
                            row: r,
                            column: c,
                        }));
                    }
                    grid.push(row);
                }
                grid
            }
            CalcResult::Array(array) => array
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|node| array_node_to_calc_result(node, cell))
                        .collect()
                })
                .collect(),
            _ => {
                // Single criterion: delegate to SUMIFS, which returns a scalar.
                let arguments = vec![sum_range.clone(), criteria_range.clone(), criteria.clone()];
                return self.fn_sumifs(&arguments, cell);
            }
        };

        // Range/array criteria: resolve the ranges once, then compute one sum
        // per criterion and spill the results.
        let sum_range = match self.node_to_range(sum_range, cell) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let criteria_range = match self.node_to_range(criteria_range, cell) {
            Ok(r) => r,
            Err(e) => return e,
        };

        let mut output: Vec<Vec<ArrayNode>> = Vec::with_capacity(criteria_grid.len());
        for criteria_row in &criteria_grid {
            let mut out_row: Vec<ArrayNode> = Vec::with_capacity(criteria_row.len());
            for criterion in criteria_row {
                let fn_criteria = [build_criteria(criterion, self.locale)];
                let mut total = 0.0;
                let node = match self.run_ifs(
                    &sum_range,
                    std::slice::from_ref(&criteria_range),
                    &fn_criteria,
                    cell,
                    |v| total += v,
                ) {
                    Ok(()) => ArrayNode::Number(total),
                    Err(CalcResult::Error { error, .. }) => ArrayNode::Error(error),
                    Err(_) => ArrayNode::Error(Error::ERROR),
                };
                out_row.push(node);
            }
            output.push(out_row);
        }
        CalcResult::Array(output)
    }

    pub(crate) fn fn_averageifs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let mut total = 0.0;
        let mut count = 0.0;

        let average = |value: f64| {
            total += value;
            count += 1.0;
        };
        if let Err(e) = self.apply_ifs(args, cell, average) {
            return e;
        }

        if count == 0.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "division by 0".to_string(),
            };
        }
        CalcResult::Number(total / count)
    }

    pub(crate) fn fn_minifs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let mut min = f64::INFINITY;
        let apply_min = |value: f64| min = value.min(min);
        if let Err(e) = self.apply_ifs(args, cell, apply_min) {
            return e;
        }

        if min.is_infinite() {
            min = 0.0;
        }
        CalcResult::Number(min)
    }

    pub(crate) fn fn_maxifs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let mut max = -f64::INFINITY;
        let apply_max = |value: f64| max = value.max(max);
        if let Err(e) = self.apply_ifs(args, cell, apply_max) {
            return e;
        }
        if max.is_infinite() {
            max = 0.0;
        }
        CalcResult::Number(max)
    }
}
