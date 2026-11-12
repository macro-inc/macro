//! 1Password 8 CSV: `Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes`.
use crate::csv_table;
use crate::draft::{Draft, Parts};
use crate::error::ImportError;
use crate::model::{ItemKind, Limits, SkipReason, SourceKey};

pub(crate) const REQUIRED_COLUMNS: [&str; 4] = ["title", "url", "username", "password"];
const KNOWN_COLUMNS: [&str; 9] = [
    "title", "url", "username", "password", "otpauth", "favorite", "archived", "tags", "notes",
];

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let table = csv_table::read(bytes, limits)?;
    if REQUIRED_COLUMNS
        .iter()
        .any(|name| table.column(name).is_none())
    {
        return Err(ImportError::InvalidCsv { row: 1 });
    }

    let title = table.column("title");
    let url = table.column("url");
    let username = table.column("username");
    let password = table.column("password");
    let one_time_password = table.column("otpauth");
    let favorite = table.column("favorite");
    let archived = table.column("archived");
    let tags = table.column("tags");
    let notes = table.column("notes");
    let extra_columns: Vec<usize> = (0..table.headers.len())
        .filter(|&column| {
            table
                .headers
                .get(column)
                .is_some_and(|header| !KNOWN_COLUMNS.contains(&header.as_str()))
        })
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
        draft.username(row.take(username), "Username");
        draft.password(row.take(password), "Password");
        draft.one_time_password(row.take(one_time_password));
        draft.notes(row.take(notes));
        // Tags are kept whole: one `Tags` field, as written.
        draft.add_tag(row.text(tags));

        for &column in &extra_columns {
            let label = table.labels.get(column).map_or("", String::as_str);
            draft.field(label, row.take(Some(column)), false);
        }

        // Nothing to log in with: a note.
        if !draft.has_username() && !draft.has_password() && !draft.has_urls() {
            draft.set_kind(ItemKind::Note);
        }

        parts.add(draft);
    }

    Ok(parts)
}

fn is_true(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("true")
}
