use password_import::{Limits, SourceFormat, detect, parse};
use serde_json::Value;

use crate::{Detected, ExportWire, Parsed, parse_format};

const BITWARDEN_JSON: &[u8] = include_bytes!("../../password_import/tests/fixtures/bitwarden.json");

fn wire(bytes: &[u8]) -> Value {
    let format = detect(bytes, &Limits::default()).expect("fixture is detected");
    let export = parse(bytes, format, &Limits::default()).expect("fixture parses");
    serde_json::to_value(Parsed::Parsed {
        export: ExportWire::new(&export),
    })
    .expect("serializes")
}

#[test]
fn folders_link_parents_by_key_and_items_reference_them() {
    let value = wire(BITWARDEN_JSON);
    assert_eq!(value["outcome"], "parsed");
    let export = &value["export"];
    let folders = export["folders"].as_array().expect("folders");
    assert!(!folders.is_empty());
    let keys: Vec<&str> = folders
        .iter()
        .map(|folder| folder["key"].as_str().expect("key"))
        .collect();
    for (index, folder) in folders.iter().enumerate() {
        assert_eq!(folder["key"], format!("folder:{index}"));
        let path = folder["path"].as_array().expect("path");
        assert_eq!(folder["name"], *path.last().expect("named"));
        match folder["parentKey"].as_str() {
            None => assert_eq!(path.len(), 1),
            // Parents come first, so the parent's key is an earlier one.
            Some(parent) => assert!(keys[..index].contains(&parent)),
        }
    }
    for item in export["items"].as_array().expect("items") {
        if let Some(key) = item["folderKey"].as_str() {
            assert!(keys.contains(&key));
        }
        let fields = item["values"]["fields"].as_array().expect("fields");
        for field in fields {
            let object = field.as_object().expect("field object");
            let mut names: Vec<&str> = object.keys().map(String::as_str).collect();
            names.sort_unstable();
            assert_eq!(names, ["label", "value"]);
        }
    }
}

#[test]
fn items_carry_the_batch_item_keys() {
    let value = wire(BITWARDEN_JSON);
    let item = &value["export"]["items"][0];
    let object = item.as_object().expect("item object");
    let mut names: Vec<&str> = object.keys().map(String::as_str).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "favorite",
            "folderKey",
            "kind",
            "name",
            "sourceKey",
            "totp",
            "url",
            "values"
        ]
    );
}

#[test]
fn summary_counts_are_objects_keyed_by_wire_names() {
    let value = wire(BITWARDEN_JSON);
    let counts = value["export"]["summary"]["itemsByKind"]
        .as_object()
        .expect("counts");
    assert!(counts.contains_key("login"));
}

#[test]
fn failures_are_tagged_codes() {
    let value = serde_json::to_value(Detected::Failed {
        error: detect(b"not an export", &Limits::default()).expect_err("unknown"),
    })
    .expect("serializes");
    assert_eq!(value["outcome"], "failed");
    assert_eq!(value["error"]["code"], "unknown_format");
}

#[test]
fn format_names_round_trip() {
    for format in [
        SourceFormat::OnePasswordPux,
        SourceFormat::OnePasswordCsv,
        SourceFormat::BitwardenJson,
        SourceFormat::BitwardenCsv,
    ] {
        let name = serde_json::to_value(format).expect("serializes");
        assert_eq!(
            parse_format(name.as_str().expect("string")).map(|f| serde_json::to_value(f).ok()),
            Some(Some(name.clone()))
        );
    }
    assert!(parse_format("lastpass").is_none());
}

/// The web client reads the limits from this file; it must match the Rust
/// constants. On a mismatch, replace the file with the printed value.
#[test]
fn web_limits_file_matches_the_vault_limits() {
    use password_import::vault;
    let limits = Limits::default();
    let expected = serde_json::json!({
        "maxInputBytes": limits.max_input_bytes,
        "maxItems": limits.max_items,
        "maxListItems": vault::MAX_LIST_ITEMS,
        "maxTeamFolders": vault::MAX_TEAM_FOLDERS,
        "maxFolderDepth": vault::MAX_FOLDER_DEPTH,
        "maxImportBatchItems": vault::MAX_IMPORT_BATCH_ITEMS,
        "maxImportBatchFolders": vault::MAX_IMPORT_BATCH_FOLDERS,
        "maxImportBatchBytes": vault::MAX_IMPORT_BATCH_BYTES,
        "maxImportMatchNames": vault::MAX_IMPORT_MATCH_NAMES,
    });
    let web: Value = serde_json::from_str(include_str!(
        "../../../apps/web/src/lib/core/password-import/limits.json"
    ))
    .expect("limits.json is JSON");
    assert_eq!(
        web,
        expected,
        "apps/web/src/lib/core/password-import/limits.json should be:\n{}",
        serde_json::to_string_pretty(&expected).expect("serializes")
    );
}

/// `apps/web`'s `wire-sample.json` is this adapter's output for the synthetic
/// Bitwarden fixture; a web test checks its shape against `types.ts`. On a
/// mismatch, replace the file with this test's actual value.
#[test]
fn web_wire_sample_is_the_adapter_output() {
    let web: Value = serde_json::from_str(include_str!(
        "../../../apps/web/src/lib/core/password-import/wire-sample.json"
    ))
    .expect("wire-sample.json is JSON");
    assert_eq!(web, wire(BITWARDEN_JSON));
}
