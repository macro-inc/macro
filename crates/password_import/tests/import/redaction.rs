//! `Debug` never shows content: every name, URL, label, folder and value the
//! parser produced is absent from the `Debug` of every public type.
use password_import::{ImportError, Limits, ParsedExport, SourceFormat, detect, parse};
use serde_json::Value;

use super::support::{fixture, one_password_pux, zip};

const SENTINEL: &str = "S3NT1NEL-value";

/// Every string the export carries, other than its source keys and enum names.
fn content_strings(export: &ParsedExport) -> Vec<String> {
    fn collect(value: &Value, key: &str, strings: &mut Vec<String>) {
        match value {
            Value::String(text)
                if !matches!(key, "sourceKey" | "kind" | "reason" | "what" | "format") =>
            {
                strings.push(text.clone());
            }
            Value::Array(values) => values.iter().for_each(|value| collect(value, key, strings)),
            Value::Object(map) => map
                .iter()
                .for_each(|(key, value)| collect(value, key, strings)),
            _ => {}
        }
    }

    let mut strings = Vec::new();
    collect(
        &serde_json::to_value(export).expect("serializes"),
        "",
        &mut strings,
    );
    strings
}

fn debug_of_everything(export: &ParsedExport) -> String {
    let mut debug = format!("{export:?}\n{:?}\n", export.summary());
    for item in &export.items {
        debug.push_str(&format!(
            "{item:?} {:?} {:?} {:?} {:?} {:?} {:?} {:?} {:#?}\n",
            item.source_key,
            item.username,
            item.password,
            item.notes,
            item.totp,
            item.folder,
            item.fields,
            item
        ));
    }
    for skipped in &export.skipped {
        debug.push_str(&format!("{skipped:?} {skipped:#?}\n"));
    }
    for dropped in &export.dropped {
        debug.push_str(&format!("{dropped:?}\n"));
    }
    for folder in &export.folders {
        debug.push_str(&format!("{folder:?}\n"));
    }
    debug
}

fn assert_redacted(bytes: &[u8], format: SourceFormat) {
    let export = parse(bytes, format, &Limits::default()).expect("parses");
    let debug = debug_of_everything(&export);

    let strings = content_strings(&export);
    assert!(
        strings.len() > 20,
        "the fixture should carry plenty of content"
    );

    // Debug prints source keys and type names by design; content that merely
    // repeats one of those (`Field`, `true`, an id-like title) proves nothing.
    let source_keys: Vec<&str> = export
        .items
        .iter()
        .map(|item| item.source_key.as_str())
        .chain(
            export
                .skipped
                .iter()
                .filter_map(|skipped| skipped.source_key.as_ref().map(|key| key.as_str())),
        )
        .collect();
    let printed_by_design = |text: &str| {
        matches!(text, "Field" | "true" | "false")
            || source_keys.iter().any(|key| key.contains(text))
    };

    for text in strings
        .iter()
        .filter(|text| text.len() >= 4 && !printed_by_design(text))
    {
        assert!(
            !debug.contains(text.as_str()),
            "Debug output shows content of {format:?}: {text}"
        );
    }
}

#[test]
fn one_password_pux_debug_is_redacted() {
    assert_redacted(&one_password_pux(), SourceFormat::OnePasswordPux);
}

#[test]
fn one_password_csv_debug_is_redacted() {
    assert_redacted(&fixture("one_password.csv"), SourceFormat::OnePasswordCsv);
}

#[test]
fn bitwarden_json_debug_is_redacted() {
    assert_redacted(&fixture("bitwarden.json"), SourceFormat::BitwardenJson);
}

#[test]
fn bitwarden_csv_debug_is_redacted() {
    assert_redacted(&fixture("bitwarden.csv"), SourceFormat::BitwardenCsv);
}

#[test]
fn errors_show_no_content() {
    let broken_json = format!(r#"{{"items": [{{"name": "{SENTINEL}" "#);
    let unsafe_zip = zip(&[(&format!("../{SENTINEL}"), b"x".to_vec())]);
    let headerless_csv = format!("{SENTINEL},{SENTINEL}\n{SENTINEL}");
    let pux_without_accounts = zip(&[(
        "export.data",
        format!(r#"{{"{SENTINEL}": 1}}"#).into_bytes(),
    )]);

    let errors: Vec<ImportError> = vec![
        detect(broken_json.as_bytes(), &Limits::default()).expect_err("broken JSON"),
        parse(
            broken_json.as_bytes(),
            SourceFormat::BitwardenJson,
            &Limits::default(),
        )
        .expect_err("broken JSON"),
        parse(
            &unsafe_zip,
            SourceFormat::OnePasswordPux,
            &Limits::default(),
        )
        .expect_err("unsafe zip"),
        detect(headerless_csv.as_bytes(), &Limits::default()).expect_err("unknown CSV"),
        parse(
            headerless_csv.as_bytes(),
            SourceFormat::BitwardenCsv,
            &Limits::default(),
        )
        .expect_err("unknown CSV"),
        parse(
            &pux_without_accounts,
            SourceFormat::OnePasswordPux,
            &Limits::default(),
        )
        .expect_err("no accounts"),
    ];

    for error in errors {
        assert!(!format!("{error:?} {error}").contains("S3NT1NEL"));
    }
}

#[test]
fn secret_debug_is_fixed() {
    let export = parse(
        &fixture("bitwarden.json"),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");
    let item = export.items.first().expect("an item");

    assert_eq!(format!("{:?}", item.password), "Secret(..)");
    assert_eq!(format!("{:?}", item.totp), "Some(TotpSeed(Secret(..)))");
}
