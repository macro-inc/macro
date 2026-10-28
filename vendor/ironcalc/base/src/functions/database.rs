use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    formatter::format::parse_formatted_number,
    Model,
};

use super::util::{compare_values, from_wildcard_to_regex, result_matches_regex};

impl<'a> Model<'a> {
    // =DAVERAGE(database, field, criteria)
    pub(crate) fn fn_daverage(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut sum = 0.0f64;
        let mut count = 0usize;

        let mut row = db_left.row + 1; // skip header
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if let CalcResult::Number(n) = v {
                    if n.is_finite() {
                        sum += n;
                        count += 1;
                    }
                }
            }
            row += 1;
        }

        if count == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "No numeric values matched criteria".to_string(),
            };
        }

        CalcResult::Number(sum / count as f64)
    }

    // =DCOUNT(database, field, criteria)
    // Counts numeric entries in the field for rows that match criteria
    pub(crate) fn fn_dcount(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut count = 0usize;
        let mut row = db_left.row + 1; // skip header
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if matches!(v, CalcResult::Number(_)) {
                    count += 1;
                }
            }
            row += 1;
        }

        CalcResult::Number(count as f64)
    }

    // =DGET(database, field, criteria)
    // Returns the (single) field value for the unique matching row
    pub(crate) fn fn_dget(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut result: Option<CalcResult> = None;
        let mut matches = 0usize;

        let mut row = db_left.row + 1;
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                matches += 1;
                if matches > 1 {
                    return CalcResult::Error {
                        error: Error::NUM,
                        origin: cell,
                        message: "More than one matching record".to_string(),
                    };
                }
                result = Some(self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                }));
            }
            row += 1;
        }

        match (matches, result) {
            (0, _) | (_, None) => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No matching record".to_string(),
            },
            (_, Some(v)) => v,
        }
    }

    // =DMAX(database, field, criteria)
    pub(crate) fn fn_dmax(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.db_extreme(args, cell, true)
    }

    // =DMIN(database, field, criteria)
    pub(crate) fn fn_dmin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        self.db_extreme(args, cell, false)
    }

    // =DSUM(database, field, criteria)
    pub(crate) fn fn_dsum(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut sum = 0.0;

        // skip header
        let mut row = db_left.row + 1;
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if let CalcResult::Number(n) = v {
                    if n.is_finite() {
                        sum += n;
                    }
                }
            }
            row += 1;
        }

        CalcResult::Number(sum)
    }

    // =DCOUNTA(database, field, criteria)
    // Counts non-empty entries (any type) in the field for rows that match criteria
    pub(crate) fn fn_dcounta(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut count = 0;
        for row in (db_left.row + 1)..=db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if !matches!(v, CalcResult::EmptyCell | CalcResult::EmptyArg) {
                    count += 1;
                }
            }
        }

        CalcResult::Number(count as f64)
    }

    // =DPRODUCT(database, field, criteria)
    pub(crate) fn fn_dproduct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut product = 1.0f64;
        let mut has_numeric = false;

        let mut row = db_left.row + 1; // skip header
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if let CalcResult::Number(n) = v {
                    if n.is_finite() {
                        product *= n;
                        has_numeric = true;
                    }
                }
            }
            row += 1;
        }

        // Excel returns 0 when no rows / no numeric values match for DPRODUCT
        if has_numeric {
            CalcResult::Number(product)
        } else {
            CalcResult::Number(0.0)
        }
    }

    // Small internal helper for DSTDEV / DVAR
    // Collects sum, sum of squares, and count of numeric values in the field
    // for rows that match the criteria.
    fn db_numeric_stats(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Result<(f64, f64, usize), CalcResult> {
        if args.len() != 3 {
            return Err(CalcResult::new_args_number_error(cell));
        }

        let (db_left, db_right) = {
            let r = self.get_reference(&args[0], cell)?;
            (r.left, r.right)
        };

        let field_col = self.resolve_db_field_column(db_left, db_right, &args[1], cell)?;

        let criteria = {
            let r = self.get_reference(&args[2], cell)?;
            (r.left, r.right)
        };

        if db_right.row <= db_left.row {
            // no data rows
            return Err(CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            });
        }

        let mut sum = 0.0f64;
        let mut sumsq = 0.0f64;
        let mut count = 0usize;

        let mut row = db_left.row + 1; // skip header
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if let CalcResult::Number(n) = v {
                    if n.is_finite() {
                        sum += n;
                        sumsq += n * n;
                        count += 1;
                    }
                }
            }
            row += 1;
        }

        Ok((sum, sumsq, count))
    }

    // =DSTDEV(database, field, criteria)
    // Sample standard deviation of matching numeric values
    pub(crate) fn fn_dstdev(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (sum, sumsq, count) = match self.db_numeric_stats(args, cell) {
            Ok(stats) => stats,
            Err(e) => return e,
        };

        // Excel behaviour: #DIV/0! if 0 or 1 numeric values match
        if count < 2 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Not enough numeric values matched criteria".to_string(),
            };
        }

        let n = count as f64;
        let var = (sumsq - (sum * sum) / n) / (n - 1.0);
        let var = if var < 0.0 { 0.0 } else { var };
        CalcResult::Number(var.sqrt())
    }

    // =DVAR(database, field, criteria)
    // Sample variance of matching numeric values
    pub(crate) fn fn_dvar(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (sum, sumsq, count) = match self.db_numeric_stats(args, cell) {
            Ok(stats) => stats,
            Err(e) => return e,
        };

        // Excel behaviour: #DIV/0! if 0 or 1 numeric values match
        if count < 2 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Not enough numeric values matched criteria".to_string(),
            };
        }

        let n = count as f64;
        let var = (sumsq - (sum * sum) / n) / (n - 1.0);
        let var = if var < 0.0 { 0.0 } else { var };
        CalcResult::Number(var)
    }

    // =DSTDEVP(database, field, criteria)
    // Population standard deviation of matching numeric values
    pub(crate) fn fn_dstdevp(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (sum, sumsq, count) = match self.db_numeric_stats(args, cell) {
            Ok(stats) => stats,
            Err(e) => return e,
        };

        // Excel behaviour: #DIV/0! if no numeric values match
        if count == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "No numeric values matched criteria".to_string(),
            };
        }

        let n = count as f64;
        let var = (sumsq - (sum * sum) / n) / n;
        let var = if var < 0.0 { 0.0 } else { var };
        CalcResult::Number(var.sqrt())
    }

    // =DVARP(database, field, criteria)
    // Population variance of matching numeric values
    pub(crate) fn fn_dvarp(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (sum, sumsq, count) = match self.db_numeric_stats(args, cell) {
            Ok(stats) => stats,
            Err(e) => return e,
        };

        // Excel behaviour: #DIV/0! if no numeric values match
        if count == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "No numeric values matched criteria".to_string(),
            };
        }

        let n = count as f64;
        let var = (sumsq - (sum * sum) / n) / n;
        let var = if var < 0.0 { 0.0 } else { var };
        CalcResult::Number(var)
    }

    /// Resolve the "field" (2nd arg) to an absolute column index (i32) within the sheet.
    /// Field can be a number (1-based index) or a header name (case-insensitive).
    /// Returns the absolute column index, not a 1-based offset within the database range.
    fn resolve_db_field_column(
        &mut self,
        db_left: CellReferenceIndex,
        db_right: CellReferenceIndex,
        field_arg: &Node,
        cell: CellReferenceIndex,
    ) -> Result<i32, CalcResult> {
        let field_column_name = match self.evaluate_node_in_context(field_arg, cell) {
            CalcResult::String(s) => s.to_lowercase(),
            CalcResult::Number(index) => {
                let index = index.floor() as i32;
                if index < 1 || db_left.column + index - 1 > db_right.column {
                    return Err(CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: "Field index out of range".to_string(),
                    });
                }
                return Ok(db_left.column + index - 1);
            }
            CalcResult::Boolean(b) => {
                return if b {
                    Ok(db_left.column)
                } else {
                    // Index 0 is out of range
                    Err(CalcResult::Error {
                        error: Error::VALUE,
                        origin: cell,
                        message: "Invalid field specifier".to_string(),
                    })
                };
            }
            error @ CalcResult::Error { .. } => {
                return Err(error);
            }
            CalcResult::Range { .. } => {
                return Err(CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Arrays not supported yet".to_string(),
                })
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => "".to_string(),
            CalcResult::Array(_) | CalcResult::Lambda(_) => {
                return Err(CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Arrays not supported yet".to_string(),
                })
            }
        };

        // We search in the database a column whose header matches field_column_name
        for column in db_left.column..=db_right.column {
            let v = self.evaluate_cell(CellReferenceIndex {
                sheet: db_left.sheet,
                row: db_left.row,
                column,
            });
            match &v {
                CalcResult::String(s) => {
                    if s.to_lowercase() == field_column_name {
                        return Ok(column);
                    }
                }
                CalcResult::Number(n) => {
                    if field_column_name == n.to_string() {
                        return Ok(column);
                    }
                }
                CalcResult::Boolean(b) => {
                    if field_column_name == b.to_string() {
                        return Ok(column);
                    }
                }
                CalcResult::Error { .. }
                | CalcResult::Range { .. }
                | CalcResult::EmptyCell
                | CalcResult::EmptyArg
                | CalcResult::Array(_)
                | CalcResult::Lambda(_) => {}
            }
        }

        Err(CalcResult::Error {
            error: Error::VALUE,
            origin: cell,
            message: "Field header not found".to_string(),
        })
    }

    /// Check whether a database row matches the criteria range.
    /// Criteria logic: OR across criteria rows; AND across columns within a row.
    fn db_row_matches_criteria(
        &mut self,
        db_left: CellReferenceIndex,
        db_right: CellReferenceIndex,
        row: i32,
        criteria: (CellReferenceIndex, CellReferenceIndex),
    ) -> bool {
        let (c_left, c_right) = criteria;

        // Read criteria headers (first row of criteria range)
        // Map header name (lowercased) -> db column (if exists)
        let mut crit_cols: Vec<i32> = Vec::new();
        let mut header_count = 0;
        // We cover the criteria table:
        //  headerA | headerB | ...
        //  critA1  | critA2  | ...
        //  critB1  | critB2  | ...
        //  ...
        for column in c_left.column..=c_right.column {
            let cell = CellReferenceIndex {
                sheet: c_left.sheet,
                row: c_left.row,
                column,
            };
            let criteria_header = self.evaluate_cell(cell);
            if let Ok(s) = self.cast_to_string(criteria_header, cell) {
                // Non-empty string header. If the header is non string we skip it
                header_count += 1;
                let wanted = s.to_lowercase();

                // Find corresponding Database column
                let mut found = false;
                for db_column in db_left.column..=db_right.column {
                    let db_header = self.evaluate_cell(CellReferenceIndex {
                        sheet: db_left.sheet,
                        row: db_left.row,
                        column: db_column,
                    });
                    if let Ok(hs) = self.cast_to_string(db_header, cell) {
                        if hs.to_lowercase() == wanted {
                            crit_cols.push(db_column);
                            found = true;
                            break;
                        }
                    }
                }
                if !found {
                    // that means the criteria column has no matching DB column
                    // If the criteria condition is empty then we remove this condition
                    // otherwise this condition can never be satisfied
                    // We evaluate all criteria rows to see if any is non-empty
                    let mut has_non_empty = false;
                    for r in (c_left.row + 1)..=c_right.row {
                        let ccell = self.evaluate_cell(CellReferenceIndex {
                            sheet: c_left.sheet,
                            row: r,
                            column,
                        });
                        if !matches!(ccell, CalcResult::EmptyCell | CalcResult::EmptyArg) {
                            has_non_empty = true;
                            break;
                        }
                    }
                    if has_non_empty {
                        // This criteria column can never be satisfied
                        header_count -= 1;
                    }
                }
            };
        }

        if c_right.row <= c_left.row {
            // If no criteria rows (only headers), everything matches
            return true;
        }

        if header_count == 0 {
            // If there are not "String" headers, nothing matches
            // NB: There might be String headers that do not match any DB columns,
            // in that case everything matches.
            return false;
        }

        // Evaluate each criteria row (OR)
        for r in (c_left.row + 1)..=c_right.row {
            // AND across columns for this criteria row
            let mut and_ok = true;

            for (offset, db_col) in crit_cols.iter().enumerate() {
                // Criteria cell
                let ccell = self.evaluate_cell(CellReferenceIndex {
                    sheet: c_left.sheet,
                    row: r,
                    column: c_left.column + offset as i32,
                });

                // Empty criteria cell -> ignored
                if matches!(ccell, CalcResult::EmptyCell | CalcResult::EmptyArg) {
                    continue;
                }

                // Database value for this row/column
                let db_val = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: *db_col,
                });

                if !self.criteria_cell_matches(&db_val, &ccell) {
                    and_ok = false;
                    break;
                }
            }

            if and_ok {
                // This criteria row satisfied (OR)
                return true;
            }
        }

        // none matched
        false
    }

    /// Implements Excel-like criteria matching for a single value.
    /// Supports prefixes: <>, >=, <=, >, <, = ; wildcards * and ? for string equals.
    fn criteria_cell_matches(&self, db_val: &CalcResult, crit_cell: &CalcResult) -> bool {
        // Convert the criteria cell to a string for operator parsing if possible,
        // otherwise fall back to equality via compare_values.

        let mut criteria = match crit_cell {
            CalcResult::String(s) => s.trim().to_string(),
            CalcResult::Number(n) => {
                // treat as equality with number
                return match db_val {
                    CalcResult::Number(v) => (*v - *n).abs() <= f64::EPSILON,
                    _ => false,
                };
            }
            CalcResult::Boolean(b) => {
                // check equality with boolean
                return match db_val {
                    CalcResult::Boolean(v) => *v == *b,
                    _ => false,
                };
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => "".to_string(),
            CalcResult::Error { .. } => return false,
            CalcResult::Range { .. } | CalcResult::Array(_) | CalcResult::Lambda(_) => {
                return false
            }
        };

        // Detect operator prefix
        let mut op = "="; // default equality (with wildcard semantics for strings)
        let prefixes = ["<>", ">=", "<=", ">", "<", "="];
        for p in prefixes.iter() {
            if criteria.starts_with(p) {
                op = p;
                criteria = criteria[p.len()..].trim().to_string();
                break;
            }
        }

        let formatted_number = parse_formatted_number(&criteria, &[], self.locale);

        match op {
            ">" | ">=" | "<" | "<=" => {
                if let Ok((t, _)) = formatted_number {
                    // numeric comparison
                    if let CalcResult::Number(n) = db_val {
                        match op {
                            ">" => *n > t,
                            ">=" => *n >= t,
                            "<" => *n < t,
                            "<=" => *n <= t,
                            _ => false,
                        }
                    } else {
                        false
                    }
                } else {
                    // string comparison (case-insensitive) using compare_values semantics
                    let rhs = CalcResult::String(criteria.to_lowercase());
                    let lhs = match db_val {
                        CalcResult::String(s) => CalcResult::String(s.to_lowercase()),
                        x => x.clone(),
                    };
                    let c = compare_values(&lhs, &rhs);
                    match op {
                        ">" => c > 0,
                        ">=" => c >= 0,
                        "<" => c < 0,
                        "<=" => c <= 0,
                        _ => false,
                    }
                }
            }
            "<>" => {
                // not equal (with wildcard semantics for strings)
                // If rhs has wildcards and db_val is string, do regex; else use compare_values != 0
                if let CalcResult::String(s) = db_val {
                    if criteria.contains('*') || criteria.contains('?') {
                        if let Ok(re) = from_wildcard_to_regex(&criteria.to_lowercase(), true) {
                            return !result_matches_regex(
                                &CalcResult::String(s.to_lowercase()),
                                &re,
                            );
                        }
                    }
                }
                let rhs = if let Ok((n, _)) = formatted_number {
                    CalcResult::Number(n)
                } else {
                    CalcResult::String(criteria.to_lowercase())
                };
                let lhs = match db_val {
                    CalcResult::String(s) => CalcResult::String(s.to_lowercase()),
                    x => x.clone(),
                };
                compare_values(&lhs, &rhs) != 0
            }
            _ => {
                // equality. For strings, support wildcards (*, ?)
                if let Ok((n, _)) = formatted_number {
                    // numeric equals
                    if let CalcResult::Number(m) = db_val {
                        (*m - n).abs() <= f64::EPSILON
                    } else {
                        compare_values(db_val, &CalcResult::Number(n)) == 0
                    }
                } else {
                    // textual/boolean equals (case-insensitive), wildcard-enabled for strings
                    if let CalcResult::String(s) = db_val {
                        if criteria.contains('*') || criteria.contains('?') {
                            if let Ok(re) = from_wildcard_to_regex(&criteria.to_lowercase(), true) {
                                return result_matches_regex(
                                    &CalcResult::String(s.to_lowercase()),
                                    &re,
                                );
                            }
                        }
                        // This is weird but we only need to check if "starts with" for equality
                        return s.to_lowercase().starts_with(&criteria.to_lowercase());
                    }
                    // Fallback: compare_values equality
                    compare_values(db_val, &CalcResult::String(criteria.to_lowercase())) == 0
                }
            }
        }
    }

    /// Shared implementation for DMAX/DMIN
    fn db_extreme(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        want_max: bool,
    ) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }

        let (db_left, db_right) = match self.get_reference(&args[0], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        let field_col = match self.resolve_db_field_column(db_left, db_right, &args[1], cell) {
            Ok(c) => c,
            Err(e) => return e,
        };

        let criteria = match self.get_reference(&args[2], cell) {
            Ok(r) => (r.left, r.right),
            Err(e) => return e,
        };

        if db_right.row <= db_left.row {
            // no data rows
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "No data rows in database".to_string(),
            };
        }

        let mut best: Option<f64> = None;

        let mut row = db_left.row + 1;
        while row <= db_right.row {
            if self.db_row_matches_criteria(db_left, db_right, row, criteria) {
                let v = self.evaluate_cell(CellReferenceIndex {
                    sheet: db_left.sheet,
                    row,
                    column: field_col,
                });
                if let CalcResult::Number(value) = v {
                    if value.is_finite() {
                        best = Some(match best {
                            None => value,
                            Some(cur) => {
                                if want_max {
                                    value.max(cur)
                                } else {
                                    value.min(cur)
                                }
                            }
                        });
                    }
                }
            }
            row += 1;
        }

        match best {
            Some(v) => CalcResult::Number(v),
            None => CalcResult::Number(0.0),
        }
    }
}
