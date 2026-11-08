use super::*;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Divergence {
    index: usize,
    oracle_sha256: String,
    source_comment_only: bool,
}
#[derive(Deserialize)]
struct Case {
    index: usize,
    before: Value,
    after: Value,
    expected: Value,
}
#[test]
fn shared_port_matches_the_source_gate_oracle_with_exact_fail_closed_exceptions() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let path = root.join("target/lexical-conformance/gate-port-oracle.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let run = std::process::Command::new("bun")
        .current_dir(root)
        .arg("packages/lexical-conformance/diff/gate-fuzz/generate.ts")
        .arg(&path)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let mut ledger: BTreeMap<_, _> = serde_json::from_str::<Vec<Divergence>>(include_str!(
        "../../../client/lexical/macro_document_model/tests/corpus/gate-divergences.json"
    ))
    .unwrap()
    .into_iter()
    .map(|entry| (entry.index, entry))
    .collect();
    let rows = std::fs::read_to_string(path).unwrap();
    let gate = InProcessCommentGate::new(macro_document_model::DocumentContext {
        clock: macro_document_model::NodeClock(std::sync::Arc::new(|| 1794052800000)),
        random: macro_document_model::NodeRandom(std::sync::Arc::new(|size| vec![0; size])),
        host: Default::default(),
        keys: Default::default(),
        editor_created: None,
    });
    let mut compared = 0;
    let mut failures = Vec::new();
    for line in rows.lines() {
        let case: Case = serde_json::from_str(line).unwrap();
        let change = RootChange {
            before: case.before["root"].clone(),
            after: case.after["root"].clone(),
        };
        let observed = futures::executor::block_on(gate.is_comment_only_change(&change));
        if let Some(entry) = ledger.remove(&case.index) {
            assert_eq!(
                format!("{:x}", Sha256::digest(line.as_bytes())),
                entry.oracle_sha256
            );
            assert!(observed.is_err(), "fail closed for {}", case.index);
            assert_eq!(case.expected["commentOnly"], entry.source_comment_only);
        } else {
            let matched = if case.expected["throws"] == true {
                observed.is_err()
            } else {
                observed.as_ref().ok().copied() == case.expected["commentOnly"].as_bool()
            };
            if !matched && failures.len() < 10 {
                failures.push((case.index, observed));
            }
        }
        compared += 1;
    }
    assert_eq!(compared, 20_000);
    assert!(ledger.is_empty(), "stale exceptions");
    assert!(failures.is_empty(), "{failures:?}");
}
