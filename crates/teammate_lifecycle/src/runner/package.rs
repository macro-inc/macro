//! What the boot reads from a package.json: the muppet API levels and the
//! dependency fields.

use serde_json::Value;

use crate::boot::Garbled;

/// The code's need: package.json's `muppetApi`.
pub const NEEDS_FIELD: &str = "muppetApi";

/// The image muppet's level: its package.json's `apiLevel`.
pub const HAS_FIELD: &str = "apiLevel";

/// The largest whole number JavaScript holds exactly, as
/// `Number.isSafeInteger` bounds it.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// The fields whose change means the agent changed its dependencies.
const DEPENDENCY_FIELDS: [&str; 6] = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "workspaces",
    "overrides",
];

/// `field` of the package.json in `contents` as a whole number, 0 when
/// absent. Anything else, or JSON that doesn't parse, is garbled.
pub fn level(contents: &[u8], field: &str) -> Result<u64, Garbled> {
    let json: Value = serde_json::from_slice(contents).map_err(|_| Garbled)?;
    let Some(value) = json.get(field) else {
        return Ok(0);
    };
    if let Some(whole) = value.as_u64() {
        return (whole <= MAX_SAFE_INTEGER).then_some(whole).ok_or(Garbled);
    }
    // A float that is a whole number (`2.0`) passes, as in JavaScript.
    let Some(float) = value.as_f64() else {
        return Err(Garbled);
    };
    let whole = float.fract() == 0.0 && (0.0..=MAX_SAFE_INTEGER as f64).contains(&float);
    if whole {
        Ok(float as u64)
    } else {
        Err(Garbled)
    }
}

/// Whether two package.jsons differ in their dependency fields. One that
/// can't be read counts as a change, as `start-agent` counted it.
pub fn dependencies_differ(ours: Option<&[u8]>, template: Option<&[u8]>) -> bool {
    let fields = |contents: Option<&[u8]>| -> Option<Vec<Value>> {
        let json: Value = serde_json::from_slice(contents?).ok()?;
        let fields = DEPENDENCY_FIELDS
            .iter()
            .map(|field| json.get(*field).cloned().unwrap_or(Value::Null))
            .collect();
        Some(fields)
    };
    match (fields(ours), fields(template)) {
        (Some(ours), Some(template)) => ours != template,
        _ => true,
    }
}
