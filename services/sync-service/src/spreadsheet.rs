//! Native spreadsheet access policy and bounded CRDT update validation.
//!
//! This module has no HTTP or storage dependencies. The durable-object adapter
//! supplies verified JWT claims and persists accepted updates through its oplog.
use std::borrow::Cow;

use loro::{ContainerID, ContainerType, ExportMode, LoroDoc, LoroValue, VersionVector};
use serde_json::Value;

pub const MAX_BINARY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_REVISION_BYTES: usize = 64 * 1024;
const MAX_UPDATE_OPERATIONS: u64 = 100_000;

#[derive(Debug, thiserror::Error)]
pub enum SpreadsheetError {
    #[error("The document token does not grant access to this document.")]
    Unauthorized,
    #[error("Editing this spreadsheet requires edit access.")]
    Forbidden,
    #[error("The spreadsheet changed. Read a fresh snapshot before editing.")]
    Conflict,
    #[error("The spreadsheet request exceeds the size limit.")]
    TooLarge,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("The spreadsheet update could not be persisted.")]
    Persistence,
    #[error(
        "The spreadsheet was saved, but its update notifications could not be completed. Read the workbook before retrying."
    )]
    Notification,
}

/// Capability minted only after the adapter verifies a document permission JWT.
pub struct SpreadsheetAccess {
    writable: bool,
}

impl SpreadsheetAccess {
    pub fn authorize(
        requested_document: &str,
        token_document: &str,
        writable: bool,
    ) -> Result<Self, SpreadsheetError> {
        if requested_document != token_document {
            return Err(SpreadsheetError::Unauthorized);
        }
        Ok(Self { writable })
    }

    pub fn require_edit(&self) -> Result<(), SpreadsheetError> {
        if !self.writable {
            return Err(SpreadsheetError::Forbidden);
        }
        Ok(())
    }
}

pub struct PreparedUpdate {
    /// Only new, validated operations, ready for the existing persistence path.
    pub update: Vec<u8>,
    pub revision: Vec<u8>,
    pub applied: bool,
}

/// Signed-token attribution stored alongside the existing operation log.
#[derive(serde::Serialize)]
pub struct SpreadsheetAttribution {
    pub actor: String,
    pub on_behalf_of: Option<String>,
}

impl SpreadsheetAttribution {
    pub fn from_signed_claims(
        actor: String,
        on_behalf_of: Option<String>,
    ) -> Result<Self, SpreadsheetError> {
        if actor.len() > 256 || on_behalf_of.as_ref().is_some_and(|user| user.len() > 1024) {
            return Err(SpreadsheetError::Invalid("Invalid signed attribution."));
        }
        Ok(Self {
            actor,
            on_behalf_of,
        })
    }
}

/// Persistence port: applying the update must happen before the first await.
pub trait SpreadsheetUpdatePort {
    fn document(&self) -> &LoroDoc;
    async fn apply_and_persist(&self, update: &[u8]) -> Result<(), SpreadsheetError>;
}

/// Side effects after a durable write; the use case owns their order and whether
/// a newly applied edit needs document publication. Implementations own only the
/// notification transport and scheduling mechanisms.
pub trait SpreadsheetUpdateEffects {
    fn broadcast(&self, update: &[u8]) -> Result<(), SpreadsheetError>;
    fn publish_changed_document(&self) -> Result<(), SpreadsheetError>;
    async fn keep_alive(&self) -> Result<(), SpreadsheetError>;
}

pub async fn update(
    access: &SpreadsheetAccess,
    port: &impl SpreadsheetUpdatePort,
    effects: &impl SpreadsheetUpdateEffects,
    expected_revision: &[u8],
    update: &[u8],
) -> Result<PreparedUpdate, SpreadsheetError> {
    let prepared = prepare_update(access, port.document(), expected_revision, update)?;
    // Persist retries too: a prior request may have applied in memory but lost
    // its storage write or response. Duplicate Loro imports are idempotent.
    port.apply_and_persist(&prepared.update).await?;
    effects.broadcast(&prepared.update)?;
    if prepared.applied {
        effects.publish_changed_document()?;
    }
    effects.keep_alive().await?;
    Ok(prepared)
}

pub fn snapshot(
    _access: &SpreadsheetAccess,
    doc: &LoroDoc,
) -> Result<(Vec<u8>, Vec<u8>), SpreadsheetError> {
    validate_document(doc)?;
    let snapshot = doc.export(ExportMode::Snapshot).map_err(|_| {
        SpreadsheetError::Invalid("The spreadsheet snapshot could not be exported.")
    })?;
    if snapshot.len() > MAX_BINARY_BYTES {
        return Err(SpreadsheetError::TooLarge);
    }
    let revision = doc.oplog_vv().encode();
    if revision.len() > MAX_REVISION_BYTES {
        return Err(SpreadsheetError::TooLarge);
    }
    Ok((snapshot, revision))
}

/// Synchronous preflight. The caller must apply the returned delta before its
/// next await, so websocket writes cannot interleave with this version check.
pub fn prepare_update(
    access: &SpreadsheetAccess,
    doc: &LoroDoc,
    expected_revision: &[u8],
    update: &[u8],
) -> Result<PreparedUpdate, SpreadsheetError> {
    access.require_edit()?;
    if update.len() > MAX_BINARY_BYTES || expected_revision.len() > MAX_REVISION_BYTES {
        return Err(SpreadsheetError::TooLarge);
    }
    let expected = VersionVector::decode(expected_revision)
        .map_err(|_| SpreadsheetError::Invalid("Invalid spreadsheet revision."))?;
    validate_document(doc)?;
    let meta = LoroDoc::decode_import_blob_meta(update, true)
        .map_err(|_| SpreadsheetError::Invalid("Invalid Loro update."))?;
    if meta.mode.is_snapshot() {
        return Err(SpreadsheetError::Invalid(
            "Send a Loro update, not a snapshot.",
        ));
    }
    let operations: u64 = meta
        .partial_end_vv
        .iter()
        .map(|(peer, end)| {
            end.checked_sub(meta.partial_start_vv.get(peer).copied().unwrap_or(0))
                .and_then(|count| u64::try_from(count).ok())
                .unwrap_or(u64::MAX)
        })
        .try_fold(0_u64, |total, count| total.checked_add(count))
        .ok_or(SpreadsheetError::TooLarge)?;
    if operations > MAX_UPDATE_OPERATIONS || meta.change_num > 10_000 {
        return Err(SpreadsheetError::TooLarge);
    }
    let current = doc.oplog_vv();
    let preview = doc.fork();
    let imported = preview
        .import(update)
        .map_err(|_| SpreadsheetError::Invalid("Invalid Loro update."))?;
    if imported.pending.is_some() || preview.state_vv() != preview.oplog_vv() {
        return Err(SpreadsheetError::Invalid(
            "The update has missing dependencies.",
        ));
    }
    validate_document(&preview)?;
    let revision = preview.oplog_vv();
    // Recognizing an already applied delta makes a lost HTTP response safely
    // retryable, even if other users have edited after the first application.
    if revision == current {
        return Ok(PreparedUpdate {
            update: update.to_vec(),
            revision: current.encode(),
            applied: false,
        });
    }
    if current != expected {
        return Err(SpreadsheetError::Conflict);
    }
    let update = preview
        .export(ExportMode::Updates {
            from: Cow::Borrowed(&current),
        })
        .map_err(|_| SpreadsheetError::Invalid("The validated update could not be exported."))?;
    if update.len() > MAX_BINARY_BYTES {
        return Err(SpreadsheetError::TooLarge);
    }
    Ok(PreparedUpdate {
        update,
        revision: revision.encode(),
        applied: true,
    })
}

fn sheet_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn sheet_name(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.encode_utf16().count() <= 31
        && !value.starts_with('\'')
        && !value.ends_with('\'')
        && !value.chars().any(|c| c < ' ' || "[]:*?/\\".contains(c))
}

fn sheet_key(key: &str) -> Option<&str> {
    match key.split_once('!') {
        Some((sheet, field)) if sheet_id(sheet) && !field.contains('!') => Some(field),
        Some(_) => None,
        None => Some(key),
    }
}

fn address(key: &str) -> bool {
    let Some(key) = sheet_key(key) else {
        return false;
    };
    let mut chars = key.chars();
    let Some(column) = chars.next() else {
        return false;
    };
    let row = chars.as_str();
    column.is_ascii_uppercase()
        && !row.starts_with('0')
        && row
            .parse::<u16>()
            .is_ok_and(|row| (1..=1000).contains(&row))
}

fn integer(value: &Value, minimum: i64, maximum: i64) -> bool {
    value.as_f64().is_some_and(|value| {
        value.is_finite()
            && value.fract() == 0.0
            && value >= minimum as f64
            && value <= maximum as f64
    })
}

fn choice(value: &Value, choices: &[&str]) -> bool {
    value.as_str().is_some_and(|value| choices.contains(&value))
}

fn metadata_range(value: &Value) -> bool {
    let Some(range) = value.as_str() else {
        return false;
    };
    let parts: Vec<_> = range.split(':').collect();
    if parts.is_empty()
        || parts.len() > 2
        || !parts.iter().all(|part| {
            address(part)
                && !part.contains('!')
                && part[1..].bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return false;
    }
    let first = parts[0];
    let last = parts[parts.len() - 1];
    first.as_bytes()[0] <= last.as_bytes()[0]
        && first[1..].parse::<u16>().unwrap_or(0) <= last[1..].parse::<u16>().unwrap_or(0)
}

fn workbook_metadata(value: &Value) -> bool {
    let Some(encoded) = value
        .as_str()
        .filter(|text| text.encode_utf16().count() <= 100_000)
    else {
        return false;
    };
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(encoded) else {
        return false;
    };
    fields.iter().all(|(key, value)| match key.as_str() {
        "merges" => value
            .as_array()
            .is_some_and(|items| items.len() <= 1000 && items.iter().all(metadata_range)),
        "rowHeights" => value.as_object().is_some_and(|items| {
            items.iter().all(|(key, value)| {
                key.bytes().all(|byte| byte.is_ascii_digit())
                    && key.parse::<u16>().is_ok_and(|row| row < 1000)
                    && value
                        .as_f64()
                        .is_some_and(|height| (0.0..=409.5).contains(&height))
            })
        }),
        "hiddenRows" | "hiddenColumns" => value.as_array().is_some_and(|items| {
            let limit = if key == "hiddenRows" { 1000 } else { 26 };
            items.len() <= limit && items.iter().all(|item| integer(item, 0, limit as i64 - 1))
        }),
        "hidden" => value.is_boolean(),
        "freeze" => value.as_object().is_some_and(|fields| {
            fields.len() == 2
                && fields
                    .get("rows")
                    .is_some_and(|value| integer(value, 0, 1000))
                && fields
                    .get("columns")
                    .is_some_and(|value| integer(value, 0, 26))
        }),
        "autoFilter" => metadata_range(value),
        "definedNames" => value.as_array().is_some_and(|items| {
            items.len() <= 256
                && items.iter().all(|item| {
                    item.as_object().is_some_and(|fields| {
                        fields
                            .keys()
                            .all(|key| ["name", "formula", "local"].contains(&key.as_str()))
                            && fields
                                .get("name")
                                .and_then(Value::as_str)
                                .is_some_and(|name| {
                                    !name.is_empty() && name.encode_utf16().count() <= 255
                                })
                            && fields
                                .get("formula")
                                .and_then(Value::as_str)
                                .is_some_and(|formula| formula.encode_utf16().count() <= 10_000)
                            && fields.get("local").is_none_or(Value::is_boolean)
                    })
                })
        }),
        _ => false,
    })
}

fn valid_entry(root: &str, key: &str, value: &Value) -> bool {
    match root {
        "spreadsheetMeta" => key == "formatVersion" && value.as_u64() == Some(1),
        "spreadsheetSheetMetadata" => sheet_id(key) && workbook_metadata(value),
        "spreadsheetSheetNames" => sheet_id(key) && value.as_str().is_some_and(sheet_name),
        "spreadsheetSheetOrder" => sheet_id(key) && value.as_f64().is_some_and(f64::is_finite),
        "spreadsheetDeletedSheets" => sheet_id(key) && value.is_boolean(),
        "spreadsheetSheetRevivals" => key.len() <= 200 && value.as_str().is_some_and(sheet_id),
        "spreadsheetSheetRetentions" => {
            let Some((id, peer)) = key.split_once('!') else {
                return false;
            };
            let Some(encoded) = value.as_str().filter(|value| value.len() <= 512) else {
                return false;
            };
            let Ok(identity) = serde_json::from_str::<Value>(encoded) else {
                return false;
            };
            sheet_id(id)
                && !peer.is_empty()
                && peer.len() <= 64
                && identity
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(sheet_name)
                && identity
                    .get("order")
                    .and_then(Value::as_f64)
                    .is_some_and(f64::is_finite)
                && identity
                    .get("revision")
                    .and_then(Value::as_f64)
                    .is_some_and(|value| value.is_finite() && value >= 0.0)
        }
        "spreadsheetColumnWidths" => {
            sheet_key(key).is_some_and(|key| key.parse::<u8>().is_ok_and(|column| column < 26))
                && integer(value, 64, 640)
        }
        "spreadsheetRowAdditions" => {
            sheet_key(key).is_some_and(|key| !key.is_empty() && key.len() <= 64)
                && integer(value, 1, 1000)
        }
        _ if !address(key) => false,
        "spreadsheetValues" => value
            .as_str()
            .is_some_and(|value| value.encode_utf16().count() <= 10_000),
        "spreadsheetBold"
        | "spreadsheetItalic"
        | "spreadsheetUnderline"
        | "spreadsheetStrikethrough"
        | "spreadsheetWrap"
        | "spreadsheetBorderTop"
        | "spreadsheetBorderRight"
        | "spreadsheetBorderBottom"
        | "spreadsheetBorderLeft" => value.is_boolean(),
        "spreadsheetFontNames" => value.as_str().is_some_and(|value| {
            value.encode_utf16().count() <= 128 && !value.chars().any(|ch| ch <= '\u{001f}')
        }),
        "spreadsheetBorderTopStyles"
        | "spreadsheetBorderRightStyles"
        | "spreadsheetBorderBottomStyles"
        | "spreadsheetBorderLeftStyles" => choice(
            value,
            &[
                "",
                "thin",
                "medium",
                "thick",
                "double",
                "dotted",
                "dashed",
                "dashDot",
                "dashDotDot",
                "slantDashDot",
                "hair",
                "mediumDashed",
                "mediumDashDot",
                "mediumDashDotDot",
            ],
        ),
        "spreadsheetFontFamily" => choice(value, &["sans", "serif", "mono"]),
        "spreadsheetFontSize" => integer(value, 8, 36),
        "spreadsheetBorderTopColors"
        | "spreadsheetBorderRightColors"
        | "spreadsheetBorderBottomColors"
        | "spreadsheetBorderLeftColors"
        | "spreadsheetTextColor"
        | "spreadsheetFillColor" => value.as_str().is_some_and(|value| {
            value.is_empty()
                || (value.len() == 7
                    && value.starts_with('#')
                    && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit()))
        }),
        "spreadsheetHorizontalAlign" => choice(value, &["auto", "left", "center", "right"]),
        "spreadsheetVerticalAlign" => choice(value, &["top", "middle", "bottom"]),
        "spreadsheetDecimals" => integer(value, -1, 10),
        "spreadsheetNumberFormats" => value.as_str().is_some_and(|value| {
            value.encode_utf16().count() <= 512 && !value.chars().any(|ch| ch <= '\u{001f}')
        }),
        "spreadsheetFormats" => choice(
            value,
            &[
                "general",
                "number",
                "currency",
                "percent",
                "date",
                "time",
                "scientific",
                "text",
            ],
        ),
        _ => false,
    }
}

fn known_root(root: &str) -> bool {
    matches!(
        root,
        "spreadsheetMeta"
            | "spreadsheetSheetNames"
            | "spreadsheetSheetMetadata"
            | "spreadsheetSheetOrder"
            | "spreadsheetDeletedSheets"
            | "spreadsheetSheetRevivals"
            | "spreadsheetSheetRetentions"
            | "spreadsheetColumnWidths"
            | "spreadsheetRowAdditions"
            | "spreadsheetValues"
            | "spreadsheetBold"
            | "spreadsheetItalic"
            | "spreadsheetUnderline"
            | "spreadsheetStrikethrough"
            | "spreadsheetWrap"
            | "spreadsheetBorderTop"
            | "spreadsheetBorderRight"
            | "spreadsheetBorderBottom"
            | "spreadsheetBorderLeft"
            | "spreadsheetFontNames"
            | "spreadsheetBorderTopStyles"
            | "spreadsheetBorderTopColors"
            | "spreadsheetBorderRightStyles"
            | "spreadsheetBorderRightColors"
            | "spreadsheetBorderBottomStyles"
            | "spreadsheetBorderBottomColors"
            | "spreadsheetBorderLeftStyles"
            | "spreadsheetBorderLeftColors"
            | "spreadsheetFontFamily"
            | "spreadsheetFontSize"
            | "spreadsheetTextColor"
            | "spreadsheetFillColor"
            | "spreadsheetHorizontalAlign"
            | "spreadsheetVerticalAlign"
            | "spreadsheetDecimals"
            | "spreadsheetFormats"
            | "spreadsheetNumberFormats"
    )
}

fn validate_document(doc: &LoroDoc) -> Result<(), SpreadsheetError> {
    let invalid = || {
        SpreadsheetError::Invalid(
            "Only native spreadsheet maps with supported values may be edited.",
        )
    };
    let LoroValue::Map(roots) = doc.get_value() else {
        return Err(invalid());
    };
    if !roots.contains_key("spreadsheetMeta") {
        return Err(invalid());
    }
    let mut entries = 0_usize;
    for (name, container) in roots.iter() {
        if !known_root(name)
            || !matches!(
                container,
                LoroValue::Container(ContainerID::Root {
                    container_type: ContainerType::Map,
                    ..
                })
            )
        {
            return Err(invalid());
        }
        let LoroValue::Map(fields) = doc.get_map(name.as_str()).get_value() else {
            return Err(invalid());
        };
        entries += fields.len();
        if entries > 1_000_000 {
            return Err(SpreadsheetError::TooLarge);
        }
        for (key, value) in fields.iter() {
            // Deep JSON turns nested LoroText/Counter containers into apparent
            // scalars. Check their actual CRDT types before any conversion.
            if !matches!(
                value,
                LoroValue::String(_)
                    | LoroValue::Bool(_)
                    | LoroValue::I64(_)
                    | LoroValue::Double(_)
            ) {
                return Err(invalid());
            }
            let value = serde_json::to_value(value).map_err(|_| invalid())?;
            if !valid_entry(name, key, &value) {
                return Err(invalid());
            }
        }
    }
    if doc
        .get_map("spreadsheetMeta")
        .get("formatVersion")
        .and_then(|value| value.into_value().ok())
        != Some(LoroValue::I64(1))
    {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod test;
