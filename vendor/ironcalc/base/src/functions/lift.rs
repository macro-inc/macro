//! MACRO: element-by-element evaluation of single-value parameters.
//!
//! Excel evaluates a function once per element when a range or an array
//! reaches a parameter that takes a single value: `ROUND(A1:A3, 0)`,
//! `ISNUMBER(SEARCH("x", A1:A9))` or `COUNTIF(A1:A9, A1:A9)`. Upstream
//! broadcasts some functions itself; this lifts every function whose
//! parameters `lifted_parameters` marks.

use std::collections::HashMap;

use crate::{
    arithmetic::bcast_idx,
    calc_result::CalcResult,
    cast::calc_result_to_array_node,
    expressions::{
        parser::{
            static_analysis::{lifted_parameters, run_static_analysis_on_node, StaticResult},
            ArrayNode, Node,
        },
        token::Error,
        types::CellReferenceIndex,
    },
    functions::Function,
    model::Model,
};

/// A lifted argument that holds several values.
enum Source {
    Range {
        sheet: u32,
        row: i32,
        column: i32,
        rows: usize,
        columns: usize,
        /// The rows and columns within the sheet's used area; the cells
        /// beyond it are all empty.
        used: (usize, usize),
    },
    Array(Vec<Vec<ArrayNode>>),
}

impl Source {
    fn dimensions(&self) -> (usize, usize) {
        match self {
            Source::Range { rows, columns, .. } => (*rows, *columns),
            Source::Array(array) => (array.len(), array.first().map_or(0, Vec::len)),
        }
    }

    /// The part whose elements can differ from one another.
    fn used(&self) -> (usize, usize) {
        match self {
            Source::Range { used, .. } => *used,
            Source::Array(_) => self.dimensions(),
        }
    }

    /// The argument for one output position, broadcasting a dimension of one;
    /// `None` past the end of a shorter argument.
    fn element(&self, row: usize, column: usize) -> Option<Node> {
        match self {
            Source::Range {
                sheet,
                row: top,
                column: left,
                rows,
                columns,
                ..
            } => Some(reference(
                *sheet,
                top + bcast_idx(*rows, row)? as i32,
                left + bcast_idx(*columns, column)? as i32,
            )),
            Source::Array(array) => {
                let values = array.get(bcast_idx(array.len(), row)?)?;
                Some(literal(values.get(bcast_idx(values.len(), column)?)?))
            }
        }
    }
}

/// The value an element reads. Elements that read the same values have the
/// same result, so `COUNTIF(B:B, B:B&"")` counts once per distinct value.
#[derive(PartialEq, Eq, Hash)]
enum Key {
    Number(u64),
    Text(String),
    Boolean(bool),
    Error(String),
    Empty,
}

/// Results kept for reuse, at most.
const MAX_REUSED: usize = 65_536;

/// An absolute reference to one cell, so the function reads it as written:
/// empty cells and formulas keep their meaning.
fn reference(sheet: u32, row: i32, column: i32) -> Node {
    Node::ReferenceKind {
        sheet_name: None,
        sheet_index: sheet,
        absolute_row: true,
        absolute_column: true,
        row,
        column,
    }
}

fn literal(value: &ArrayNode) -> Node {
    match value {
        ArrayNode::Number(number) => Node::NumberKind(*number),
        ArrayNode::Boolean(boolean) => Node::BooleanKind(*boolean),
        // String literals keep the formula's doubled quotes.
        ArrayNode::String(text) => Node::StringKind(text.replace('"', "\"\"")),
        ArrayNode::Error(error) => Node::ErrorKind(error.clone()),
        // An array has no blanks: Excel reads them as zero.
        ArrayNode::Empty => Node::NumberKind(0.0),
    }
}

impl Model<'_> {
    /// Evaluates `kind` element by element when a lifted parameter receives
    /// several values. Otherwise calls it once, with arguments already
    /// evaluated here passed as values so they are not evaluated twice.
    pub(crate) fn evaluate_lifted_function(
        &mut self,
        kind: &Function,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> Option<CalcResult> {
        let lifted = lifted_parameters(kind, args.len())?;
        let mut sources: Vec<Option<Source>> = Vec::new();
        let mut written = args.to_vec();
        let mut evaluated = false;
        for (index, arg) in args.iter().enumerate() {
            sources.push(None);
            if !lifted[index] || matches!(run_static_analysis_on_node(arg), StaticResult::Scalar) {
                continue;
            }
            evaluated = true;
            match self.evaluate_node_with_reference(arg, cell) {
                CalcResult::Range { left, right } => {
                    if left == right {
                        written[index] = reference(left.sheet, left.row, left.column);
                    } else if left.sheet == right.sheet {
                        // Whole columns and rows are mostly empty cells:
                        // MATCH(B:B, B:B, 0) is evaluated within the used
                        // area, and once for all the empty cells beyond it.
                        let (bottom, last) = self
                            .clip_to_used_area(
                                left.sheet,
                                left.row,
                                left.column,
                                right.row,
                                right.column,
                            )
                            .unwrap_or((right.row, right.column));
                        sources[index] = Some(Source::Range {
                            sheet: left.sheet,
                            row: left.row,
                            column: left.column,
                            rows: (right.row - left.row + 1) as usize,
                            columns: (right.column - left.column + 1) as usize,
                            used: (
                                (bottom.max(left.row - 1) - left.row + 1) as usize,
                                (last.max(left.column - 1) - left.column + 1) as usize,
                            ),
                        });
                    }
                }
                CalcResult::Array(array) => {
                    let single = array.len() == 1 && array.first().is_some_and(|r| r.len() == 1);
                    if single {
                        written[index] = literal(&array[0][0]);
                    } else if !array.is_empty() && !array[0].is_empty() {
                        sources[index] = Some(Source::Array(array));
                    }
                }
                CalcResult::Number(number) => written[index] = Node::NumberKind(number),
                CalcResult::Boolean(boolean) => written[index] = Node::BooleanKind(boolean),
                CalcResult::String(text) => {
                    written[index] = Node::StringKind(text.replace('"', "\"\""))
                }
                CalcResult::Error { error, .. } => written[index] = Node::ErrorKind(error),
                // Blank values and lambdas are evaluated again where the
                // function reads them.
                CalcResult::EmptyCell | CalcResult::EmptyArg | CalcResult::Lambda(_) => {}
            }
        }
        if !evaluated {
            return None;
        }
        let (mut rows, mut columns) = (1, 1);
        let (mut used_rows, mut used_columns) = (1, 1);
        let mut many = false;
        for source in sources.iter().flatten() {
            let (r, c) = source.dimensions();
            rows = rows.max(r);
            columns = columns.max(c);
            let (r, c) = source.used();
            used_rows = used_rows.max(r);
            used_columns = used_columns.max(c);
            many = true;
        }
        if !many {
            return Some(self.dispatch_function(kind, &written, cell));
        }
        // Past the used rows (columns) every element reads the same empty
        // cells and missing elements: one row (column) more stands for them.
        let evaluated_rows = rows.min(used_rows + 1);
        let evaluated_columns = columns.min(used_columns + 1);
        // Random numbers differ from element to element.
        let reuse = !matches!(kind, Function::Randbetween);
        let mut reused: HashMap<Vec<Key>, ArrayNode> = HashMap::new();
        let mut result = Vec::with_capacity(rows);
        for row in 0..evaluated_rows {
            let mut values = Vec::with_capacity(columns);
            for column in 0..evaluated_columns {
                let mut element = written.clone();
                let mut complete = true;
                let mut key = Vec::new();
                for (index, source) in sources.iter().enumerate() {
                    if let Some(source) = source {
                        match source.element(row, column) {
                            Some(node) => {
                                if reuse {
                                    key.push(self.element_key(&node, cell));
                                }
                                element[index] = node;
                            }
                            None => complete = false,
                        }
                    }
                }
                if !complete {
                    values.push(self.missing_element(&sources, &written, row, column, cell));
                    continue;
                }
                if let Some(value) = reused.get(&key) {
                    values.push(value.clone());
                    continue;
                }
                let value = self.dispatch_function(kind, &element, cell);
                let value = self.lifted_element(value);
                if reuse && reused.len() < MAX_REUSED {
                    reused.insert(key, value.clone());
                }
                values.push(value);
            }
            if let Some(last) = values.last().cloned() {
                values.resize(columns, last);
            }
            result.push(values);
        }
        if let Some(last) = result.last().cloned() {
            result.resize(rows, last);
        }
        Some(CalcResult::Array(result))
    }

    /// What an element of a lifted argument reads: a literal, or the value of
    /// the cell it refers to.
    fn element_key(&mut self, node: &Node, cell: CellReferenceIndex) -> Key {
        let value = match node {
            Node::NumberKind(number) => return Key::Number(number.to_bits()),
            Node::StringKind(text) => return Key::Text(text.clone()),
            Node::BooleanKind(boolean) => return Key::Boolean(*boolean),
            Node::ErrorKind(error) => return Key::Error(error.to_string()),
            node => self.evaluate_node_in_context(node, cell),
        };
        match value {
            CalcResult::Number(number) => Key::Number(number.to_bits()),
            // Text read from a cell is not a formula's quoted literal.
            CalcResult::String(text) => Key::Text(format!("\u{0}{text}")),
            CalcResult::Boolean(boolean) => Key::Boolean(boolean),
            CalcResult::Error { error, .. } => Key::Error(error.to_string()),
            _ => Key::Empty,
        }
    }

    /// A position past the end of a shorter argument: the first error or
    /// missing element, in argument order, as Excel does.
    fn missing_element(
        &mut self,
        sources: &[Option<Source>],
        written: &[Node],
        row: usize,
        column: usize,
        cell: CellReferenceIndex,
    ) -> ArrayNode {
        for (index, source) in sources.iter().enumerate() {
            let node = match source {
                Some(source) => match source.element(row, column) {
                    Some(node) => node,
                    None => return ArrayNode::Error(Error::NA),
                },
                None => written[index].clone(),
            };
            match node {
                Node::ErrorKind(error) => return ArrayNode::Error(error),
                node @ Node::ReferenceKind { .. } => {
                    if let CalcResult::Error { error, .. } =
                        self.evaluate_node_in_context(&node, cell)
                    {
                        return ArrayNode::Error(error);
                    }
                }
                _ => {}
            }
        }
        ArrayNode::Error(Error::NA)
    }

    /// One element of a lifted result: a reference reads its first cell and
    /// an array its first element, as Excel does for nested arrays.
    fn lifted_element(&mut self, value: CalcResult) -> ArrayNode {
        match value {
            CalcResult::Range { left, .. } => match self.evaluate_cell(left) {
                CalcResult::EmptyCell => ArrayNode::Number(0.0),
                value => calc_result_to_array_node(value),
            },
            CalcResult::Array(array) => array
                .first()
                .and_then(|row| row.first())
                .cloned()
                .unwrap_or(ArrayNode::Error(Error::VALUE)),
            CalcResult::EmptyCell => ArrayNode::Number(0.0),
            value => calc_result_to_array_node(value),
        }
    }
}
