//! The text engine's data: the PostScript-like dictionaries (`<< /Key
//! value >>`, arrays, numbers, booleans, UTF-16 strings in parentheses)
//! text layers store their characters, styles, and paragraphs in.

use crate::error::Result;

/// A text engine value.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineValue {
    /// `<< /Key value … >>`, in order.
    Dict(Vec<(String, EngineValue)>),
    /// `[ … ]`.
    Array(Vec<EngineValue>),
    /// An integer.
    Int(i64),
    /// A number with a fraction.
    Float(f64),
    /// `true` or `false`.
    Bool(bool),
    /// A string (stored as UTF-16 with a byte order mark).
    String(String),
    /// A `/Name` value.
    Name(String),
}

/// Parses engine data.
pub fn parse(data: &[u8]) -> Result<EngineValue> {
    let _ = data;
    todo!("engine_data::parse")
}

/// Writes engine data the way Photoshop formats it.
pub fn write(value: &EngineValue) -> Vec<u8> {
    let _ = value;
    todo!("engine_data::write")
}
