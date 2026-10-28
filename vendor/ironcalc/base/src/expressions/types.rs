use serde::{Deserialize, Serialize};

// $A$34
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub struct ParsedReference {
    pub column: i32,
    pub row: i32,
    pub absolute_column: bool,
    pub absolute_row: bool,
}

/// If right is None it is just a reference
/// Column ranges like D:D will have `absolute_row=true` and `left.row=1` and `right.row=LAST_ROW`
/// Row ranges like 5:5 will have `absolute_column=true` and `left.column=1` and `right.column=LAST_COLUMN`
pub struct ParsedRange {
    pub left: ParsedReference,
    pub right: Option<ParsedReference>,
}

// FIXME: It does not make sense to have two different structures.
// We should have a single one CellReferenceNamed or something like that.
// Sheet1!C3
pub struct CellReference {
    pub sheet: String,
    pub column: String,
    pub row: String,
}

// Sheet1!C3 -> CellReferenceRC{Sheet1, 3, 3}
#[derive(Clone)]
pub struct CellReferenceRC {
    pub sheet: String,
    pub column: i32,
    pub row: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Copy, Hash)]
pub struct CellReferenceIndex {
    pub sheet: u32,
    pub column: i32,
    pub row: i32,
}

#[derive(Serialize, Deserialize)]
pub struct Area {
    pub sheet: u32,
    pub row: i32,
    pub column: i32,
    pub width: i32,
    pub height: i32,
}
