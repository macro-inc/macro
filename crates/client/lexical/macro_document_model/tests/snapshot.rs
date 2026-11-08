//! Service snapshot contracts, frozen bytes and retained common-ancestor containers.
use base64::Engine;
use lexical_model::*;
use loro::{ContainerTrait, LoroDoc, ToJson, ValueOrContainer};
use macro_document_model::{snapshot::*, *};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn snapshot_routes_match_source_deep_state_and_frozen_empty_bytes() -> Result<()> {
    let context = DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    };
    let base = LoroDoc::new();
    base.import(lexical_loro::golden::MARKDOWN_GOLDEN)
        .expect("golden import");
    let mut mismatches = Vec::new();
    let mut snapshots = Vec::new();
    let mut expected_states = Vec::new();
    for line in include_str!("corpus/snapshots.jsonl").lines() {
        let row: Value = serde_json::from_str(line)?;
        let input = row["input"].as_str().expect("input");
        let bytes = if row["kind"] == "markdown" {
            markdown_to_loro_snapshot(input, &context)?
        } else {
            let converted = notion_markdown_to_loro_snapshot(
                input,
                &serde_json::from_value(row["links"].clone())?,
                &context,
            )?;
            assert_eq!(
                json!(converted.markdown),
                row["markdown"],
                "Notion markdown for {input:?}"
            );
            converted.snapshot
        };
        snapshots.push(base64::engine::general_purpose::STANDARD.encode(&bytes));
        expected_states.push(row["state"].clone());
        let doc = LoroDoc::new();
        doc.import(&bytes).expect("load snapshot");
        if doc.get_deep_value().to_json_value() != row["state"] {
            mismatches.push(json!({"kind":row["kind"], "input":input,"actual":doc.get_deep_value().to_json_value(),"expected":row["state"]}));
        }
        assert_eq!(doc.get_map("root").id(), base.get_map("root").id());
        for field in ["$", "children"] {
            let Some(ValueOrContainer::Container(current)) = doc.get_map("root").get(field) else {
                panic!("snapshot container")
            };
            let Some(ValueOrContainer::Container(original)) = base.get_map("root").get(field)
            else {
                panic!("base container")
            };
            assert_eq!(current.id(), original.id(), "common ancestor {field}");
        }
        if row["golden"] == true {
            assert_eq!(bytes, lexical_loro::golden::MARKDOWN_GOLDEN);
            assert_eq!(
                bytes,
                base64::engine::general_purpose::STANDARD
                    .decode(row["bytes"].as_str().expect("golden bytes"))
                    .expect("base64 golden")
            );
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repository root");
    let encoded_snapshots = serde_json::to_vec(&snapshots)?;
    let mut child = std::process::Command::new("bun")
        .current_dir(root)
        .arg("packages/lexical-conformance/corpus/macro-snapshots.ts")
        .arg("--decode-rust")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("JS snapshot readers");
    {
        use std::io::Write;
        child
            .stdin
            .take()
            .expect("reader stdin")
            .write_all(&encoded_snapshots)
            .expect("write snapshots");
    }
    let decoded = child.wait_with_output().expect("JS snapshot decoder");
    assert!(
        decoded.status.success(),
        "{}",
        String::from_utf8_lossy(&decoded.stderr)
    );
    let imported: Vec<Vec<Value>> = serde_json::from_slice(&decoded.stdout)?;
    assert_eq!(
        imported,
        vec![expected_states.clone(), expected_states],
        "current and legacy TS clients import every native snapshot exactly"
    );
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repository root")
        .join("target/lexical-conformance/snapshot-mismatches.json");
    std::fs::create_dir_all(output.parent().expect("output parent")).expect("output directory");
    std::fs::write(output, serde_json::to_vec(&mismatches)?).expect("snapshot mismatch report");
    assert!(
        mismatches.is_empty(),
        "{} snapshot mismatches",
        mismatches.len()
    );
    Ok(())
}
