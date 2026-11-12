//! CSV exports read into a header and rows of secret cells.
use crate::error::ImportError;
use crate::model::{Limits, Secret};

const BYTE_ORDER_MARK: &[u8] = b"\xEF\xBB\xBF";

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
}

/// The header names of `bytes`, if it reads as CSV at all.
pub(crate) fn headers(bytes: &[u8]) -> Option<Vec<String>> {
    let mut reader = reader(bytes);
    let labels = header_labels(reader.byte_headers().ok()?)?;
    Some(labels.iter().map(|label| label.to_lowercase()).collect())
}

pub(crate) fn read(bytes: &[u8], limits: &Limits) -> Result<Table, ImportError> {
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

fn reader(bytes: &[u8]) -> csv::Reader<&[u8]> {
    let bytes = bytes.strip_prefix(BYTE_ORDER_MARK).unwrap_or(bytes);
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
