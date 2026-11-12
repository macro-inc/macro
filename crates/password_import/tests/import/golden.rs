//! Full normalized output of each synthetic export.
use password_import::{Limits, ParsedExport, SourceFormat, detect, parse};
use serde_json::Value;

use super::support::fixture;

/// The export and its summary as JSON, with long values shown by length.
fn snapshot(export: &ParsedExport) -> Value {
    let mut value = serde_json::json!({
        "summary": export.summary(),
        "export": export,
    });
    abbreviate(&mut value);
    value
}

fn abbreviate(value: &mut Value) {
    match value {
        Value::String(text) if text.len() > 200 => {
            let first = text.chars().next().unwrap_or_default();
            *text = format!("<{} bytes of {first:?}>", text.len());
        }
        Value::Array(values) => values.iter_mut().for_each(abbreviate),
        Value::Object(map) => map.values_mut().for_each(abbreviate),
        _ => {}
    }
}

#[test]
fn one_password_pux() {
    let bytes = super::support::one_password_pux();
    assert_eq!(detect(&bytes), Ok(SourceFormat::OnePasswordPux));

    let export = parse(&bytes, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");
    insta::assert_json_snapshot!(snapshot(&export));
}

#[test]
fn one_password_csv() {
    let bytes = fixture("one_password.csv");
    assert_eq!(detect(&bytes), Ok(SourceFormat::OnePasswordCsv));

    let export = parse(&bytes, SourceFormat::OnePasswordCsv, &Limits::default()).expect("parses");
    insta::assert_json_snapshot!(snapshot(&export));
}

#[test]
fn bitwarden_json() {
    let bytes = fixture("bitwarden.json");
    assert_eq!(detect(&bytes), Ok(SourceFormat::BitwardenJson));

    let export = parse(&bytes, SourceFormat::BitwardenJson, &Limits::default()).expect("parses");
    insta::assert_json_snapshot!(snapshot(&export));
}

#[test]
fn bitwarden_csv() {
    let bytes = fixture("bitwarden.csv");
    assert_eq!(detect(&bytes), Ok(SourceFormat::BitwardenCsv));

    let export = parse(&bytes, SourceFormat::BitwardenCsv, &Limits::default()).expect("parses");
    insta::assert_json_snapshot!(snapshot(&export));
}

#[test]
fn bitwarden_organization_csv_skips_every_row() {
    let bytes = fixture("bitwarden_organization.csv");
    assert_eq!(detect(&bytes), Ok(SourceFormat::BitwardenCsv));

    let export = parse(&bytes, SourceFormat::BitwardenCsv, &Limits::default()).expect("parses");
    insta::assert_json_snapshot!(snapshot(&export));
}

#[test]
fn encrypted_bitwarden_json_is_refused() {
    let bytes = fixture("bitwarden_encrypted.json");

    assert_eq!(detect(&bytes), Err(password_import::ImportError::EncryptedBitwarden));
    assert_eq!(
        parse(&bytes, SourceFormat::BitwardenJson, &Limits::default()).map(|export| export.items.len()),
        Err(password_import::ImportError::EncryptedBitwarden)
    );
}

