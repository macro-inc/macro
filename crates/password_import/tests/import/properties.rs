//! Parsers are total: arbitrary bytes and mutated real fixtures yield a value
//! or a typed error, never a panic.
use password_import::{Limits, SourceFormat, detect, parse};
use proptest::prelude::*;

use super::support::{fixture, one_password_pux};

const FORMATS: [SourceFormat; 4] = [
    SourceFormat::OnePasswordPux,
    SourceFormat::OnePasswordCsv,
    SourceFormat::BitwardenJson,
    SourceFormat::BitwardenCsv,
];

/// Overwrite, insert and truncate bytes of `original`.
fn mutate(original: &[u8], edits: &[(usize, u8, u8)], truncate_to: usize) -> Vec<u8> {
    let mut bytes = original.to_vec();
    for &(position, byte, operation) in edits {
        let position = position % (bytes.len() + 1);
        match operation % 3 {
            0 if position < bytes.len() => bytes[position] = byte,
            1 => bytes.insert(position, byte),
            _ if position < bytes.len() => {
                bytes.remove(position);
            }
            _ => {}
        }
    }
    bytes.truncate(truncate_to.max(1).min(bytes.len()));
    bytes
}

fn parse_every_format(bytes: &[u8]) {
    let _ = detect(bytes, &Limits::default());
    for format in FORMATS {
        if let Ok(export) = parse(bytes, format, &Limits::default()) {
            let _ = export.summary();
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn arbitrary_bytes_never_panic(bytes in proptest::collection::vec(any::<u8>(), 0..2048)) {
        parse_every_format(&bytes);
    }

    #[test]
    fn arbitrary_zip_prefixed_bytes_never_panic(bytes in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut archive = b"PK\x03\x04".to_vec();
        archive.extend(bytes);
        parse_every_format(&archive);
    }

    #[test]
    fn arbitrary_json_and_csv_text_never_panics(text in "[{}\\[\\]\":,0-9a-z \n\r\t\\\\]{0,512}") {
        parse_every_format(text.as_bytes());
    }

    #[test]
    fn mutated_one_password_pux_never_panics(
        edits in proptest::collection::vec((any::<usize>(), any::<u8>(), any::<u8>()), 0..8),
        truncate_to in any::<usize>(),
    ) {
        parse_every_format(&mutate(&one_password_pux(), &edits, truncate_to));
    }

    #[test]
    fn mutated_text_exports_never_panic(
        fixture_index in 0..4usize,
        edits in proptest::collection::vec((any::<usize>(), any::<u8>(), any::<u8>()), 0..8),
        truncate_to in any::<usize>(),
    ) {
        let name = ["one_password.csv", "bitwarden.json", "bitwarden.csv", "one_password_export.data.json"][fixture_index];
        parse_every_format(&mutate(&fixture(name), &edits, truncate_to));
    }
}
