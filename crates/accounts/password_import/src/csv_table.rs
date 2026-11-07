//! CSV exports read into a header and rows of secret cells.
use csv_core::ReadFieldResult;

use crate::error::ImportError;
use crate::model::{Limits, Secret};

/// Most cells in any CSV record, header included. Real exports have a dozen;
/// the vault keeps at most [`crate::vault::MAX_FIELDS`] fields.
pub(crate) const MAX_COLUMNS: usize = 256;
/// Scratch space for the width check; a longer cell is read in pieces.
const SCAN_BUFFER_BYTES: usize = 4096;

pub(crate) struct Table {
    /// Header names, trimmed and lowercased.
    pub(crate) headers: Vec<String>,
    /// Header names as written, trimmed: labels for extra columns.
    pub(crate) labels: Vec<String>,
    /// Data rows; `None` for a row that isn't valid UTF-8.
    pub(crate) rows: Vec<Option<Row>>,
}

pub(crate) struct Row(Vec<Secret>);

impl Row {
    /// The cell in `column`, or an empty one when the row is short.
    /// Cells in the row, which may differ from the header's count.
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn take(&mut self, column: Option<usize>) -> Secret {
        column
            .and_then(|column| self.0.get_mut(column))
            .map(std::mem::take)
            .unwrap_or_default()
    }

    /// Text of the cell in `column`, or `""`.
    pub(crate) fn text(&self, column: Option<usize>) -> &str {
        column
            .and_then(|column| self.0.get(column))
            .map_or("", Secret::expose_secret)
    }
}

impl Table {
    pub(crate) fn column(&self, name: &str) -> Option<usize> {
        self.headers.iter().position(|header| header == name)
    }

    /// `InvalidCsv` at the header unless every one of `names` is a column.
    pub(crate) fn require(&self, names: &[&str]) -> Result<(), ImportError> {
        if has_columns(&self.headers, names) {
            Ok(())
        } else {
            Err(ImportError::InvalidCsv { row: 1 })
        }
    }
}

/// Whether every one of `names` is among `headers`.
pub(crate) fn has_columns(headers: &[String], names: &[&str]) -> bool {
    names
        .iter()
        .all(|name| headers.iter().any(|header| header == name))
}

/// The header names of `bytes`, if it reads as CSV at all.
pub(crate) fn headers(bytes: &[u8]) -> Option<Vec<String>> {
    let bytes = crate::strip_byte_order_mark(bytes);
    if first_too_wide_row(bytes, 1).is_some() {
        return None;
    }
    let mut reader = reader(bytes);
    let labels = header_labels(reader.byte_headers().ok()?)?;
    Some(labels.iter().map(|label| label.to_lowercase()).collect())
}

pub(crate) fn read(bytes: &[u8], limits: &Limits) -> Result<Table, ImportError> {
    let bytes = crate::strip_byte_order_mark(bytes);
    // The csv reader holds a whole record at once; refuse a record wider than
    // any export before it does.
    if let Some(row) = first_too_wide_row(bytes, usize::MAX) {
        return Err(ImportError::InvalidCsv { row });
    }
    let mut reader = reader(bytes);
    let header_record = reader
        .byte_headers()
        .map_err(|_| ImportError::InvalidCsv { row: 1 })?;
    let labels = header_labels(header_record).ok_or(ImportError::InvalidCsv { row: 1 })?;
    let headers = labels.iter().map(|label| label.to_lowercase()).collect();

    let mut rows = Vec::new();
    for (index, record) in reader.byte_records().enumerate() {
        // Row 1 is the header.
        let record = record.map_err(|_| ImportError::InvalidCsv { row: index + 2 })?;
        if rows.len() >= limits.max_items {
            return Err(ImportError::TooManyItems);
        }

        let cells: Option<Vec<Secret>> = record
            .iter()
            .map(|cell| {
                std::str::from_utf8(cell)
                    .ok()
                    .map(|cell| Secret::new(cell.to_owned()))
            })
            .collect();
        rows.push(cells.map(Row));
    }

    Ok(Table {
        headers,
        labels,
        rows,
    })
}

/// The first record (1-based) among the first `rows` with more than
/// [`MAX_COLUMNS`] cells, found without holding any record in memory.
fn first_too_wide_row(bytes: &[u8], rows: usize) -> Option<usize> {
    let mut reader = csv_core::Reader::new();
    let mut scratch = [0; SCAN_BUFFER_BYTES];
    let mut input = bytes;
    let mut row = 1;
    let mut cells = 0;

    while row <= rows {
        let (result, read, _) = reader.read_field(input, &mut scratch);
        input = input.get(read..).unwrap_or_default();

        match result {
            ReadFieldResult::InputEmpty | ReadFieldResult::OutputFull => {}
            ReadFieldResult::Field { record_end } => {
                cells += 1;
                if cells > MAX_COLUMNS {
                    return Some(row);
                }
                if record_end {
                    row += 1;
                    cells = 0;
                }
            }
            ReadFieldResult::End => return None,
        }
    }

    None
}

fn reader(bytes: &[u8]) -> csv::Reader<&[u8]> {
    csv::ReaderBuilder::new()
        .flexible(true)
        .has_headers(true)
        .from_reader(bytes)
}

fn header_labels(headers: &csv::ByteRecord) -> Option<Vec<String>> {
    headers
        .iter()
        .map(|header| {
            std::str::from_utf8(header)
                .ok()
                .map(|header| header.trim().to_owned())
        })
        .collect()
}
