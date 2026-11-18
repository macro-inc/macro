//! Source CodeNode exportJSON omits an unset language; the mirror retains null.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use loro::ExportMode;
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::{Value, json};

#[test]
fn source_code_language_survives_fresh_attach_without_rewriting_storage() -> Result<()> {
    for ty in ["code", "custom-code"] {
        for language in [
            None,
            Some(Value::Null),
            Some(json!("")),
            Some(json!("javascript")),
        ] {
            let mut code = json!({"type":ty,"version":1,"children":[],"previewEnabled":false});
            if let Some(value) = &language {
                code["language"] = value.clone();
            }
            let original = headless_builder()
                .initial_state(serde_json::from_value(json!({"root":{
                    "type":"root","version":1,"children":[code]
                }}))?)
                .build()?;
            let expected = original.state().to_json()?;
            // Actual OFF CodeNode.setLanguage exports undefined for absent/null/empty.
            if language == Some(json!("javascript")) {
                assert_eq!(expected.root["children"][0]["language"], "javascript");
            } else {
                assert!(expected.root["children"][0].get("language").is_none());
            }
            let mut persisted = expected.clone();
            if language != Some(json!("javascript")) {
                persisted.root["children"][0]["language"] = Value::Null;
            }
            let writer = new_doc(91)?;
            lexical_loro::mirror::set_synced_state(&writer, &persisted, &PlainPolicy)?;
            let snapshot = writer
                .export(ExportMode::Snapshot)
                .expect("source snapshot");
            drop(original);
            drop(writer);
            let doc = new_doc(92)?;
            doc.import(&snapshot).expect("fresh snapshot import");
            let value = doc.get_deep_value();
            let vv = doc.oplog_vv();
            let stored = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
            let fresh = headless_builder().initial_state(stored).build()?;
            assert_eq!(fresh.state().to_json()?, expected);
            LoroProjection::attach(&doc, fresh.state(), &MACRO_SYNC_POLICY)?;
            assert_eq!(doc.get_deep_value(), value);
            assert_eq!(doc.oplog_vv(), vv);
            assert_eq!(reconstruct_state(&doc, &PlainPolicy)?, persisted);
        }
    }
    Ok(())
}

#[test]
fn language_canonicalization_preserves_unknown_nulls_and_nonnull_values() {
    use lexical_loro::SyncPolicy;
    for ty in ["code", "custom-code", "paragraph"] {
        for language in [Value::Null, json!(""), json!("javascript"), json!([null])] {
            let mut node = serde_json::Map::from_iter([
                ("type".to_owned(), json!(ty)),
                ("language".to_owned(), language.clone()),
                ("unknown".to_owned(), Value::Null),
            ]);
            MACRO_SYNC_POLICY.canonicalize_node_json(&mut node);
            if ty != "paragraph" && language.is_null() {
                assert!(!node.contains_key("language"));
            } else {
                assert_eq!(node.get("language"), Some(&language));
            }
            assert_eq!(node.get("unknown"), Some(&Value::Null));
        }
    }
}
