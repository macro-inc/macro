//! The editable view of `macro.toml` the TUI's Config tab presents.
//!
//! Edits go through `toml_edit` so the user's comments and layout survive a
//! save. Every field is validated the same way the daemon's own loader is:
//! the whole document is re-parsed as [`crate::config::Config`] before it is
//! written, so the TUI cannot save a config `macrod` would refuse to boot.

use std::path::{Path, PathBuf};

use rootcause::prelude::ResultExt as _;
use toml_edit::{DocumentMut, Item, value};

/// One editable field: where it lives in the TOML and how to show it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Field {
    /// Display label.
    pub label: &'static str,
    /// `[section]` the key lives in.
    pub section: &'static str,
    /// Key within the section.
    pub key: &'static str,
    /// How the value is edited and rendered.
    pub kind: FieldKind,
}

/// How a field's value is represented while editing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    /// A plain string.
    Text,
    /// A string that may be absent; an empty edit removes the key.
    OptionalText,
    /// A string array, edited comma-separated.
    List,
    /// `private` / `team`, toggled rather than typed.
    Scope,
}

/// Every field the Config tab exposes, in display order.
pub const FIELDS: &[Field] = &[
    Field {
        label: "Harness name",
        section: "identity",
        key: "name",
        kind: FieldKind::OptionalText,
    },
    Field {
        label: "Scope",
        section: "identity",
        key: "scope",
        kind: FieldKind::Scope,
    },
    Field {
        label: "Harness command",
        section: "harness",
        key: "command",
        kind: FieldKind::Text,
    },
    Field {
        label: "Harness args",
        section: "harness",
        key: "args",
        kind: FieldKind::List,
    },
    Field {
        label: "Workspace path",
        section: "workspace",
        key: "path",
        kind: FieldKind::Text,
    },
    Field {
        label: "Workspace repo URL",
        section: "workspace",
        key: "repo_url",
        kind: FieldKind::OptionalText,
    },
    Field {
        label: "Agent-harness API URL",
        section: "macro",
        key: "api_url",
        kind: FieldKind::Text,
    },
    Field {
        label: "Storage API URL",
        section: "macro",
        key: "storage_url",
        kind: FieldKind::Text,
    },
    Field {
        label: "Web app URL",
        section: "macro",
        key: "web_url",
        kind: FieldKind::OptionalText,
    },
];

/// The config document being viewed and edited.
pub struct ConfigForm {
    path: PathBuf,
    doc: DocumentMut,
}

impl ConfigForm {
    /// Load the config file into an editable document.
    pub fn load(path: &Path) -> rootcause::Result<Self> {
        let raw = std::fs::read_to_string(path)
            .context(format!("failed to read config at {}", path.display()))?;
        let doc = raw
            .parse::<DocumentMut>()
            .context(format!("invalid TOML at {}", path.display()))?;
        Ok(Self {
            path: path.to_owned(),
            doc,
        })
    }

    /// The current display value of a field.
    pub fn display(&self, field: &Field) -> String {
        let item = self
            .doc
            .get(field.section)
            .and_then(|section| section.get(field.key));
        match (field.kind, item) {
            (FieldKind::List, Some(Item::Value(value))) => value
                .as_array()
                .map(|array| {
                    array
                        .iter()
                        .filter_map(|entry| entry.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            (FieldKind::Scope, item) => item.and_then(Item::as_str).unwrap_or("private").to_owned(),
            (_, Some(Item::Value(value))) => value.as_str().unwrap_or_default().to_owned(),
            _ => String::new(),
        }
    }

    /// Apply an edited value to a field, in memory.
    pub fn apply(&mut self, field: &Field, input: &str) -> Result<(), String> {
        let input = input.trim();
        let section = self.doc[field.section].or_insert(toml_edit::table());
        match field.kind {
            FieldKind::Text => {
                if input.is_empty() {
                    return Err(format!("{} must not be empty", field.label));
                }
                section[field.key] = value(input);
            }
            FieldKind::OptionalText => {
                if input.is_empty() {
                    if let Some(table) = section.as_table_like_mut() {
                        table.remove(field.key);
                    }
                } else {
                    section[field.key] = value(input);
                }
            }
            FieldKind::List => {
                let mut array = toml_edit::Array::new();
                for entry in input.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                    array.push(entry);
                }
                section[field.key] = value(array);
            }
            FieldKind::Scope => match input {
                "private" | "team" => section[field.key] = value(input),
                other => return Err(format!("scope must be private or team, not {other}")),
            },
        }
        Ok(())
    }

    /// Validate the whole document as a daemon config and write it out.
    pub fn save(&self) -> rootcause::Result<()> {
        let rendered = self.doc.to_string();
        toml::from_str::<crate::config::Config>(&rendered)
            .context("the edited config would not load; the value was rejected before writing")?;
        std::fs::write(&self.path, rendered)
            .context(format!("failed to write config at {}", self.path.display()))?;
        Ok(())
    }
}
