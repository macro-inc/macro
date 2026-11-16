//! wasm-bindgen entry points; `apps/web/src/lib/core/password-import/wasm-module.ts`
//! types them. A file that can't be read is an outcome, not a throw; only a
//! failure to build the JavaScript value throws.

use password_import::{Limits, detect as sniff, parse as read};
use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use wasm_bindgen::prelude::*;

use crate::wire::{Detected, ExportWire, Parsed, parse_format};

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    // Plain objects for the summary's count maps, not JavaScript `Map`s.
    value
        .serialize(&Serializer::json_compatible())
        .map_err(|_| JsError::new("could not build the result"))
}

/// Sniffs the format of `bytes`.
///
/// # Errors
///
/// Throws only when the result can't be built.
#[wasm_bindgen]
pub fn detect(bytes: &[u8]) -> Result<JsValue, JsError> {
    to_js(&match sniff(bytes, &Limits::default()) {
        Ok(format) => Detected::Detected { format },
        Err(error) => Detected::Failed { error },
    })
}

/// Parses `bytes` as `format` (`one_password_pux`, `one_password_csv`,
/// `bitwarden_json` or `bitwarden_csv`) with the default limits.
///
/// # Errors
///
/// Throws when `format` is not one of those, or the result can't be built.
#[wasm_bindgen]
pub fn parse(bytes: &[u8], format: &str) -> Result<JsValue, JsError> {
    let format = parse_format(format).ok_or_else(|| JsError::new("unknown format"))?;
    match read(bytes, format, &Limits::default()) {
        Ok(export) => to_js(&Parsed::Parsed {
            export: ExportWire::new(&export),
        }),
        Err(error) => to_js(&Parsed::Failed { error }),
    }
}
