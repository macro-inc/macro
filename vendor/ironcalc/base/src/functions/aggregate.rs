//! MACRO: AGGREGATE, which upstream does not have yet.
//!
//! AGGREGATE(function_num, options, ref1, [ref2], ...)
//! AGGREGATE(function_num, options, array, k)
//!
//! It applies one of nineteen functions to the values of its arguments,
//! leaving out, depending on `options`, error values, hidden rows and the
//! results of other SUBTOTAL and AGGREGATE formulas. The functions themselves
//! are the engine's own, called with an array of the values kept.

use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    functions::Function,
    model::Model,
};

/// What `options` leaves out.
struct Skip {
    nested: bool,
    hidden: bool,
    errors: bool,
}

impl Model<'_> {
    pub(crate) fn fn_aggregate(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let function_num = match self.get_number(&args[0], cell) {
            Ok(number) => number.trunc() as i32,
            Err(error) => return error,
        };
        let options = match self.get_number(&args[1], cell) {
            Ok(number) => number.trunc() as i32,
            Err(error) => return error,
        };
        if !(0..=7).contains(&options) {
            return CalcResult::new_error(Error::VALUE, cell, "Invalid options".to_string());
        }
        let skip = Skip {
            nested: options <= 3,
            hidden: matches!(options, 1 | 3 | 5 | 7),
            errors: matches!(options, 2 | 3 | 6 | 7),
        };
        let function = match function_num {
            1 => Function::Average,
            2 => Function::Count,
            3 => Function::Counta,
            4 => Function::Max,
            5 => Function::Min,
            6 => Function::Product,
            7 => Function::StDevS,
            8 => Function::StDevP,
            9 => Function::Sum,
            10 => Function::VarS,
            11 => Function::VarP,
            12 => Function::Median,
            13 => Function::ModeSingl,
            14 => Function::Large,
            15 => Function::Small,
            16 => Function::PercentileInc,
            17 => Function::QuartileInc,
            18 => Function::PercentileExc,
            19 => Function::QuartileExc,
            _ => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    format!("Invalid function number for AGGREGATE: {function_num}"),
                )
            }
        };
        // The functions that take `k` have the array form: one array and k.
        let (sources, k) = if function_num >= 14 {
            if args.len() != 4 {
                return CalcResult::new_args_number_error(cell);
            }
            (&args[2..3], Some(&args[3]))
        } else {
            (&args[2..], None)
        };
        let counta = function_num == 3;
        let mut values = Vec::new();
        for source in sources {
            if let Err(error) = self.aggregate_values(source, &skip, counta, cell, &mut values) {
                return error;
            }
        }
        if values.is_empty() {
            return match function_num {
                2..=6 | 9 => CalcResult::Number(0.0),
                1 | 7 | 8 | 10 | 11 => {
                    CalcResult::new_error(Error::DIV, cell, "No values".to_string())
                }
                13 => CalcResult::new_error(Error::NA, cell, "No values".to_string()),
                _ => CalcResult::new_error(Error::NUM, cell, "No values".to_string()),
            };
        }
        let mut call = vec![Node::ArrayKind(vec![values])];
        if let Some(k) = k {
            call.push(k.clone());
        }
        self.dispatch_function(&function, &call, cell)
    }

    /// Adds the values of one argument to `values`: numbers, and for COUNTA
    /// anything that is not blank.
    fn aggregate_values(
        &mut self,
        source: &Node,
        skip: &Skip,
        counta: bool,
        cell: CellReferenceIndex,
        values: &mut Vec<ArrayNode>,
    ) -> Result<(), CalcResult> {
        let mut keep = |value: CalcResult| -> Result<(), CalcResult> {
            match value {
                CalcResult::Number(number) => values.push(ArrayNode::Number(number)),
                CalcResult::Error { .. } if skip.errors => {}
                error @ CalcResult::Error { .. } => return Err(error),
                CalcResult::String(text) if counta => values.push(ArrayNode::String(text)),
                CalcResult::Boolean(boolean) if counta => values.push(ArrayNode::Boolean(boolean)),
                _ => {}
            }
            Ok(())
        };
        match self.evaluate_node_with_reference(source, cell) {
            CalcResult::Range { left, right } => {
                if left.sheet != right.sheet {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "Ranges are in different sheets".to_string(),
                    ));
                }
                let (last_row, last_column) = self
                    .clip_to_used_area(left.sheet, left.row, left.column, right.row, right.column)
                    .map_err(|message| CalcResult::new_error(Error::ERROR, cell, message))?;
                for row in left.row..=last_row {
                    if skip.hidden && self.is_row_hidden(left.sheet, row).unwrap_or(false) {
                        continue;
                    }
                    for column in left.column..=last_column {
                        let position = CellReferenceIndex {
                            sheet: left.sheet,
                            row,
                            column,
                        };
                        if skip.nested && self.is_subtotal_formula(position) {
                            continue;
                        }
                        keep(self.evaluate_cell(position))?;
                    }
                }
            }
            CalcResult::Array(array) => {
                for value in array.into_iter().flatten() {
                    keep(match value {
                        ArrayNode::Number(number) => CalcResult::Number(number),
                        ArrayNode::Boolean(boolean) => CalcResult::Boolean(boolean),
                        ArrayNode::String(text) => CalcResult::String(text),
                        ArrayNode::Error(error) => {
                            CalcResult::new_error(error, cell, String::new())
                        }
                        ArrayNode::Empty => CalcResult::EmptyCell,
                    })?;
                }
            }
            value => keep(value)?,
        }
        Ok(())
    }

    /// Whether the cell holds a SUBTOTAL or an AGGREGATE formula.
    fn is_subtotal_formula(&self, position: CellReferenceIndex) -> bool {
        let Some(cell) =
            self.workbook.worksheets[position.sheet as usize].cell(position.row, position.column)
        else {
            return false;
        };
        let Some(formula) = cell.get_formula() else {
            return false;
        };
        matches!(
            self.parsed_formulas[position.sheet as usize][formula as usize]
                .0
                .as_ref(),
            Node::FunctionKind {
                kind: Function::Subtotal | Function::Aggregate,
                ..
            }
        )
    }
}
