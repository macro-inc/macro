//! File-level limits and archive safety.
use password_import::{ImportError, Limits, SourceFormat, detect, parse};

use super::support::{fixture, zip};

const MINIMAL_EXPORT: &[u8] = br#"{"accounts": []}"#;

#[test]
fn input_over_the_size_limit_is_refused() {
    let limits = Limits {
        max_input_bytes: 10,
        ..Limits::default()
    };

    assert_eq!(
        parse(
            &fixture("bitwarden.json"),
            SourceFormat::BitwardenJson,
            &limits
        )
        .err(),
        Some(ImportError::TooLarge)
    );
}

#[test]
fn high_ratio_entry_stops_at_the_inflate_limit() {
    // 64 MiB of zeros deflates to about 64 KiB.
    let bomb = zip(&[("export.data", vec![0; 64 * 1024 * 1024])]);
    assert!(bomb.len() < 1024 * 1024);
    let limits = Limits {
        max_decompressed_bytes: 1024 * 1024,
        ..Limits::default()
    };

    assert_eq!(
        parse(&bomb, SourceFormat::OnePasswordPux, &limits).err(),
        Some(ImportError::ZipBomb)
    );
}

#[test]
fn entry_exactly_at_the_inflate_limit_is_read() {
    let archive = zip(&[("export.data", MINIMAL_EXPORT.to_vec())]);
    let limits = Limits {
        max_decompressed_bytes: MINIMAL_EXPORT.len() as u64,
        ..Limits::default()
    };

    let export = parse(&archive, SourceFormat::OnePasswordPux, &limits).expect("parses");
    assert_eq!(export.items.len(), 0);
}

#[test]
fn too_many_entries_are_refused() {
    let limits = Limits {
        max_zip_entries: 2,
        ..Limits::default()
    };
    let at_limit = zip(&[
        ("export.data", MINIMAL_EXPORT.to_vec()),
        ("files/1", Vec::new()),
    ]);
    let over_limit = zip(&[
        ("export.data", MINIMAL_EXPORT.to_vec()),
        ("files/1", Vec::new()),
        ("files/2", Vec::new()),
    ]);

    assert!(parse(&at_limit, SourceFormat::OnePasswordPux, &limits).is_ok());
    assert_eq!(
        parse(&over_limit, SourceFormat::OnePasswordPux, &limits).err(),
        Some(ImportError::TooManyEntries)
    );
    assert_eq!(
        detect(&over_limit, &limits),
        Err(ImportError::TooManyEntries)
    );
}

#[test]
fn unsafe_entry_names_fail_the_whole_file() {
    for name in [
        "../escape",
        "files/../../escape",
        "/absolute",
        "files\\windows",
        "..",
    ] {
        let archive = zip(&[
            ("export.data", MINIMAL_EXPORT.to_vec()),
            (name, b"x".to_vec()),
        ]);

        assert_eq!(
            parse(&archive, SourceFormat::OnePasswordPux, &Limits::default()).err(),
            Some(ImportError::PathTraversal),
            "entry {name:?}"
        );
    }
}

#[test]
fn names_with_dots_inside_are_allowed() {
    let archive = zip(&[
        ("export.data", MINIMAL_EXPORT.to_vec()),
        ("files/a..b.pdf", b"x".to_vec()),
    ]);

    assert!(parse(&archive, SourceFormat::OnePasswordPux, &Limits::default()).is_ok());
}

#[test]
fn archive_without_export_data_is_refused() {
    let archive = zip(&[("export.attributes", b"{}".to_vec())]);

    assert_eq!(
        detect(&archive, &Limits::default()),
        Err(ImportError::MissingExportData)
    );
}

#[test]
fn truncated_archive_is_invalid() {
    assert_eq!(
        parse(
            b"PK\x03\x04truncated",
            SourceFormat::OnePasswordPux,
            &Limits::default()
        )
        .err(),
        Some(ImportError::InvalidZip)
    );
}

#[test]
fn too_many_items_are_refused_in_every_format() {
    let limits = Limits {
        max_items: 1,
        ..Limits::default()
    };

    assert_eq!(
        parse(
            &fixture("bitwarden.json"),
            SourceFormat::BitwardenJson,
            &limits
        )
        .err(),
        Some(ImportError::TooManyItems)
    );
    assert_eq!(
        parse(
            &fixture("bitwarden.csv"),
            SourceFormat::BitwardenCsv,
            &limits
        )
        .err(),
        Some(ImportError::TooManyItems)
    );
    assert_eq!(
        parse(
            &fixture("one_password.csv"),
            SourceFormat::OnePasswordCsv,
            &limits
        )
        .err(),
        Some(ImportError::TooManyItems)
    );
    assert_eq!(
        parse(
            &super::support::one_password_pux(),
            SourceFormat::OnePasswordPux,
            &limits
        )
        .err(),
        Some(ImportError::TooManyItems)
    );
}

#[test]
fn unknown_inputs_are_typed_errors() {
    assert_eq!(
        detect(b"", &Limits::default()),
        Err(ImportError::UnknownFormat)
    );
    assert_eq!(
        detect(b"name,value\nx,y\n", &Limits::default()),
        Err(ImportError::UnknownFormat)
    );
    assert_eq!(
        detect(br#"{"accounts": []}"#, &Limits::default()),
        Err(ImportError::UnknownFormat)
    );
    assert_eq!(
        detect(b"{\n\"items\": [\n", &Limits::default()),
        Err(ImportError::InvalidJson { line: 3 })
    );
    assert_eq!(
        parse(
            b"title,url\n",
            SourceFormat::OnePasswordCsv,
            &Limits::default()
        )
        .err(),
        Some(ImportError::InvalidCsv { row: 1 })
    );
    assert_eq!(
        parse(
            br#"{"folders": []}"#,
            SourceFormat::BitwardenJson,
            &Limits::default()
        )
        .err(),
        Some(ImportError::UnsupportedVersion)
    );
}

/// Synthetic 1Password 7 Windows CSVs: a login row, and a card export that has
/// no username or password column at all.
const ONE_PASSWORD_7_LOGIN: &[u8] = b"\"UUID\",\"TITLE\",\"USERNAME\",\"PASSWORD\",\"URL\",\"URLS\",\"SCOPE\",\"AUTOSUBMIT\",\"TAGS\",\"NOTES\",\"SECTION 1: NAME\",\"NAME 1: FIRST NAME\"\n\"aaaaaaaaaaaaaaaaaaaaaaaaaa\",\"Example login\",\"user-one\",\"not-a-real-password\",\"https://example.com\",\"https://example.com\",\"Default\",\"Default\",\"\",\"\",\"\",\"\"\n";
const ONE_PASSWORD_7_CARD: &[u8] = b"\"UUID\",\"TITLE\",\"SCOPE\",\"AUTOSUBMIT\",\"1: CARDHOLDER NAME\",\"2: NUMBER\"\n\"bbbbbbbbbbbbbbbbbbbbbbbbbb\",\"Example card\",\"Default\",\"Default\",\"Card Holder\",\"4000000000000002\"\n";

#[test]
fn one_password_7_csv_is_refused_as_an_unsupported_version() {
    for file in [ONE_PASSWORD_7_LOGIN, ONE_PASSWORD_7_CARD] {
        assert_eq!(
            detect(file, &Limits::default()),
            Err(ImportError::UnsupportedVersion)
        );
        assert_eq!(
            parse(file, SourceFormat::OnePasswordCsv, &Limits::default()).err(),
            Some(ImportError::UnsupportedVersion)
        );
    }
}
