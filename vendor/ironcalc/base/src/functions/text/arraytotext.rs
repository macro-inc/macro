// DOLLAR, FIXED, NUMBERVALUE, PROPER, REPLACE, ARRAYTOTEXT

use crate::{
    calc_result::CalcResult,
    expressions::{parser::ArrayNode, parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

impl<'a> Model<'a> {
    /// ARRAYTOTEXT(array, [format])
    /// format=0 (default, concise): values joined with "," (columns) and ";" (rows)
    /// format=1 (strict): same but wrapped in {} and strings are quoted
    pub(crate) fn fn_arraytotext(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let format = if args.len() == 2 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f.floor() as i32,
                Err(e) => return e,
            }
        } else {
            0
        };
        if format != 0 && format != 1 {
            return CalcResult::new_error(Error::VALUE, cell, "format must be 0 or 1".to_string());
        }
        let strict = format == 1;

        let array = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::Range { left, right } => self.evaluate_range(left, right),
            CalcResult::Array(a) => a,
            CalcResult::Number(n) => {
                return CalcResult::String(format_array_value(&ArrayNode::Number(n), strict));
            }
            CalcResult::String(s) => {
                return CalcResult::String(if strict {
                    format!("\"{}\"", s.replace('"', "\"\""))
                } else {
                    s
                });
            }
            CalcResult::Boolean(b) => {
                return CalcResult::String(if b {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                });
            }
            CalcResult::EmptyCell | CalcResult::EmptyArg => {
                return CalcResult::String(String::new());
            }
            error @ CalcResult::Error { .. } => return error,
            CalcResult::Lambda(_) => {
                return CalcResult::new_error(
                    Error::VALUE,
                    cell,
                    "Lambda not supported".to_string(),
                );
            }
        };

        let result = if strict {
            // Strict: {col1,col2;row2col1,row2col2}
            let rows: Vec<String> = array
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|v| format_array_value(v, true))
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .collect();
            format!("{{{}}}", rows.join(";"))
        } else {
            // Concise: flatten all elements row-by-row, join with ", "
            let elements: Vec<String> = array
                .iter()
                .flat_map(|row| row.iter().map(|v| format_array_value(v, false)))
                .collect();
            elements.join(", ")
        };
        CalcResult::String(result)
    }
}

fn format_array_value(node: &ArrayNode, strict: bool) -> String {
    match node {
        ArrayNode::Number(n) => {
            if *n == n.floor() && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                format!("{}", n)
            }
        }
        ArrayNode::Boolean(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        ArrayNode::String(s) => {
            if strict {
                format!("\"{}\"", s.replace('"', "\"\""))
            } else {
                s.clone()
            }
        }
        ArrayNode::Error(e) => format!("{}", e),
        ArrayNode::Empty => String::new(),
    }
}
