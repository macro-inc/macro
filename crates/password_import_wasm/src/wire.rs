//! Serializable views over a parsed export, in the shapes the browser sends.
//! They borrow the export, so revealed values are copied once, into the
//! JavaScript objects the serializer builds.

use std::collections::HashMap;

use password_import::{
    Dropped, ImportError, ImportedItem, ItemKind, ParsedExport, Skipped, SourceFormat, Summary,
};
use serde::Serialize;

/// Result of sniffing a file's format.
#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Detected {
    /// A format this adapter can parse.
    Detected {
        /// The format.
        format: SourceFormat,
    },
    /// Not a readable export.
    Failed {
        /// Why, without content.
        error: ImportError,
    },
}

/// Result of parsing a file.
#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Parsed<'a> {
    /// The parsed export.
    Parsed {
        /// What the preview and the import batches need.
        export: ExportWire<'a>,
    },
    /// The file as a whole could not be read.
    Failed {
        /// Why, without content.
        error: ImportError,
    },
}

/// A parsed export as the import dialog uses it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportWire<'a> {
    /// The format that was read.
    pub format: SourceFormat,
    /// Counts for the preview.
    pub summary: Summary,
    /// Source folders, parents before children.
    pub folders: Vec<FolderWire<'a>>,
    /// Items, in `PasswordImportItem` shape.
    pub items: Vec<ItemWire<'a>>,
    /// Whole items not imported.
    pub skipped: &'a [Skipped],
    /// Parts of imported items not carried over.
    pub dropped: &'a [Dropped],
}

/// One source folder, in `PasswordImportFolder` shape plus its full path.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderWire<'a> {
    /// Opaque key, stable for the same file: `folder:<index>`.
    pub key: String,
    /// Last path segment.
    pub name: &'a str,
    /// Key of the parent folder; absent for a top-level source folder.
    pub parent_key: Option<String>,
    /// Segments from the top level down, for the preview's tree.
    pub path: &'a [String],
}

/// One item, in `PasswordImportItem` shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemWire<'a> {
    /// Stable source identity.
    pub source_key: &'a str,
    /// Display name.
    pub name: &'a str,
    /// Vault template.
    pub kind: ItemKind,
    /// Website.
    pub url: Option<&'a str>,
    /// Key of the item's source folder.
    pub folder_key: Option<String>,
    /// Favorite in the source.
    pub favorite: bool,
    /// Confidential values.
    pub values: ValuesWire<'a>,
    /// Base32 one-time-password seed.
    pub totp: Option<&'a str>,
}

/// Confidential values, in `PasswordSecretValues` shape.
#[derive(Serialize)]
pub struct ValuesWire<'a> {
    /// Username.
    pub username: &'a str,
    /// Password.
    pub password: &'a str,
    /// Notes.
    pub notes: &'a str,
    /// Labeled custom fields.
    pub fields: Vec<FieldWire<'a>>,
}

/// One custom field, in `PasswordSecretField` shape. The vault keeps every
/// field concealed, so the source's concealed flag is not sent.
#[derive(Serialize)]
pub struct FieldWire<'a> {
    /// Label.
    pub label: &'a str,
    /// Value.
    pub value: &'a str,
}

impl<'a> ExportWire<'a> {
    /// The wire view of `export`.
    pub fn new(export: &'a ParsedExport) -> Self {
        let keys: HashMap<&[String], usize> = export
            .folders
            .iter()
            .enumerate()
            .map(|(index, folder)| (folder.segments(), index))
            .collect();
        let key_of = |segments: &[String]| keys.get(segments).map(|index| folder_key(*index));
        let folders = export
            .folders
            .iter()
            .enumerate()
            .filter_map(|(index, folder)| {
                let segments = folder.segments();
                let (name, parent) = segments.split_last()?;
                Some(FolderWire {
                    key: folder_key(index),
                    name,
                    parent_key: if parent.is_empty() {
                        None
                    } else {
                        key_of(parent)
                    },
                    path: segments,
                })
            })
            .collect();
        let items = export
            .items
            .iter()
            .map(|item| {
                ItemWire::new(
                    item,
                    item.folder.as_ref().and_then(|f| key_of(f.segments())),
                )
            })
            .collect();
        Self {
            format: export.format,
            summary: export.summary(),
            folders,
            items,
            skipped: &export.skipped,
            dropped: &export.dropped,
        }
    }
}

impl<'a> ItemWire<'a> {
    fn new(item: &'a ImportedItem, folder_key: Option<String>) -> Self {
        Self {
            source_key: item.source_key.as_str(),
            name: &item.name,
            kind: item.kind,
            url: item.url.as_deref(),
            folder_key,
            favorite: item.favorite,
            values: ValuesWire {
                username: item.username.expose_secret(),
                password: item.password.expose_secret(),
                notes: item.notes.expose_secret(),
                fields: item
                    .fields
                    .iter()
                    .map(|field| FieldWire {
                        label: &field.label,
                        value: field.value.expose_secret(),
                    })
                    .collect(),
            },
            totp: item.totp.as_ref().map(|seed| seed.expose_secret()),
        }
    }
}

fn folder_key(index: usize) -> String {
    format!("folder:{index}")
}

/// The format named by its wire spelling (`one_password_pux`, ...).
pub fn parse_format(name: &str) -> Option<SourceFormat> {
    match name {
        "one_password_pux" => Some(SourceFormat::OnePasswordPux),
        "one_password_csv" => Some(SourceFormat::OnePasswordCsv),
        "bitwarden_json" => Some(SourceFormat::BitwardenJson),
        "bitwarden_csv" => Some(SourceFormat::BitwardenCsv),
        _ => None,
    }
}
