mod isomitted;

use crate::functions::Function;
use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
        utils::number_to_column,
    },
    get_all_timezones,
    model::{Model, ParsedDefinedName},
};

#[cfg(not(target_arch = "wasm32"))]
fn get_system() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(target_arch = "wasm32")]
fn get_system() -> String {
    "browser".to_string()
}

impl<'a> Model<'a> {
    pub(crate) fn fn_isnumber(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Number(_) => return CalcResult::Boolean(true),
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_istext(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::String(_) => return CalcResult::Boolean(true),
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_isnontext(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::String(_) => return CalcResult::Boolean(false),
                _ => {
                    return CalcResult::Boolean(true);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_islogical(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Boolean(_) => return CalcResult::Boolean(true),
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_isblank(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::EmptyCell => return CalcResult::Boolean(true),
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_iserror(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Error { .. } => return CalcResult::Boolean(true),
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_iserr(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Error { error, .. } => {
                    if Error::NA == error {
                        return CalcResult::Boolean(false);
                    } else {
                        return CalcResult::Boolean(true);
                    }
                }
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }
    pub(crate) fn fn_isna(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() == 1 {
            match self.evaluate_node_in_context(&args[0], cell) {
                CalcResult::Error {
                    error: Error::NA, ..
                } => {
                    return CalcResult::Boolean(true);
                }
                _ => {
                    return CalcResult::Boolean(false);
                }
            };
        }
        CalcResult::new_args_number_error(cell)
    }

    // Returns true if it is a reference or evaluates to a reference
    // But DOES NOT evaluate
    pub(crate) fn fn_isref(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        CalcResult::Boolean(self.gives_reference(&args[0], cell))
    }

    /// Whether what `node` gives is a reference, as ISREF sees it.
    fn gives_reference(&mut self, node: &Node, cell: CellReferenceIndex) -> bool {
        match node {
            Node::ReferenceKind { .. } | Node::RangeKind { .. } | Node::OpRangeKind { .. } => true,
            // INDEX gives a reference when what it indexes is one, even to a
            // single cell, where what it gives here is the value. So it is
            // not what it gives that is looked at, only whether it fails.
            node @ Node::FunctionKind {
                kind: Function::Index,
                args,
            } => {
                args.first()
                    .is_some_and(|array| self.gives_reference(array, cell))
                    && !self.evaluate_node_with_reference(node, cell).is_error()
            }
            Node::FunctionKind { kind, args: _ } => kind.returns_reference(),
            // A defined name or a variable is a reference if what it stands
            // for is one
            Node::DefinedNameKind(_) | Node::NamedVariableKind { .. } => matches!(
                self.evaluate_node_with_reference(node, cell),
                CalcResult::Range { .. }
            ),
            _ => false,
        }
    }

    pub(crate) fn fn_isodd(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.abs().trunc() as i64,
            Err(s) => return s,
        };
        CalcResult::Boolean(value % 2 == 1)
    }

    pub(crate) fn fn_iseven(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.abs().trunc() as i64,
            Err(s) => return s,
        };
        CalcResult::Boolean(value % 2 == 0)
    }

    // ISFORMULA arg needs to be a reference or something that evaluates to a reference
    pub(crate) fn fn_isformula(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (left, right) = match self.get_reference(&args[0], cell) {
            Ok(range) => (range.left, range.right),
            Err(error) => return error,
        };
        if left.sheet != right.sheet {
            return CalcResult::Error {
                error: Error::ERROR,
                origin: cell,
                message: "3D ranges not supported".to_string(),
            };
        }
        if left.row != right.row && left.column != right.column {
            // FIXME: Implicit intersection or dynamic arrays
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "argument must be a reference to a single cell".to_string(),
            };
        }
        let is_formula = if let Ok(f) = self.get_cell_formula(left.sheet, left.row, left.column) {
            f.is_some()
        } else {
            false
        };
        CalcResult::Boolean(is_formula)
    }

    pub(crate) fn fn_errortype(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Error { error, .. } => {
                match error {
                    Error::NULL => CalcResult::Number(1.0),
                    Error::DIV => CalcResult::Number(2.0),
                    Error::VALUE => CalcResult::Number(3.0),
                    Error::REF => CalcResult::Number(4.0),
                    Error::NAME => CalcResult::Number(5.0),
                    Error::NUM => CalcResult::Number(6.0),
                    Error::NA => CalcResult::Number(7.0),
                    Error::SPILL => CalcResult::Number(9.0),
                    Error::CALC => CalcResult::Number(14.0),
                    // IronCalc specific
                    Error::ERROR => CalcResult::Number(101.0),
                    Error::NIMPL => CalcResult::Number(102.0),
                    Error::CIRC => CalcResult::Number(104.0),
                    // Missing from Excel
                    // #GETTING_DATA => 8
                    // #CONNECT => 10
                    // #BLOCKED => 11
                    // #UNKNOWN => 12
                    // #FIELD => 13
                    // #EXTERNAL => 19
                }
            }
            _ => CalcResult::Error {
                error: Error::NA,
                origin: cell,
                message: "Not an error".to_string(),
            },
        }
    }

    // Excel believes for some reason that TYPE(A1:A7) is an array formula
    // Although we evaluate the same as Excel we cannot, ATM import this from excel
    pub(crate) fn fn_type(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::String(_) => CalcResult::Number(2.0),
            CalcResult::Number(_) => CalcResult::Number(1.0),
            CalcResult::Boolean(_) => CalcResult::Number(4.0),
            CalcResult::Error { .. } => CalcResult::Number(16.0),
            CalcResult::Range { .. } => CalcResult::Number(64.0),
            CalcResult::EmptyCell => CalcResult::Number(1.0),
            CalcResult::EmptyArg => {
                // This cannot happen
                CalcResult::Number(1.0)
            }
            CalcResult::Array(_) => CalcResult::Number(64.0),
            CalcResult::Lambda(_) => CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Lambdas not supported yet".to_string(),
            },
        }
    }
    pub(crate) fn fn_sheet(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count > 1 {
            return CalcResult::new_args_number_error(cell);
        }
        if arg_count == 0 {
            // Sheets are 0-indexed`
            return CalcResult::Number(cell.sheet as f64 + 1.0);
        }
        // The arg could be a defined name or a table
        // let  = &args[0];
        match &args[0] {
            Node::DefinedNameKind((name, scope, _)) => {
                // Let's see if it is a defined name
                if let Some(defined_name) = self
                    .parsed_defined_names
                    .get(&(*scope, name.to_lowercase()))
                {
                    match defined_name {
                        ParsedDefinedName::CellReference(reference) => {
                            return CalcResult::Number(reference.sheet as f64 + 1.0)
                        }
                        ParsedDefinedName::RangeReference(range) => {
                            return CalcResult::Number(range.left.sheet as f64 + 1.0)
                        }
                        ParsedDefinedName::InvalidDefinedNameFormula
                        | ParsedDefinedName::LambdaDefinition(..) => {
                            return CalcResult::Error {
                                error: Error::ERROR,
                                origin: cell,
                                message: "Invalid name".to_string(),
                            };
                        }
                    }
                } else {
                    // This should never happen
                    return CalcResult::Error {
                        error: Error::ERROR,
                        origin: cell,
                        message: "Invalid name".to_string(),
                    };
                }
            }
            Node::TableNameKind(name) => {
                // Now let's see if it is a table
                for (table_name, table) in &self.workbook.tables {
                    if table_name == name {
                        if let Some(sheet_index) = self.get_sheet_index_by_name(&table.sheet_name) {
                            return CalcResult::Number(sheet_index as f64 + 1.0);
                        } else {
                            break;
                        }
                    }
                }
            }
            Node::NamedVariableKind { name, id: _ } => {
                return CalcResult::Error {
                    error: Error::NAME,
                    origin: cell,
                    message: format!("Name not found: {name}"),
                }
            }
            arg => {
                // Now it should be the name of a sheet
                let sheet_name = match self.get_string(arg, cell) {
                    Ok(s) => s,
                    Err(e) => return e,
                };
                if let Some(sheet_index) = self.get_sheet_index_by_name(&sheet_name) {
                    return CalcResult::Number(sheet_index as f64 + 1.0);
                }
            }
        }
        CalcResult::Error {
            error: Error::NA,
            origin: cell,
            message: "Invalid name".to_string(),
        }
    }

    pub(crate) fn fn_n(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Number(n) => n,
            CalcResult::String(_) => 0.0,
            CalcResult::Boolean(f) => {
                if f {
                    1.0
                } else {
                    0.0
                }
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => 0.0,
            error @ CalcResult::Error { .. } => return error,
            CalcResult::Range { .. } => {
                return CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Arrays not supported yet".to_string(),
                }
            }
            CalcResult::Array(_) | CalcResult::Lambda(_) => {
                return CalcResult::Error {
                    error: Error::NIMPL,
                    origin: cell,
                    message: "Arrays not supported yet".to_string(),
                }
            }
        };

        CalcResult::Number(value)
    }

    pub(crate) fn fn_sheets(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count > 1 {
            return CalcResult::new_args_number_error(cell);
        }
        if arg_count == 1 {
            return CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "Sheets function with an argument is not implemented".to_string(),
            };
        }
        let sheet_count = self.workbook.worksheets.len() as f64;
        CalcResult::Number(sheet_count)
    }

    /// CELL(info_type, [reference])
    /// NB: In Excel "info_type" is localized. Here it is always in English.
    pub(crate) fn fn_cell(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count == 0 || arg_count > 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let reference = if arg_count == 2 {
            match self.get_reference(&args[1], cell) {
                // we just take the top-left cell of the reference
                Ok(range) => range.left,
                Err(error) => return error,
            }
        } else {
            CellReferenceIndex {
                sheet: cell.sheet,
                row: cell.row,
                column: cell.column,
            }
        };
        let info_type = match self.get_string(&args[0], cell) {
            Ok(s) => s.to_uppercase(),
            Err(e) => return e,
        };
        match info_type.as_str() {
            "ADDRESS" => {
                if reference.sheet != cell.sheet {
                    return CalcResult::Error {
                        error: Error::NIMPL,
                        origin: cell,
                        message: "References to other sheets not implemented".to_string(),
                    };
                }
                let column = match number_to_column(reference.column) {
                    Some(c) => c,
                    None => {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Invalid column".to_string(),
                        }
                    }
                };
                let address = format!("${}${}", column, reference.row);
                CalcResult::String(address)
            }
            "COL" => CalcResult::Number(reference.column as f64),
            "COLOR" | "FORMAT" | "PARENTHESES" | "PREFIX" | "PROTECT" | "WIDTH" => {
                CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "info_type not implemented".to_string(),
                }
            }
            "CONTENTS" => self.evaluate_cell(reference),
            "FILENAME" => {
                let workbook_name = &self.workbook.name;
                let worksheet_name = match self.workbook.worksheet(reference.sheet) {
                    Ok(ws) => &ws.name,
                    Err(_) => {
                        return CalcResult::Error {
                            error: Error::VALUE,
                            origin: cell,
                            message: "Invalid sheet".to_string(),
                        }
                    }
                };
                CalcResult::String(format!("[{}.xlsx]{}", workbook_name, worksheet_name))
            }
            "ROW" => CalcResult::Number(reference.row as f64),
            "TYPE" => {
                let cell_type = match self.evaluate_cell(reference) {
                    CalcResult::EmptyCell => "b",
                    CalcResult::String(_) => "l",
                    CalcResult::Number(_) => "v",
                    CalcResult::Boolean(_) => "v",
                    CalcResult::Error { .. } => "v",
                    CalcResult::Range { .. } => "v",
                    CalcResult::EmptyArg => "v",
                    CalcResult::Array(_) | CalcResult::Lambda(_) => "v",
                };
                CalcResult::String(cell_type.to_string())
            }
            _ => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Invalid info_type".to_string(),
            },
        }
    }

    /// INFO(text_type)
    /// NB: In Excel "text_type" is localized. Here it is always in English.
    pub(crate) fn fn_info(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let type_text = match self.get_string(&args[0], cell) {
            Ok(s) => s.to_uppercase(),
            Err(e) => return e,
        };
        // We take the release version from the git tag at build time. (v0.7.1-202-g847240b0 for example)
        // See build.rs
        let release = env!("GIT_VERSION");
        match type_text.as_str() {
            "DIRECTORY" | "ORIGIN" | "OSVERSION" => CalcResult::Error {
                error: Error::NIMPL,
                origin: cell,
                message: "type_text not implemented".to_string(),
            },

            // For now we just show the count of sheets in the current workbook
            "NUMFILE" => CalcResult::Number(self.workbook.worksheets.len() as f64),

            // At the moment we always do automatic recalc
            "RECALC" => CalcResult::String("Automatic".to_string()),
            "RELEASE" => CalcResult::String(release.to_string()),
            "SYSTEM" => CalcResult::String(get_system()),
            "TIMEZONE" => CalcResult::String(self.get_timezone()),
            "TIMEZONES" => {
                let mut tzs = get_all_timezones();
                tzs.sort();
                let list: Vec<Vec<ArrayNode>> = tzs
                    .into_iter()
                    .map(|name| vec![ArrayNode::String(name.to_string())])
                    .collect();
                CalcResult::Array(list)
            }
            _ => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Invalid type_text".to_string(),
            },
        }
    }
}
