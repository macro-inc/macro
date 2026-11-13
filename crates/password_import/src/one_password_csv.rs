//! 1Password 8 CSV: `Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes`,
//! matched case-insensitively. Any CSV with `title,url,username,password` reads
//! this way; extra columns become fields, and `Tags` is kept whole as written.
//!
//! 1Password 7's CSV (`UUID,TITLE,...,SCOPE,AUTOSUBMIT`, card and identity data
//! in numbered `SECTION n:` columns) is refused with `UnsupportedVersion`, not
//! guessed at: a `title` column beside `uuid`, `scope` or `autosubmit`.
use crate::csv_table;
use crate::draft::{Draft, Parts};
use crate::error::ImportError;
use crate::model::{ItemKind, Limits, SkipReason, SourceKey};

pub(crate) const REQUIRED_COLUMNS: [&str; 4] = ["title", "url", "username", "password"];
/// Columns only 1Password 7's CSV export writes.
const ONE_PASSWORD_7_COLUMNS: [&str; 3] = ["uuid", "scope", "autosubmit"];
const KNOWN_COLUMNS: [&str; 9] = [
    "title", "url", "username", "password", "otpauth", "favorite", "archived", "tags", "notes",
];

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let table = csv_table::read(bytes, limits)?;
    if is_one_password_7(&table.headers) {
        return Err(ImportError::UnsupportedVersion);
    }
    table.require(&REQUIRED_COLUMNS)?;

    let title = table.column("title");
    let url = table.column("url");
    let username = table.column("username");
    let password = table.column("password");
    let one_time_password = table.column("otpauth");
    let favorite = table.column("favorite");
    let archived = table.column("archived");
    let tags = table.column("tags");
    let notes = table.column("notes");
    let extra_columns: Vec<usize> = table
        .headers
        .iter()
        .enumerate()
        .filter(|(_, header)| !KNOWN_COLUMNS.contains(&header.as_str()))
        .map(|(column, _)| column)
        .collect();

    let mut parts = Parts::default();
    for (index, row) in table.rows.into_iter().enumerate() {
        let key = SourceKey::from_row_index(index);
        let Some(mut row) = row else {
            parts.skip(Some(key), None, SkipReason::Malformed);
            continue;
        };

        if is_true(row.text(archived)) {
            parts.skip(Some(key), Some(row.text(title)), SkipReason::Archived);
            continue;
        }

        let mut draft = Draft::new(key, ItemKind::Login);
        draft.set_name(Some(row.text(title).to_owned()));
        draft.set_favorite(is_true(row.text(favorite)));
        draft.add_url(row.text(url));
        draft.add_username(row.take(username));
        draft.add_password(row.take(password));
        draft.add_one_time_password(row.take(one_time_password));
        draft.set_notes(row.take(notes));
        // Tags are kept whole: one `Tags` field, as written.
        draft.add_tag(row.text(tags));

        // Only the cells this row has: a short row costs nothing per column.
        let present = row.len();
        for &column in extra_columns.iter().take_while(|&&column| column < present) {
            let label = table.labels.get(column).map_or("", String::as_str);
            draft.add_field(label, row.take(Some(column)), false);
        }

        // Nothing to log in with: a note.
        if !draft.has_username() && !draft.has_password() && !draft.has_urls() {
            draft.set_kind(ItemKind::Note);
        }

        parts.add(draft);
    }

    Ok(parts)
}

/// A 1Password 7 CSV: a `title` column next to a column only 1Password 7 writes.
pub(crate) fn is_one_password_7(headers: &[String]) -> bool {
    csv_table::has_columns(headers, &["title"])
        && ONE_PASSWORD_7_COLUMNS
            .iter()
            .any(|name| csv_table::has_columns(headers, &[name]))
}

fn is_true(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("true")
}
