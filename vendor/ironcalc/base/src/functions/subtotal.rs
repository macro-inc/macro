use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{parse_range, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    functions::Function,
    model::Model,
};

/// Excel has a complicated way of filtering + hidden rows
/// As a first a approximation a table can either have filtered rows or hidden rows, but not both.
/// Internally hey both will be marked as hidden rows. Hidden rows
/// The behaviour is the same for SUBTOTAL(100s,) => ignore those
/// But changes for the SUBTOTAL(1-11, ) those ignore filtered but take hidden into account.
/// In Excel filters are non-dynamic. Once you apply filters in a table (say value in column 1 should > 20) they
/// stay that way, even if you change the value of the values in the table after the fact.
/// If you try to hide rows in a table with filtered rows they will behave as if filtered
/// // Also subtotals ignore subtotals
///
#[derive(PartialEq)]
enum SubTotalMode {
    Full,
    SkipHidden,
}

#[derive(PartialEq, Debug)]
pub enum CellTableStatus {
    Normal,
    Hidden,
    Filtered,
}

impl<'a> Model<'a> {
    fn get_table_for_cell(&self, sheet_index: u32, row: i32, column: i32) -> bool {
        let worksheet = match self.workbook.worksheet(sheet_index) {
            Ok(ws) => ws,
            Err(_) => return false,
        };
        for table in self.workbook.tables.values() {
            if worksheet.name != table.sheet_name {
                continue;
            }
            // (column, row, column, row)
            if let Ok((column1, row1, column2, row2)) = parse_range(&table.reference) {
                if ((column >= column1) && (column <= column2)) && ((row >= row1) && (row <= row2))
                {
                    return table.has_filters;
                }
            }
        }
        false
    }

    fn cell_hidden_status(
        &self,
        sheet_index: u32,
        row: i32,
        column: i32,
    ) -> Result<CellTableStatus, String> {
        let worksheet = self.workbook.worksheet(sheet_index)?;
        let mut hidden = false;
        for row_style in &worksheet.rows {
            if row_style.r == row {
                hidden = row_style.hidden;
                break;
            }
        }
        if !hidden {
            return Ok(CellTableStatus::Normal);
        }
        // The row is hidden we need to know if the table has filters
        if self.get_table_for_cell(sheet_index, row, column) {
            Ok(CellTableStatus::Filtered)
        } else {
            Ok(CellTableStatus::Hidden)
        }
    }

    // FIXME(TD): This is too much
    fn cell_is_subtotal(&self, sheet_index: u32, row: i32, column: i32) -> bool {
        let cell = match self.workbook.worksheets[sheet_index as usize].cell(row, column) {
            Some(c) => c,
            None => {
                return false;
            }
        };

        match cell.get_formula() {
            Some(f) => {
                let node: &Node = &self.parsed_formulas[sheet_index as usize][f as usize].0;
                matches!(
                    node,
                    Node::FunctionKind {
                        kind: Function::Subtotal,
                        args: _
                    }
                )
            }
            None => false,
        }
    }

    fn subtotal_get_values(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> Result<Vec<f64>, CalcResult> {
        let mut result: Vec<f64> = Vec::new();
        for arg in args {
            match arg {
                Node::FunctionKind {
                    kind: Function::Subtotal,
                    args: _,
                } => {
                    // skip
                }
                _ => {
                    match self.evaluate_node_with_reference(arg, cell) {
                        CalcResult::String(_) | CalcResult::Boolean(_) => {
                            // Skip
                        }
                        CalcResult::Number(f) => result.push(f),
                        error @ CalcResult::Error { .. } => {
                            return Err(error);
                        }
                        CalcResult::Range { left, right } => {
                            if left.sheet != right.sheet {
                                return Err(CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "Ranges are in different sheets".to_string(),
                                ));
                            }
                            // We are not expecting subtotal to have open ranges
                            let row1 = left.row;
                            let row2 = right.row;
                            let column1 = left.column;
                            let column2 = right.column;

                            for row in row1..=row2 {
                                let cell_status = self
                                    .cell_hidden_status(left.sheet, row, column1)
                                    .map_err(|message| {
                                        CalcResult::new_error(Error::ERROR, cell, message)
                                    })?;
                                if cell_status == CellTableStatus::Filtered {
                                    continue;
                                }
                                if mode == SubTotalMode::SkipHidden
                                    && cell_status == CellTableStatus::Hidden
                                {
                                    continue;
                                }
                                for column in column1..=column2 {
                                    if self.cell_is_subtotal(left.sheet, row, column) {
                                        continue;
                                    }
                                    match self.evaluate_cell(CellReferenceIndex {
                                        sheet: left.sheet,
                                        row,
                                        column,
                                    }) {
                                        CalcResult::Number(value) => {
                                            result.push(value);
                                        }
                                        error @ CalcResult::Error { .. } => return Err(error),
                                        _ => {
                                            // We ignore booleans and strings
                                        }
                                    }
                                }
                            }
                        }
                        CalcResult::EmptyCell | CalcResult::EmptyArg => result.push(0.0),
                        CalcResult::Array(_) | CalcResult::Lambda(_) => {
                            return Err(CalcResult::Error {
                                error: Error::NIMPL,
                                origin: cell,
                                message: "Arrays not supported yet".to_string(),
                            })
                        }
                    }
                }
            }
        }
        Ok(result)
    }

    pub(crate) fn fn_subtotal(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f.trunc() as i32,
            Err(s) => return s,
        };
        match value {
            1 => self.subtotal_average(&args[1..], cell, SubTotalMode::Full),
            2 => self.subtotal_count(&args[1..], cell, SubTotalMode::Full),
            3 => self.subtotal_counta(&args[1..], cell, SubTotalMode::Full),
            4 => self.subtotal_max(&args[1..], cell, SubTotalMode::Full),
            5 => self.subtotal_min(&args[1..], cell, SubTotalMode::Full),
            6 => self.subtotal_product(&args[1..], cell, SubTotalMode::Full),
            7 => self.subtotal_stdevs(&args[1..], cell, SubTotalMode::Full),
            8 => self.subtotal_stdevp(&args[1..], cell, SubTotalMode::Full),
            9 => self.subtotal_sum(&args[1..], cell, SubTotalMode::Full),
            10 => self.subtotal_vars(&args[1..], cell, SubTotalMode::Full),
            11 => self.subtotal_varp(&args[1..], cell, SubTotalMode::Full),
            101 => self.subtotal_average(&args[1..], cell, SubTotalMode::SkipHidden),
            102 => self.subtotal_count(&args[1..], cell, SubTotalMode::SkipHidden),
            103 => self.subtotal_counta(&args[1..], cell, SubTotalMode::SkipHidden),
            104 => self.subtotal_max(&args[1..], cell, SubTotalMode::SkipHidden),
            105 => self.subtotal_min(&args[1..], cell, SubTotalMode::SkipHidden),
            106 => self.subtotal_product(&args[1..], cell, SubTotalMode::SkipHidden),
            107 => self.subtotal_stdevs(&args[1..], cell, SubTotalMode::SkipHidden),
            108 => self.subtotal_stdevp(&args[1..], cell, SubTotalMode::SkipHidden),
            109 => self.subtotal_sum(&args[1..], cell, SubTotalMode::SkipHidden),
            110 => self.subtotal_vars(&args[1..], cell, SubTotalMode::Full),
            111 => self.subtotal_varp(&args[1..], cell, SubTotalMode::Full),
            _ => CalcResult::new_error(
                Error::VALUE,
                cell,
                format!("Invalid value for SUBTOTAL: {value}"),
            ),
        }
    }

    fn subtotal_vars(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        let l = values.len();
        for value in &values {
            result += value;
        }
        if l < 2 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by 0!".to_string(),
            };
        }
        // average
        let average = result / (l as f64);
        let mut result = 0.0;
        for value in &values {
            result += (value - average).powi(2) / (l as f64 - 1.0)
        }

        CalcResult::Number(result)
    }

    fn subtotal_varp(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        let l = values.len();
        for value in &values {
            result += value;
        }
        if l == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by 0!".to_string(),
            };
        }
        // average
        let average = result / (l as f64);
        let mut result = 0.0;
        for value in &values {
            result += (value - average).powi(2) / (l as f64)
        }
        CalcResult::Number(result)
    }

    fn subtotal_stdevs(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        let l = values.len();
        for value in &values {
            result += value;
        }
        if l < 2 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by 0!".to_string(),
            };
        }
        // average
        let average = result / (l as f64);
        let mut result = 0.0;
        for value in &values {
            result += (value - average).powi(2) / (l as f64 - 1.0)
        }

        CalcResult::Number(result.sqrt())
    }

    fn subtotal_stdevp(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        let l = values.len();
        for value in &values {
            result += value;
        }
        if l == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by 0!".to_string(),
            };
        }
        // average
        let average = result / (l as f64);
        let mut result = 0.0;
        for value in &values {
            result += (value - average).powi(2) / (l as f64)
        }
        CalcResult::Number(result.sqrt())
    }

    fn subtotal_counta(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let mut counta = 0;
        for arg in args {
            match arg {
                Node::FunctionKind {
                    kind: Function::Subtotal,
                    args: _,
                } => {
                    // skip
                }
                _ => {
                    match self.evaluate_node_with_reference(arg, cell) {
                        CalcResult::EmptyCell | CalcResult::EmptyArg => {
                            // skip
                        }
                        CalcResult::Range { left, right } => {
                            if left.sheet != right.sheet {
                                return CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "Ranges are in different sheets".to_string(),
                                );
                            }
                            // We are not expecting subtotal to have open ranges
                            let row1 = left.row;
                            let row2 = right.row;
                            let column1 = left.column;
                            let column2 = right.column;

                            for row in row1..=row2 {
                                let cell_status = match self
                                    .cell_hidden_status(left.sheet, row, column1)
                                {
                                    Ok(s) => s,
                                    Err(message) => {
                                        return CalcResult::new_error(Error::ERROR, cell, message);
                                    }
                                };
                                if cell_status == CellTableStatus::Filtered {
                                    continue;
                                }
                                if mode == SubTotalMode::SkipHidden
                                    && cell_status == CellTableStatus::Hidden
                                {
                                    continue;
                                }
                                for column in column1..=column2 {
                                    if self.cell_is_subtotal(left.sheet, row, column) {
                                        continue;
                                    }
                                    match self.evaluate_cell(CellReferenceIndex {
                                        sheet: left.sheet,
                                        row,
                                        column,
                                    }) {
                                        CalcResult::EmptyCell | CalcResult::EmptyArg => {
                                            // skip
                                        }
                                        _ => counta += 1,
                                    }
                                }
                            }
                        }
                        CalcResult::String(_)
                        | CalcResult::Number(_)
                        | CalcResult::Boolean(_)
                        | CalcResult::Error { .. } => counta += 1,
                        CalcResult::Array(_) | CalcResult::Lambda(_) => {
                            return CalcResult::Error {
                                error: Error::NIMPL,
                                origin: cell,
                                message: "Arrays not supported yet".to_string(),
                            }
                        }
                    }
                }
            }
        }
        CalcResult::Number(counta as f64)
    }

    fn subtotal_count(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let mut count = 0;
        for arg in args {
            match arg {
                Node::FunctionKind {
                    kind: Function::Subtotal,
                    args: _,
                } => {
                    // skip
                }
                _ => {
                    match self.evaluate_node_with_reference(arg, cell) {
                        CalcResult::Range { left, right } => {
                            if left.sheet != right.sheet {
                                return CalcResult::new_error(
                                    Error::VALUE,
                                    cell,
                                    "Ranges are in different sheets".to_string(),
                                );
                            }
                            // We are not expecting subtotal to have open ranges
                            let row1 = left.row;
                            let row2 = right.row;
                            let column1 = left.column;
                            let column2 = right.column;

                            for row in row1..=row2 {
                                let cell_status = match self
                                    .cell_hidden_status(left.sheet, row, column1)
                                {
                                    Ok(s) => s,
                                    Err(message) => {
                                        return CalcResult::new_error(Error::ERROR, cell, message);
                                    }
                                };
                                if cell_status == CellTableStatus::Filtered {
                                    continue;
                                }
                                if mode == SubTotalMode::SkipHidden
                                    && cell_status == CellTableStatus::Hidden
                                {
                                    continue;
                                }
                                for column in column1..=column2 {
                                    if self.cell_is_subtotal(left.sheet, row, column) {
                                        continue;
                                    }
                                    if let CalcResult::Number(_) =
                                        self.evaluate_cell(CellReferenceIndex {
                                            sheet: left.sheet,
                                            row,
                                            column,
                                        })
                                    {
                                        count += 1;
                                    }
                                }
                            }
                        }
                        // This hasn't been tested
                        CalcResult::Number(_) => count += 1,
                        _ => {}
                    }
                }
            }
        }
        CalcResult::Number(count as f64)
    }

    fn subtotal_average(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        let l = values.len();
        for value in values {
            result += value;
        }
        if l == 0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Division by 0!".to_string(),
            };
        }
        CalcResult::Number(result / (l as f64))
    }

    fn subtotal_sum(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 0.0;
        for value in values {
            result += value;
        }
        CalcResult::Number(result)
    }

    fn subtotal_product(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = 1.0;
        for value in values {
            result *= value;
        }
        CalcResult::Number(result)
    }

    fn subtotal_max(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = f64::NAN;
        for value in values {
            result = value.max(result);
        }
        if result.is_nan() {
            return CalcResult::Number(0.0);
        }
        CalcResult::Number(result)
    }

    fn subtotal_min(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
        mode: SubTotalMode,
    ) -> CalcResult {
        let values = match self.subtotal_get_values(args, cell, mode) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut result = f64::NAN;
        for value in values {
            result = value.min(result);
        }
        if result.is_nan() {
            return CalcResult::Number(0.0);
        }
        CalcResult::Number(result)
    }
}
