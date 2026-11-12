//! Bitwarden CSV: `folder,favorite,type,name,notes,fields,reprompt,login_uri,
//! login_username,login_password,login_totp`; organization exports have
//! `collections` in place of `folder`.
use nom::Parser;
use nom::bytes::complete::{tag, take_until};

use crate::csv_table;
use crate::draft::{Draft, Parts};
use crate::error::ImportError;
use crate::model::{FolderPath, ItemKind, Limits, Secret, SkipReason, SourceKey};

pub(crate) const REQUIRED_COLUMNS: [&str; 5] =
    ["type", "name", "login_uri", "login_username", "login_password"];

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let table = csv_table::read(bytes, limits)?;
    if REQUIRED_COLUMNS.iter().any(|name| table.column(name).is_none()) {
        return Err(ImportError::InvalidCsv { row: 1 });
    }

    let folder = table.column("folder");
    let collections = table.column("collections");
    let favorite = table.column("favorite");
    let item_type = table.column("type");
    let name = table.column("name");
    let notes = table.column("notes");
    let fields = table.column("fields");
    let uris = table.column("login_uri");
    let username = table.column("login_username");
    let password = table.column("login_password");
    let one_time_password = table.column("login_totp");

    let mut parts = Parts::default();
    for (index, row) in table.rows.into_iter().enumerate() {
        let key = SourceKey::from_row_index(index);
        let Some(mut row) = row else {
            parts.skip(Some(key), None, SkipReason::Malformed);
            continue;
        };

        let item_name = Some(row.text(name));
        // Organization exports have a `collections` column; every row in
        // them belongs to the organization, collected or not.
        if collections.is_some() {
            parts.skip(Some(key), item_name, SkipReason::SharedCollection);
            continue;
        }

        let kind = match row.text(item_type).trim() {
            "login" => ItemKind::Login,
            "note" => ItemKind::Note,
            _ => {
                parts.skip(Some(key), item_name, SkipReason::UnsupportedCategory);
                continue;
            }
        };

        let mut draft = Draft::new(key, kind);
        draft.set_name(item_name.map(str::to_owned));
        draft.set_favorite(row.text(favorite).trim() == "1");
        draft.set_folder(FolderPath::new(row.text(folder).split('/')));
        for uri in row.text(uris).split(',') {
            draft.add_url(uri);
        }
        draft.username(row.take(username), "Username");
        draft.password(row.take(password), "Password");
        draft.one_time_password(row.take(one_time_password));
        draft.notes(row.take(notes));
        add_fields(&mut draft, &row.take(fields));

        parts.add(draft);
    }

    Ok(parts)
}

/// `name: value` lines. The CSV doesn't say which fields were hidden, so all
/// are concealed.
fn add_fields(draft: &mut Draft, fields: &Secret) {
    for line in fields.expose_secret().lines() {
        let (label, value) = match (take_until::<_, _, ()>(": "), tag(": ")).parse(line) {
            Ok((value, (label, _))) => (label, value),
            Err(_) => ("", line),
        };
        draft.field(label, Secret::new(value.to_owned()), true);
    }
}
