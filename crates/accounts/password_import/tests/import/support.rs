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

/// A Bitwarden zip export laid out as `bw export --format zip` writes it:
/// `data.json`, then a directory per item with attachments. The archived
/// item's attachments include one named `data.json`.
pub fn bitwarden_zip() -> Vec<u8> {
    let data = fixture("bitwarden_zip_data.json");
    // Names ending in `/` are directory entries.
    let entries: [(&str, &[u8]); 11] = [
        ("data.json", &data),
        ("attachments/", b""),
        ("attachments/b1000000-0000-4000-8000-000000000003/", b""),
        (
            "attachments/b1000000-0000-4000-8000-000000000003/data.json",
            br#"{"attachment":true}"#,
        ),
        (
            "attachments/b1000000-0000-4000-8000-000000000003/binary.bin",
            &[0, 1, 2, 3],
        ),
        ("attachments/b1000000-0000-4000-8000-000000000001/", b""),
        (
            "attachments/b1000000-0000-4000-8000-000000000001/readme.txt",
            b"attachment\n",
        ),
        ("attachments/b1000000-0000-4000-8000-000000000006/", b""),
        (
            "attachments/b1000000-0000-4000-8000-000000000006/ünïcødé name 📎.txt",
            b"attachment\n",
        ),
        ("attachments/b1000000-0000-4000-8000-000000000002/", b""),
        (
            "attachments/b1000000-0000-4000-8000-000000000002/recovery-codes.txt",
            b"attachment\n",
        ),
    ];

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        SimpleFileOptions::default().compression_method(zip_inflate::CompressionMethod::Deflated);
    for (name, contents) in entries {
        if name.ends_with('/') {
            writer
                .add_directory(name, options)
                .expect("directory is added");
        } else {
            writer.start_file(name, options).expect("entry starts");
            writer.write_all(contents).expect("entry is written");
        }
    }

    writer.finish().expect("archive finishes").into_inner()
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
