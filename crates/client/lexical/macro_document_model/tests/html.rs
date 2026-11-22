#![cfg(feature = "html")]
//! Exact source HTML, including malformed template fragments and every node class.
use lexical_html::{EditorTheme, HtmlExporter, inner_html};
use macro_document_model::*;
use serde_json::{Value, json};
use std::sync::Arc;
fn context() -> DocumentContext {
    DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    }
}
#[test]
fn source_html_bytes_match() -> Result<()> {
    let mut failures = vec![];
    let ledger: Vec<Value> = serde_json::from_str(include_str!("corpus/html-divergences.json"))?;
    let mut used = std::collections::HashSet::new();
    let context = context();
    for line in include_str!("corpus/html.jsonl").lines() {
        let row: Value = serde_json::from_str(line)?;
        let result = (|| -> Result<Value> {
            Ok(match row["kind"].as_str().expect("kind") {
                "fragment" => json!(inner_html(&html::fragment::parse_fragment(
                    row["input"].as_str().expect("fragment")
                )?)),
                "markdown" => serde_json::to_value(html::markdown_to_html(
                    row["input"].as_str().expect("markdown"),
                    &Default::default(),
                    &context,
                )?)?,
                "node" => {
                    let mut editor = if row["profile"] == "headless" {
                        context.builder()
                    } else {
                        macro_document_model::export_builder()
                            .extension_state(context.clock.clone())
                            .extension_state(context.random.clone())
                            .extension_state(context.host.clone())
                    }
                    .build()?;
                    let state = editor
                        .parse_editor_state(&serde_json::from_value(row["input"].clone())?)?;
                    json!({"html":HtmlExporter::new(html::macro_export_registry(),EditorTheme::default()).generate_html_from_nodes(&state,None)?,"text":state.view().text_content(lexical_model::NodeKey::ROOT)})
                }
                _ => panic!("unknown case"),
            })
        })();
        let actual = result
            .as_ref()
            .map_or_else(|_| json!({"throws":true}), |value| json!({"value":value}));
        if let Some(entry) = ledger.iter().find(|entry| entry["name"] == row["name"]) {
            use sha2::Digest;
            assert_eq!(
                format!("{:x}", sha2::Sha256::digest(line.as_bytes())),
                entry["source_sha256"].as_str().expect("source digest")
            );
            assert_eq!(
                row["expected"],
                json!({"throws":true}),
                "source Q7 btoa failure"
            );
            assert_eq!(actual, entry["rust"], "exact UTF-8 export bytes");
            assert!(used.insert(row["name"].as_str().expect("name").to_string()));
        } else if actual != row["expected"] {
            failures.push(json!({"name":row["name"],"kind":row["kind"],"input":row["input"],"actual":actual,"error":result.err().map(|e|e.to_string()),"expected":row["expected"]}));
        }
    }
    assert_eq!(used.len(), ledger.len(), "stale HTML divergence entry");
    std::fs::create_dir_all("target").expect("artifact directory");
    std::fs::write(
        "target/html-mismatches.json",
        serde_json::to_vec_pretty(&failures)?,
    )
    .expect("mismatch artifact");
    assert!(
        failures.is_empty(),
        "{} HTML divergences; target/html-mismatches.json; first: {}",
        failures.len(),
        serde_json::to_string(&failures.iter().take(2).collect::<Vec<_>>())?
    );
    Ok(())
}
