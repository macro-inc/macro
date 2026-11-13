//! The vault's limits: one item, a team's folders, and one import batch.
//! `crates/passwords` validates with these constants, imports apply the item
//! limits before the preview so its counts are what the vault will accept, and
//! the web client reads them from `password_import_wasm`'s `limits.json`.

/// Longest item name, in bytes.
pub const MAX_NAME_BYTES: usize = 200;
/// Longest custom field label, in bytes.
pub const MAX_LABEL_BYTES: usize = 200;
/// Longest username, password, notes or field value, in bytes.
pub const MAX_VALUE_BYTES: usize = 64 * 1024;
/// Most custom fields on one item.
pub const MAX_FIELDS: usize = 50;
/// Longest login URL, in bytes.
pub const MAX_URL_BYTES: usize = 2048;
/// Longest folder name, in bytes.
pub const MAX_FOLDER_NAME_BYTES: usize = 200;
/// Longest TOTP seed (base32, padding included), in bytes.
pub const MAX_TOTP_SEED_BYTES: usize = 1024;
/// Most bytes one item may take as JSON, escapes included. Each limit above
/// allows more in total than one write request carries.
pub const MAX_ITEM_JSON_BYTES: usize = 1024 * 1024;

/// Most folders one team may have.
pub const MAX_TEAM_FOLDERS: usize = 500;
/// Deepest folder nesting, counting a top-level folder as depth one.
pub const MAX_FOLDER_DEPTH: usize = 8;

/// Most items in one import batch request.
pub const MAX_IMPORT_BATCH_ITEMS: usize = 25;
/// Most source folders in one import batch request.
pub const MAX_IMPORT_BATCH_FOLDERS: usize = 200;
/// Largest import batch request body.
pub const MAX_IMPORT_BATCH_BYTES: usize = 4 * 1024 * 1024;
/// Most names one duplicate-match request may carry, and most items it returns.
pub const MAX_IMPORT_MATCH_NAMES: usize = 500;

/// The vault's login URL rule: at most [`MAX_URL_BYTES`], http(s), a host,
/// and no credentials.
pub fn is_login_url(value: &str) -> bool {
    if value.len() > MAX_URL_BYTES {
        return false;
    }

    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };

    matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(|host| !host.is_empty())
        && !has_credentials(&parsed)
}

/// Whether `value` parses as a URL carrying a username or password.
pub(crate) fn url_has_credentials(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|parsed| has_credentials(&parsed))
}

fn has_credentials(url: &url::Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

/// Bytes `value` takes as a JSON string, quotes and escapes included.
pub(crate) fn json_string_bytes(value: &str) -> usize {
    let escaped: usize = value
        .bytes()
        .map(|byte| match byte {
            b'"' | b'\\' | b'\n' | b'\r' | b'\t' | 0x08 | 0x0c => 2,
            0x00..=0x1f => 6,
            _ => 1,
        })
        .sum();
    escaped + 2
}
