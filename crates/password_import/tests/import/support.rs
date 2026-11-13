//! Fixture loading. Large notes are spliced in here so the fixtures stay small.
use std::io::{Cursor, Write};

use zip_inflate::ZipWriter;
use zip_inflate::write::SimpleFileOptions;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
const VALUE_LIMIT: usize = password_import::vault::MAX_VALUE_BYTES;

/// A fixture with `@@NOTES_AT_LIMIT@@` / `@@NOTES_OVER_LIMIT@@` expanded.
pub fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{FIXTURES}/{name}");
    let text = std::fs::read_to_string(&path).expect("fixture is readable UTF-8");
    text.replace("@@NOTES_AT_LIMIT@@", &"n".repeat(VALUE_LIMIT))
        .replace("@@NOTES_OVER_LIMIT@@", &"o".repeat(VALUE_LIMIT + 1))
        .into_bytes()
}

/// A `.1pux` archive: `export.data` plus the attachment files 1Password adds.
pub fn one_password_pux() -> Vec<u8> {
    zip(&[
        (
            "export.attributes",
            br#"{"version":3,"description":"1Password Unencrypted Export","createdAt":1700000000}"#
                .to_vec(),
        ),
        ("export.data", fixture("one_password_export.data.json")),
        ("files/doc1__receipt.pdf", b"%PDF-synthetic".to_vec()),
    ])
}

/// A deflated zip holding `entries`.
pub fn zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip_inflate::CompressionMethod::Deflated)
        .large_file(true);

    for (name, contents) in entries {
        writer.start_file(*name, options).expect("entry starts");
        writer.write_all(contents).expect("entry is written");
    }

    writer.finish().expect("archive finishes").into_inner()
}
