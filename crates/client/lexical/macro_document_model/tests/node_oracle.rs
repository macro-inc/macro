//! Synthetic per-node JSON round trips against packages/lexical-core's actual classes.
use lexical_model::*;
use macro_document_model::*;
use std::sync::Arc;
#[derive(serde::Deserialize)]
struct Case {
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    profile: String,
    input: SerializedEditorState,
    json: Option<String>,
    error: Option<String>,
}
#[test]
fn every_macro_node_matches_typescript_json_import_and_export() -> Result<()> {
    let mut failures = Vec::new();
    let mut counts = std::collections::BTreeMap::<String, (usize, usize)>::new();
    for line in include_str!("corpus/nodes.jsonl").lines() {
        let case: Case = serde_json::from_str(line)?;
        let builder = if case.profile == "headless" {
            headless_builder()
        } else {
            export_builder()
        };
        let mut editor = builder
            .extension_state(NodeClock(Arc::new(|| 1794052800000)))
            .extension_state(NodeRandom(Arc::new(|size| vec![0; size])))
            .build()
            .expect("static Macro registry");
        let result = editor.parse_editor_state(&case.input);
        let mismatch = match (result, case.json) {
            (Ok(state), Some(expected)) => {
                let actual = to_js_json_string(&serde_json::to_value(state.to_json()?)?);
                (actual != expected)
                    .then(|| format!("{}\nactual: {actual}\nexpect: {expected}", case.name))
            }
            (Err(_), None) if case.error.is_some() => None,
            (Err(error), Some(_)) => Some(format!("{}: unexpected error: {error}", case.name)),
            (Ok(_), None) => Some(format!(
                "{}: expected upstream error {:?}",
                case.name, case.error
            )),
            (Err(error), None) => Some(format!("{}: invalid fixture: {error}", case.name)),
        };
        let count = counts.entry(case.node_type).or_default();
        if let Some(failure) = mismatch {
            count.1 += 1;
            failures.push(failure)
        } else {
            count.0 += 1;
        }
    }
    for (name, (passed, failed)) in &counts {
        eprintln!("{name}: {passed} passed, {failed} failed");
    }
    for failure in &failures {
        eprintln!("{}", failure.lines().next().unwrap_or_default());
    }
    assert!(
        failures.is_empty(),
        "{} divergences:\n{}",
        failures.len(),
        failures
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    assert_eq!(counts.len(), 57);
    Ok(())
}
