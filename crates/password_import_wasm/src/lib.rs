//! Browser adapter for [`password_import`]: the shapes the web import dialog
//! receives, and (on wasm32) the wasm-bindgen entry points its worker calls.
//!
//! Items come out in the vault's import batch shape (`PasswordImportItem`),
//! with source folders keyed by an opaque key and linked by parent key, so the
//! browser sends them as they are.
#![deny(missing_docs)]

mod wire;

#[cfg(target_arch = "wasm32")]
mod bindings;

pub use wire::{
    Detected, ExportWire, FieldWire, FolderWire, ItemWire, Parsed, ValuesWire, parse_format,
};

#[cfg(test)]
mod test;
