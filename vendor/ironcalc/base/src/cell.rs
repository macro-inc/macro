use crate::{
    expressions::token::Error, language::Language, locale::Locale,
    number_format::to_excel_precision_str, types::*,
};

/// A CellValue is the representation of the cell content.
#[derive(Debug, PartialEq)]
pub enum CellValue {
    None,
    String(String),
    Number(f64),
    Boolean(bool),
}

impl From<f64> for CellValue {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}

impl From<String> for CellValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<&str> for CellValue {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<bool> for CellValue {
    fn from(value: bool) -> Self {
        Self::Boolean(value)
    }
}

impl Cell {
    /// Creates a new Cell with a shared string (`si` is the string index)
    pub fn new_string(si: i32, s: i32) -> Cell {
        Cell::SharedString { si, s }
    }

    /// Creates a new Cell with a number
    pub fn new_number(v: f64, s: i32) -> Cell {
        Cell::NumberCell { v, s }
    }

    /// Creates a new Cell with a boolean
    pub fn new_boolean(v: bool, s: i32) -> Cell {
        Cell::BooleanCell { v, s }
    }

    /// Creates a new Cell with an error value
    pub fn new_error(ei: Error, s: i32) -> Cell {
        Cell::ErrorCell { ei, s }
    }

    /// Creates a new Cell with an unevaluated formula
    pub fn new_formula(f: i32, s: i32) -> Cell {
        Cell::CellFormula {
            f,
            s,
            v: FormulaValue::Unevaluated,
        }
    }

    /// Returns the formula index of a cell if any.
    pub fn get_formula(&self) -> Option<i32> {
        match self {
            Cell::CellFormula { f, .. } | Cell::ArrayFormula { f, .. } => Some(*f),
            _ => None,
        }
    }

    pub fn has_formula(&self) -> bool {
        self.get_formula().is_some()
    }

    pub fn set_style(&mut self, style: i32) {
        match self {
            Cell::EmptyCell { s, .. }
            | Cell::BooleanCell { s, .. }
            | Cell::NumberCell { s, .. }
            | Cell::ErrorCell { s, .. }
            | Cell::SharedString { s, .. }
            | Cell::CellFormula { s, .. }
            | Cell::ArrayFormula { s, .. }
            | Cell::SpillCell { s, .. } => *s = style,
        }
    }

    pub fn get_style(&self) -> i32 {
        match self {
            Cell::EmptyCell { s, .. }
            | Cell::BooleanCell { s, .. }
            | Cell::NumberCell { s, .. }
            | Cell::ErrorCell { s, .. }
            | Cell::SharedString { s, .. }
            | Cell::CellFormula { s, .. }
            | Cell::ArrayFormula { s, .. }
            | Cell::SpillCell { s, .. } => *s,
        }
    }

    pub fn get_type(&self) -> CellType {
        match self {
            Cell::EmptyCell { .. } => CellType::Number,
            Cell::BooleanCell { .. } => CellType::LogicalValue,
            Cell::NumberCell { .. } => CellType::Number,
            Cell::ErrorCell { .. } => CellType::ErrorValue,
            Cell::SharedString { .. } => CellType::Text,
            Cell::CellFormula { v, .. } | Cell::ArrayFormula { v, .. } => match v {
                FormulaValue::Unevaluated | FormulaValue::Number(_) => CellType::Number,
                FormulaValue::Boolean(_) => CellType::LogicalValue,
                FormulaValue::Text(_) => CellType::Text,
                FormulaValue::Error { .. } => CellType::ErrorValue,
            },
            Cell::SpillCell { v, .. } => match v {
                SpillValue::Number(_) => CellType::Number,
                SpillValue::Boolean(_) => CellType::LogicalValue,
                SpillValue::Text(_) => CellType::Text,
                SpillValue::Error(_) => CellType::ErrorValue,
            },
        }
    }

    pub fn get_localized_text(
        &self,
        shared_strings: &[String],
        locale: &Locale,
        language: &Language,
    ) -> String {
        match self.value(shared_strings, language) {
            CellValue::None => "".to_string(),
            CellValue::String(v) => v,
            CellValue::Boolean(v) => {
                if v {
                    language.booleans.r#true.to_string()
                } else {
                    language.booleans.r#false.to_string()
                }
            }
            CellValue::Number(v) => {
                let value = to_excel_precision_str(v);

                if locale.numbers.symbols.decimal != "." {
                    value.replace(".", &locale.numbers.symbols.decimal)
                } else {
                    value
                }
            }
        }
    }

    pub fn value(&self, shared_strings: &[String], language: &Language) -> CellValue {
        match self {
            Cell::EmptyCell { .. } => CellValue::None,
            Cell::BooleanCell { v, .. } => CellValue::Boolean(*v),
            Cell::NumberCell { v, .. } => CellValue::Number(*v),
            Cell::ErrorCell { ei, .. } => CellValue::String(ei.to_localized_error_string(language)),
            Cell::SharedString { si, .. } => {
                let v = shared_strings
                    .get(*si as usize)
                    .cloned()
                    .unwrap_or_default();
                CellValue::String(v)
            }
            Cell::CellFormula { v, .. } | Cell::ArrayFormula { v, .. } => {
                formula_value_to_cell_value(v, language)
            }
            Cell::SpillCell { v, .. } => spill_value_to_cell_value(v, language),
        }
    }

    pub fn formatted_value<F>(
        &self,
        shared_strings: &[String],
        language: &Language,
        format_number: F,
    ) -> String
    where
        F: Fn(f64) -> String,
    {
        match self.value(shared_strings, language) {
            CellValue::None => "".to_string(),
            CellValue::String(value) => value,
            CellValue::Boolean(value) => {
                if value {
                    language.booleans.r#true.to_string()
                } else {
                    language.booleans.r#false.to_string()
                }
            }
            CellValue::Number(value) => format_number(value),
        }
    }
}

fn formula_value_to_cell_value(v: &FormulaValue, language: &Language) -> CellValue {
    match v {
        FormulaValue::Unevaluated => CellValue::String("#ERROR!".to_string()),
        FormulaValue::Boolean(b) => CellValue::Boolean(*b),
        FormulaValue::Number(n) => CellValue::Number(*n),
        FormulaValue::Text(s) => CellValue::String(s.clone()),
        FormulaValue::Error { ei, .. } => CellValue::String(ei.to_localized_error_string(language)),
    }
}

fn spill_value_to_cell_value(v: &SpillValue, language: &Language) -> CellValue {
    match v {
        SpillValue::Boolean(b) => CellValue::Boolean(*b),
        SpillValue::Number(n) => CellValue::Number(*n),
        SpillValue::Text(s) => CellValue::String(s.clone()),
        SpillValue::Error(ei) => CellValue::String(ei.to_localized_error_string(language)),
    }
}
