//! MACRO: GETPIVOTDATA, which upstream does not have.
//!
//! GETPIVOTDATA(data_field, pivot_table, [field1, item1], ...)
//!
//! The engine has no pivot tables of its own. The host describes where each
//! one shows its values (`Model::set_pivot_tables`): for every row and every
//! column of values, the items it is for, the data field it shows and whether
//! it is a total. GETPIVOTDATA finds the row and the column for the items it
//! is given and returns the value of the cell where they cross. Like Excel, it
//! gives #REF! for anything the table does not show.

use serde::Deserialize;

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

/// A pivot table as GETPIVOTDATA reads it. Names and texts are in lower case
/// and trimmed, as `normalized` leaves them.
#[derive(Clone, Debug, Deserialize)]
pub struct PivotLayout {
    /// The index of its sheet.
    pub sheet: u32,
    /// The cells it covers, `[top, left, bottom, right]`, counted from 1.
    pub range: [i32; 4],
    /// For each data field, the names it goes by: its own, such as "sum of
    /// sales", and its source field's, "sales".
    pub data: Vec<Vec<String>>,
    /// Every field of its source, by index.
    pub fields: Vec<PivotField>,
    /// Report filters: a field, and the one item it shows if it shows one.
    #[serde(default)]
    pub filters: Vec<(usize, Option<usize>)>,
    /// The rows of values, top to bottom.
    pub rows: Vec<PivotLine>,
    /// The columns of values, left to right.
    pub columns: Vec<PivotLine>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PivotField {
    /// The names it goes by.
    pub names: Vec<String>,
    pub items: Vec<PivotItem>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PivotItem {
    /// What it shows.
    pub text: String,
    /// Its value, if it is a number or a date.
    #[serde(default)]
    pub number: Option<f64>,
}

/// A row or a column of values.
#[derive(Clone, Debug, Deserialize)]
pub struct PivotLine {
    /// Its row or column number.
    pub at: i32,
    /// The items it is for, as `(field, item)` indexes.
    pub items: Vec<(usize, usize)>,
    /// The data field it shows, when data fields are listed along it.
    #[serde(default)]
    pub data: Option<usize>,
    /// Whether it is a subtotal or a grand total.
    #[serde(default)]
    pub total: bool,
}

/// A name or a text as layouts hold them.
pub(crate) fn normalized(text: &str) -> String {
    text.trim().to_lowercase()
}

/// An item asked for.
enum Wanted {
    Text(String),
    Number(f64),
    Boolean(bool),
}

fn same_number(left: f64, right: f64) -> bool {
    left == right || (left - right).abs() <= 1e-12 * left.abs().max(right.abs())
}

impl Wanted {
    fn matches(&self, item: &PivotItem) -> bool {
        match self {
            Wanted::Number(number) => {
                item.number.is_some_and(|value| same_number(value, *number))
                    || item.text == format!("{number}")
            }
            Wanted::Text(text) => {
                item.text == *text
                    || match (item.number, text.parse::<f64>()) {
                        (Some(value), Ok(number)) => same_number(value, number),
                        _ => false,
                    }
            }
            Wanted::Boolean(value) => item.text == if *value { "true" } else { "false" },
        }
    }
}

/// The line whose items are exactly `wanted`, each field with one of the
/// item indexes listed for it. A total wins over a line of items, which
/// shows nothing when its subtotals are below it; a line of the data field
/// asked for wins over one that shows every data field.
fn find_line(lines: &[PivotLine], wanted: &[(usize, Vec<usize>)], data: usize) -> Option<i32> {
    let mut best: Option<(u8, i32)> = None;
    for line in lines {
        if line.data.is_some_and(|index| index != data) || line.items.len() != wanted.len() {
            continue;
        }
        let matched = wanted.iter().all(|(field, items)| {
            line.items
                .iter()
                .any(|(other, item)| other == field && items.contains(item))
        });
        if !matched {
            continue;
        }
        let score = 2 * u8::from(line.data == Some(data)) + u8::from(line.total);
        if best.is_none_or(|(best_score, _)| score > best_score) {
            best = Some((score, line.at));
        }
    }
    best.map(|(_, at)| at)
}

impl PivotLayout {
    fn contains(&self, cell: CellReferenceIndex) -> bool {
        let [top, left, bottom, right] = self.range;
        cell.sheet == self.sheet
            && (top..=bottom).contains(&cell.row)
            && (left..=right).contains(&cell.column)
    }

    /// The cell showing `data_field` for the items asked for, if the table
    /// shows it.
    fn find(&self, data_field: &str, wanted: &[(String, Wanted)]) -> Option<(i32, i32)> {
        let data = self
            .data
            .iter()
            .position(|names| names.iter().any(|name| name == data_field))?;
        let on = |lines: &[PivotLine], field: usize| {
            lines
                .iter()
                .any(|line| line.items.iter().any(|(other, _)| *other == field))
        };
        let mut rows = Vec::new();
        let mut columns = Vec::new();
        for (name, item) in wanted {
            let field = self
                .fields
                .iter()
                .position(|field| field.names.iter().any(|other| other == name))?;
            let items: Vec<usize> = self.fields[field]
                .items
                .iter()
                .enumerate()
                .filter(|(_, candidate)| item.matches(candidate))
                .map(|(index, _)| index)
                .collect();
            if items.is_empty() {
                return None;
            }
            if on(&self.rows, field) {
                rows.push((field, items));
            } else if on(&self.columns, field) {
                columns.push((field, items));
            } else {
                // A report filter only shows the one item it is set to.
                let (_, shown) = self.filters.iter().find(|(other, _)| *other == field)?;
                if !shown.is_some_and(|shown| items.contains(&shown)) {
                    return None;
                }
            }
        }
        let row = find_line(&self.rows, &rows, data)?;
        let column = find_line(&self.columns, &columns, data)?;
        Some((row, column))
    }
}

impl Model<'_> {
    /// MACRO: describes the workbook's pivot tables for GETPIVOTDATA.
    pub fn set_pivot_tables(&mut self, pivot_tables: Vec<PivotLayout>) {
        self.pivot_tables = pivot_tables;
    }

    pub(crate) fn fn_getpivotdata(
        &mut self,
        args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        if args.len() < 2 || args.len() % 2 != 0 {
            return CalcResult::new_args_number_error(cell);
        }
        let data_field = match self.get_string(&args[0], cell) {
            Ok(name) => normalized(&name),
            Err(error) => return error,
        };
        let reference = match self.get_reference(&args[1], cell) {
            Ok(range) => range.left,
            Err(error) => return error,
        };
        let mut wanted = Vec::new();
        for pair in args[2..].chunks(2) {
            let field = match self.get_string(&pair[0], cell) {
                Ok(name) => normalized(&name),
                Err(error) => return error,
            };
            let value = self.evaluate_node_in_context(&pair[1], cell);
            let item = match self.dereference(value, cell) {
                CalcResult::Number(number) => Wanted::Number(number),
                CalcResult::String(text) => Wanted::Text(normalized(&text)),
                CalcResult::Boolean(value) => Wanted::Boolean(value),
                CalcResult::EmptyCell | CalcResult::EmptyArg => Wanted::Text(String::new()),
                error @ CalcResult::Error { .. } => return error,
                _ => return CalcResult::new_error(Error::VALUE, cell, "Invalid item".to_string()),
            };
            wanted.push((field, item));
        }
        let not_shown = || {
            CalcResult::new_error(
                Error::REF,
                cell,
                "The pivot table does not show this value".to_string(),
            )
        };
        let Some(pivot) = self
            .pivot_tables
            .iter()
            .find(|pivot| pivot.contains(reference))
        else {
            return CalcResult::new_error(Error::REF, cell, "Not a pivot table".to_string());
        };
        let Some((row, column)) = pivot.find(&data_field, &wanted) else {
            return not_shown();
        };
        match self.evaluate_cell(CellReferenceIndex {
            sheet: reference.sheet,
            row,
            column,
        }) {
            CalcResult::EmptyCell => not_shown(),
            value => value,
        }
    }
}
