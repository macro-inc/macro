//! Exact service gate assertions and fixed-seed hostile JSON differential.
use lexical_model::SerializedEditorState;
use macro_document_model::{Result, comment_gate::*, *};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Divergence {
    index: usize,
    oracle_sha256: String,
    error: String,
    source_comment_only: bool,
}
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Deserialize)]
struct Case {
    index: usize,
    before: Value,
    after: Value,
    expected: Value,
}

#[test]
fn gate_matches_twenty_thousand_service_oracle_cases() -> Result<()> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repository root");
    let output = root.join("target/lexical-conformance/gate-oracle.jsonl");
    std::fs::create_dir_all(output.parent().expect("output parent")).expect("create oracle output");
    if std::env::var_os("MACRO_GATE_REUSE_ORACLE").is_none() {
        let run = std::process::Command::new("bun")
            .current_dir(root)
            .arg("packages/lexical-conformance/diff/gate-fuzz/generate.ts")
            .arg(&output)
            .output()
            .expect("Bun service oracle");
        assert!(
            run.status.success(),
            "{}",
            String::from_utf8_lossy(&run.stderr)
        );
    }
    let rows = std::fs::read_to_string(&output).expect("generated oracle");
    let context = DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    };
    let mut ledger: BTreeMap<_, _> =
        serde_json::from_str::<Vec<Divergence>>(include_str!("corpus/gate-divergences.json"))?
            .into_iter()
            .map(|entry| (entry.index, entry))
            .collect();
    let mut ledger_count = 0;
    let mut failures = Vec::new();
    let mut records = Vec::new();
    let mut counts = [0; 3];
    for line in rows.lines() {
        let case: Case = serde_json::from_str(line)?;
        let observed = (|| -> Result<Value> {
            let before: SerializedEditorState = serde_json::from_value(case.before.clone())?;
            let after: SerializedEditorState = serde_json::from_value(case.after.clone())?;
            let left = content_without_comments_with_context(&before, &context)?;
            let right = content_without_comments_with_context(&after, &context)?;
            Ok(json!({"commentOnly":left == right,"before":left,"after":right}))
        })();
        let error = observed.as_ref().err().map(ToString::to_string);
        let actual = observed.unwrap_or_else(|_| json!({"throws":true}));
        let count = if actual["throws"] == true {
            2
        } else if actual["commentOnly"] == true {
            0
        } else {
            1
        };
        counts[count] += 1;
        if let Some(entry) = ledger.remove(&case.index) {
            assert_eq!(
                format!("{:x}", Sha256::digest(line.as_bytes())),
                entry.oracle_sha256,
                "exact oracle row changed at {}",
                case.index
            );
            assert_eq!(
                actual,
                json!({"throws":true}),
                "fail-closed ruling at {}",
                case.index
            );
            assert_eq!(
                error.as_deref(),
                Some(entry.error.as_str()),
                "exact failure changed at {}",
                case.index
            );
            assert_eq!(case.expected["commentOnly"], entry.source_comment_only);
            assert_ne!(actual, case.expected, "stale divergence at {}", case.index);
            ledger_count += 1;
        } else if actual != case.expected {
            records.push(json!({"index":case.index,"before":case.before,"after":case.after,"actual":actual,"expected":case.expected,"error":error}));
            if failures.len() < 10 {
                failures.push(format!("case {} error {error:?}", case.index));
            }
        }
    }
    std::fs::write(
        output.with_extension("failures.json"),
        serde_json::to_vec(&records)?,
    )
    .expect("failure artifact");
    assert!(ledger.is_empty(), "unused exact divergence entries");
    eprintln!(
        "gate accept/reject/throw: {counts:?}; exact fail-closed divergences: {ledger_count}"
    );
    assert_eq!(counts.iter().sum::<usize>(), 20000);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    Ok(())
}

#[test]
fn wrapping_text_is_comment_only_but_changes_to_highlight_state_are_content() -> Result<()> {
    let before: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"hello","format":0,"style":"","mode":"normal","detail":0}]}]}}),
    )?;
    let after: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"comment-mark","version":1,"ids":["comment"],"children":[{"type":"text","version":1,"text":"hello","format":0,"style":"","mode":"normal","detail":0}]}]}]}}),
    )?;
    assert!(is_comment_only_change(&before, &after)?);
    let highlight: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"code-highlight","version":1,"text":"stored","format":0,"style":"","mode":"normal","detail":0,"highlightType":"keyword","$":{"extra":1}}]}]}}),
    )?;
    let changed: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"code-highlight","version":1,"text":"stored","format":0,"style":"","mode":"normal","detail":0,"highlightType":"keyword","$":{"extra":2}}]}]}}),
    )?;
    assert!(!is_comment_only_change(&highlight, &changed)?);
    assert_eq!(
        content_without_comments(&highlight)?["root"]["children"][0]["children"][0]["type"],
        "code-highlight"
    );
    Ok(())
}

#[test]
fn unknown_imports_fail_closed_and_legacy_code_is_not_replaced() -> Result<()> {
    let before: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"code","version":1,"language":"rust","children":[{"type":"text","version":1,"text":"let x"}]}]}}),
    )?;
    let normalized = content_without_comments(&before)?;
    assert_eq!(normalized["root"]["children"][0]["type"], "code");
    let invalid: SerializedEditorState = serde_json::from_value(
        json!({"root":{"type":"root","version":1,"children":[{"type":"unknown-gate-node","version":1}]}}),
    )?;
    assert!(is_comment_only_change(&before, &invalid).is_err());
    assert!(is_comment_only_change(&invalid, &invalid).is_err());
    Ok(())
}

#[test]
fn loro_client_updates_match_service_after_server_projection() -> Result<()> {
    use base64::Engine;
    use sync_server_core::domain::state::DocumentState;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repository root");
    let output = root.join("target/lexical-conformance/gate-loro.jsonl");
    std::fs::create_dir_all(output.parent().expect("output directory")).expect("create output");
    let run = std::process::Command::new("bun")
        .current_dir(root)
        .arg("packages/lexical-conformance/diff/gate-fuzz/loro.ts")
        .arg(&output)
        .output()
        .expect("Loro source generator");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let rows = std::fs::read_to_string(output).expect("Loro oracle");
    let mut count = 0;
    for line in rows.lines() {
        let row: Value = serde_json::from_str(line)?;
        let snapshot = base64::engine::general_purpose::STANDARD
            .decode(row["snapshot"].as_str().expect("snapshot"))
            .expect("base64 snapshot");
        let update = base64::engine::general_purpose::STANDARD
            .decode(row["update"].as_str().expect("update"))
            .expect("base64 update");
        let state = DocumentState::try_from_snapshot(&snapshot).expect("server seed");
        let projected = state
            .root_change(&[&update])
            .expect("server projection")
            .expect("complete root pair");
        assert_eq!(projected.before, row["before"]["root"]);
        assert_eq!(projected.after, row["after"]["root"]);
        let before =
            content_without_comments(&serde_json::from_value(json!({"root":projected.before}))?)?;
        let after =
            content_without_comments(&serde_json::from_value(json!({"root":projected.after}))?)?;
        assert_eq!(
            json!({"commentOnly":before == after,"before":before,"after":after}),
            row["expected"],
            "Loro gate case {}",
            row["index"]
        );
        count += 1;
    }
    assert_eq!(count, 2048);
    Ok(())
}
