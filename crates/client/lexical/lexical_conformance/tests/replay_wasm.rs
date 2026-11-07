//! Execute every recorded fixture inside the wasm32 interpreter, including ledger cases.
#![cfg(target_arch = "wasm32")]
use lexical_conformance::{fixture::Fixture, ledger::Ledger, replay::Replayer};
use std::collections::BTreeMap;
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn replay_complete_corpus() {
    let cases: &[(&str, &str)] = include!(env!("LEXICAL_WASM_FIXTURES"));
    let fixtures: Vec<_> = cases
        .iter()
        .map(|(_, bytes)| serde_json::from_str::<Fixture>(bytes).expect("schema 2"))
        .collect();
    let ledger: Ledger =
        serde_json::from_str(include_str!("../ledger.json")).expect("ledger schema");
    ledger.validate(&fixtures).expect("valid ledger");
    let mut counts = BTreeMap::<String, [usize; 3]>::new();
    let mut failures = Vec::new();
    for ((file, _), fixture) in cases.iter().zip(fixtures) {
        let package = file.split('/').nth(1).expect("package");
        let mut replayer = Replayer::default();
        replayer.strict_keys = ledger.strict_packages.iter().any(|name| name == package);
        let result = replayer.replay(&fixture);
        let status = match (&result, ledger.entry(&fixture)) {
            (Ok(()), None) => 0,
            (Err(error), Some(entry)) if entry.matches_failure(error) => 2,
            _ => 1,
        };
        counts.entry(package.into()).or_default()[status] += 1;
        if status == 1 {
            failures.push(format!("{file}: {result:?}"));
        }
    }
    wasm_bindgen_test::console_log!("wasm pass/fail/ledger: {:?}", counts);
    assert!(
        failures.is_empty(),
        "{} replay failures: {}",
        failures.len(),
        failures.join("\n")
    );
}
