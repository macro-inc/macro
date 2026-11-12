//! CRM CSV files as the import and export tools read and write them: a
//! companies list (a domain column, a name column, and any pipeline fields)
//! or a pipeline's entries (the record's name and domain or email, then one
//! column per field). Parsing and shaping only; no I/O.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use super::pipelines::PipelineRecordType;

/// Most data rows one import reads.
pub const MAX_CSV_ROWS: usize = 10_000;
/// Most bytes one import reads.
pub const MAX_CSV_BYTES: usize = 16 * 1024 * 1024;

/// Headers naming a company in a companies or company-pipeline CSV.
const COMPANY_NAME_HEADERS: &[&str] = &["company", "name", "company name"];
/// Headers holding a company's domain; our companies export writes `Domains`.
const COMPANY_KEY_HEADERS: &[&str] = &["domain", "domains", "website"];
/// Headers naming a contact in a contact-pipeline CSV.
const CONTACT_NAME_HEADERS: &[&str] = &["contact", "name", "contact name"];
/// Headers holding a contact's email.
const CONTACT_KEY_HEADERS: &[&str] = &["email", "email address"];
/// Company columns that pipeline entries hold now, rather than companies.
pub const COMPANY_PIPELINE_FIELDS: &[&str] = &["stage", "owner", "revenue"];

/// A parsed CSV: its header row and data rows, every row as wide as the header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvTable {
    /// Column names as written.
    pub headers: Vec<String>,
    /// Data rows, padded or cut to the header's width.
    pub rows: Vec<Vec<String>>,
}

/// Why a CSV cannot be read; the message says what to change.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CsvError {
    /// The text is not a CSV the importer can read.
    #[error("{0}")]
    Invalid(String),
}

/// Parse CSV text with a header row. A UTF-8 byte order mark is ignored.
pub fn parse_csv(text: &str) -> Result<CsvTable, CsvError> {
    if text.len() > MAX_CSV_BYTES {
        return Err(CsvError::Invalid(format!(
            "The CSV is larger than {} MB.",
            MAX_CSV_BYTES / (1024 * 1024)
        )));
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map_err(|error| CsvError::Invalid(format!("The CSV header could not be read: {error}")))?
        .iter()
        .map(|header| header.trim().to_owned())
        .collect();
    if headers.iter().all(String::is_empty) {
        return Err(CsvError::Invalid("The CSV needs a header row.".into()));
    }
    let mut rows = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| {
            CsvError::Invalid(format!("CSV row {} could not be read: {error}", index + 2))
        })?;
        if record.iter().all(|value| value.trim().is_empty()) {
            continue;
        }
        if rows.len() == MAX_CSV_ROWS {
            return Err(CsvError::Invalid(format!(
                "The CSV has more than {MAX_CSV_ROWS} rows; split it and import each part."
            )));
        }
        rows.push(
            (0..headers.len())
                .map(|column| record.get(column).unwrap_or_default().to_owned())
                .collect(),
        );
    }
    Ok(CsvTable { headers, rows })
}

/// A cell as typed: trimmed, without the quote exports put before a value
/// that starts with a formula character (after spaces too).
pub fn imported_text(value: &str) -> String {
    let text = value.trim();
    match text.strip_prefix('\'') {
        Some(rest) if rest.trim_start().starts_with(['=', '+', '-', '@']) => rest.trim().to_owned(),
        _ => text.to_owned(),
    }
}

/// Whether `host` is a bare domain like `acme.com` or `mail.acme.co.uk`.
fn is_domain(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    let Some((top, rest)) = labels.split_last() else {
        return false;
    };
    !rest.is_empty()
        && top.len() >= 2
        && top.chars().all(|c| c.is_ascii_alphabetic())
        && rest.iter().all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// The bare domain of a domain, URL, or email address.
pub fn imported_domain(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase();
    let without_scheme = value
        .split_once("://")
        .map_or(value.as_str(), |(_, rest)| rest);
    let without_user = without_scheme
        .split_once('@')
        .map_or(without_scheme, |(_, host)| host);
    let host = without_user
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or_default();
    let host = host.strip_prefix("www.").unwrap_or(host);
    is_domain(host).then(|| host.to_owned())
}

/// A row's first valid domain among values separated by `;`, `,` or spaces.
fn first_domain(value: &str) -> Option<String> {
    imported_text(value)
        .split([';', ',', ' ', '\t'])
        .find_map(imported_domain)
}

fn imported_email(value: &str) -> Option<String> {
    let email = imported_text(value).to_ascii_lowercase();
    let (local, host) = email.split_once('@')?;
    (!local.is_empty() && !local.contains(char::is_whitespace) && is_domain(host)).then_some(email)
}

fn header_index(headers: &[String], names: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|header| names.contains(&header.trim().to_ascii_lowercase().as_str()))
}

/// One CSV row as an entry or record to import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordRow {
    /// The record's name; its domain or email when the row names none.
    pub name: String,
    /// The company's domain or the contact's email, lowercased.
    pub key: String,
    /// The row's other non-empty cells: header and value.
    pub values: Vec<(String, String)>,
}

/// The rows of a CSV that name a record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordRows {
    /// Rows with a usable domain or email, in file order.
    pub rows: Vec<RecordRow>,
    /// Rows without one.
    pub skipped: usize,
    /// Headers other than the record's name and key, in file order.
    pub other_headers: Vec<String>,
}

/// The records a CSV names: companies by domain, contacts by email. Rows are
/// kept in file order, repeats included, since a pipeline export lists one
/// row per deal.
pub fn record_rows(
    table: &CsvTable,
    record_type: PipelineRecordType,
) -> Result<RecordRows, CsvError> {
    let (name_headers, key_headers) = match record_type {
        PipelineRecordType::Company => (COMPANY_NAME_HEADERS, COMPANY_KEY_HEADERS),
        PipelineRecordType::Contact => (CONTACT_NAME_HEADERS, CONTACT_KEY_HEADERS),
    };
    let key_index = header_index(&table.headers, key_headers).ok_or_else(|| {
        CsvError::Invalid(match record_type {
            PipelineRecordType::Company => {
                "The CSV needs a Domain column, with domains like acme.com.".into()
            }
            PipelineRecordType::Contact => {
                "The CSV needs an Email column, with addresses like jane@acme.com.".into()
            }
        })
    })?;
    let name_index = header_index(&table.headers, name_headers).filter(|&i| i != key_index);
    let other: Vec<usize> = (0..table.headers.len())
        .filter(|&i| i != key_index && Some(i) != name_index && !table.headers[i].is_empty())
        .collect();
    let mut rows = Vec::new();
    let mut skipped = 0;
    for row in &table.rows {
        let key = match record_type {
            PipelineRecordType::Company => first_domain(&row[key_index]),
            PipelineRecordType::Contact => imported_email(&row[key_index]),
        };
        let Some(key) = key else {
            skipped += 1;
            continue;
        };
        let name = name_index
            .map(|i| imported_text(&row[i]))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| key.clone());
        let values = other
            .iter()
            .map(|&i| (table.headers[i].clone(), imported_text(&row[i])))
            .filter(|(_, value)| !value.is_empty())
            .collect();
        rows.push(RecordRow { name, key, values });
    }
    Ok(RecordRows {
        rows,
        skipped,
        other_headers: other.iter().map(|&i| table.headers[i].clone()).collect(),
    })
}

/// The companies a companies CSV adds, one per domain, first row first.
pub fn unique_companies(rows: &[RecordRow]) -> Vec<&RecordRow> {
    let mut seen = HashSet::new();
    rows.iter()
        .filter(|row| seen.insert(row.key.as_str()))
        .collect()
}

/// The pipeline part of a companies CSV: its Stage, Owner and Revenue
/// values on each row that has one. Empty when no row has any.
pub fn company_pipeline_rows(rows: &[RecordRow]) -> Vec<RecordRow> {
    rows.iter()
        .filter_map(|row| {
            let values: Vec<(String, String)> = row
                .values
                .iter()
                .filter(|(header, _)| {
                    COMPANY_PIPELINE_FIELDS.contains(&header.trim().to_ascii_lowercase().as_str())
                })
                .cloned()
                .collect();
            (!values.is_empty()).then(|| RecordRow {
                values,
                ..row.clone()
            })
        })
        .collect()
}

/// A cell written so a spreadsheet shows it as text, never as a formula.
fn safe_cell(value: &str) -> String {
    if value.trim_start().starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value.to_owned()
    }
}

/// CSV text for `headers` and `rows`, quoted where needed.
pub fn encode_csv(headers: &[String], rows: &[Vec<String>]) -> String {
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    let mut write = |record: Vec<String>| {
        // Writing to memory fails only on a bug in the writer itself.
        writer
            .write_record(record)
            .expect("a CSV record writes to memory");
    };
    write(headers.iter().map(|header| safe_cell(header)).collect());
    for row in rows {
        write(row.iter().map(|value| safe_cell(value)).collect());
    }
    let bytes = writer
        .into_inner()
        .expect("an in-memory CSV writer flushes");
    String::from_utf8(bytes).expect("CSV written from strings is UTF-8")
}
