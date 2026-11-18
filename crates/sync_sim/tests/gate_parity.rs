use futures::FutureExt;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use sync_server_core::domain::{ports::CommentGate, state::RootChange};
use sync_server_sim::ports::SimNow;
use sync_server_sim::ports::SimPorts;

#[derive(Deserialize)]
struct Case {
    index: usize,
    before: Value,
    after: Value,
    expected: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Divergence {
    index: usize,
    oracle_sha256: String,
    error: String,
    source_comment_only: bool,
    source_errors: Vec<String>,
}
#[derive(Deserialize)]
struct SourceErrors {
    index: usize,
    errors: Vec<String>,
}

#[test]
fn application_gate_matches_the_service_and_adversarial_corpus() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root");
    let output = root.join("target/sync-sim/gate-oracle.jsonl");
    std::fs::create_dir_all(output.parent().expect("oracle directory")).unwrap();
    let generated = std::process::Command::new("bun")
        .current_dir(root)
        .arg("packages/lexical-conformance/diff/gate-fuzz/generate.ts")
        .arg(&output)
        .output()
        .expect("real lexical-service gate oracle");
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let rows = std::fs::read_to_string(&output).unwrap();
    let now = SimNow {
        unix_ms: 1794052800000,
        monotonic: std::time::Duration::ZERO,
    };
    let mut ledger: BTreeMap<_, _> = serde_json::from_str::<Vec<Divergence>>(include_str!(
        "../../client/lexical/macro_document_model/tests/corpus/gate-divergences.json"
    ))
    .unwrap()
    .into_iter()
    .map(|entry| (entry.index, entry))
    .collect();
    let mut source_errors: BTreeMap<_, _> = serde_json::from_str::<Vec<SourceErrors>>(
        &std::fs::read_to_string(format!("{}.errors.json", output.display())).unwrap(),
    )
    .unwrap()
    .into_iter()
    .map(|row| (row.index, row.errors))
    .collect();
    assert_eq!(source_errors.len(), 20_000);
    let mut ledger_count = 0;
    let mut failures = vec![];
    let mut count = 0;
    for line in rows.lines() {
        let case: Case = serde_json::from_str(line).unwrap();
        let change = RootChange {
            before: case.before["root"].clone(),
            after: case.after["root"].clone(),
        };
        let ports = SimPorts::new();
        ports.set_now(now);
        ports.set_comment_gate(sync_sim::comment_gate::evaluate);
        let result = ports
            .is_comment_only_change(&change)
            .now_or_never()
            .expect("native gate completes on its first poll");
        let source_errors = source_errors
            .remove(&case.index)
            .expect("exact source error observation");
        let actual = result.as_ref().ok().copied();
        let expected = case.expected["commentOnly"].as_bool();
        let partial = !source_errors.is_empty() && expected.is_some();
        assert_eq!(
            ledger.contains_key(&case.index),
            partial,
            "exact source partial-import ledger at {}",
            case.index
        );
        if let Some(entry) = ledger.remove(&case.index) {
            // M2 gate-parity ruling: native stays fail-closed when the service
            // logs a parse error and continues with a partial document.
            assert_eq!(
                format!("{:x}", Sha256::digest(line.as_bytes())),
                entry.oracle_sha256
            );
            assert!(!source_errors.is_empty());
            assert_eq!(source_errors, entry.source_errors);
            assert_eq!(actual, None);
            assert_eq!(
                result.as_ref().err().map(ToString::to_string).as_deref(),
                Some(entry.error.as_str())
            );
            assert_eq!(expected, Some(entry.source_comment_only));
            ledger_count += 1;
        } else if actual != expected {
            failures.push((
                case.index,
                expected,
                actual,
                result.err().map(|e| e.to_string()),
            ));
        }
        count += 1;
    }
    assert_eq!(count, 20000, "complete service plus adversarial corpus");
    assert!(ledger.is_empty(), "unused exact divergence entries");
    assert!(source_errors.is_empty(), "unused source error observations");
    eprintln!("application gate: {count} cases, {ledger_count} exact fail-closed divergences");
    assert!(
        failures.is_empty(),
        "{} verdict mismatches; first cases: {:?}",
        failures.len(),
        &failures[..failures.len().min(12)]
    );
}
