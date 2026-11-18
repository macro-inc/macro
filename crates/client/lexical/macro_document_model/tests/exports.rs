//! Literal service exports, registry isolation and observational reads.
use lexical_model::*;
use macro_document_model::{export::*, *};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn custom_code_import_learns_state_keys_for_later_nodes_of_the_same_class() -> Result<()> {
    let raw = serde_json::from_str(
        r#"{"root":{"type":"root","children":[{"type":"custom-code","version":1,"language":"rust","$":{"id":"first","extra":"kept"},"children":[{"type":"text","text":"code"}]},{"type":"custom-code","version":1,"language":"rust","$":{"id":"second","extra":"kept"},"children":[{"type":"text","text":"code"}]}]}}"#,
    )?;
    let state = parse_export_state(
        &raw,
        &DocumentContext {
            clock: NodeClock(Arc::new(|| 1794052800000)),
            random: NodeRandom(Arc::new(|size| vec![0; size])),
            host: NodeHost::default(),
            keys: KeySource::default(),
            editor_created: None,
        },
    )?;
    let before = state.to_json()?;
    let search = to_search_text(&state)?;
    assert_eq!(
        search[0].raw_content,
        r#"{"children":[],"format":"","type":"custom-code","version":1,"$":{"id":"first","extra":"kept"},"language":"rust","previewEnabled":false}"#
    );
    assert_eq!(
        search[1].raw_content,
        r#"{"children":[],"format":"","type":"custom-code","version":1,"$":{"extra":"kept","id":"second"},"language":"rust","previewEnabled":false}"#
    );
    assert_eq!(
        to_cognition_text(&state)?[1].raw_content,
        search[1].raw_content
    );
    assert_eq!(state.to_json()?, before);
    Ok(())
}

#[test]
fn service_exports_and_xml_match_source_and_leave_stored_state_unchanged() -> Result<()> {
    let mut failures = Vec::new();
    for line in include_str!("corpus/exports.jsonl").lines() {
        let row: Value = serde_json::from_str(line)?;
        let state: SerializedEditorState = serde_json::from_value(row["input"].clone())?;
        let imported = parse_export_state(
            &state,
            &DocumentContext {
                clock: NodeClock(Arc::new(|| 1794052800000)),
                random: NodeRandom(Arc::new(|size| vec![0; size])),
                host: NodeHost::default(),
                keys: KeySource::default(),
                editor_created: None,
            },
        );
        let before = imported
            .as_ref()
            .ok()
            .map(|state| state.to_json().map_err(|error| error.to_string()));
        for (name, expected) in row["results"].as_object().expect("source results") {
            let result = (|| -> Result<Value> {
                if name == "xml" {
                    return Ok(json!(xml::to_xml(&state)?));
                }
                let state = imported.as_ref().map_err(|error| {
                    macro_document_model::Error::InvalidArgument(error.to_string().into())
                })?;
                Ok(match name.as_str() {
                    "plaintext" => json!(to_plaintext(state)),
                    "search" => serde_json::to_value(to_search_text(state)?)?,
                    "cognition" => serde_json::to_value(to_cognition_text(state)?)?,
                    "cognitionV2" => serde_json::to_value(to_cognition_v2(state)?)?,
                    "internal" => json!(to_markdown_text(state, MarkdownTarget::Internal, None)?),
                    "external" => json!(to_markdown_text(state, MarkdownTarget::External, None)?),
                    "externalHost" => {
                        let hosted = parse_export_state(
                            &serde_json::from_value(row["input"].clone())?,
                            &DocumentContext {
                                clock: NodeClock(Arc::new(|| 1794052800000)),
                                random: NodeRandom(Arc::new(|size| vec![0; size])),
                                host: NodeHost(Some(Arc::from("app.example.com"))),
                                keys: KeySource::default(),
                                editor_created: None,
                            },
                        )?;
                        json!(to_markdown_text(
                            &hosted,
                            MarkdownTarget::External,
                            Some("app.example.com")
                        )?)
                    }
                    "embedding" => json!(to_markdown_text(state, MarkdownTarget::Embedding, None)?),
                    _ => panic!("unknown oracle export"),
                })
            })();
            let actual = result
                .as_ref()
                .map_or_else(|_| json!({"throws":true}), |value| json!({"value":value}));
            if &actual != expected {
                failures.push(format!(
                    "{} {name}: {result:?}\nexpected {expected}",
                    row["name"]
                ));
            }
        }
        if let Ok(state) = imported {
            assert_eq!(
                Some(state.to_json().map_err(|error| error.to_string())),
                before,
                "exports must preserve stored state and unknown-state order"
            );
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures\n{}",
        failures.len(),
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}

#[test]
fn cognition_body_fallback_keeps_invalid_body_and_service_partial_import_policy() -> Result<()> {
    let context = DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    };
    let fallback = cognition_from_presigned_body("plain body", &context);
    assert_eq!(fallback.len(), 1);
    assert_eq!(fallback[0].node_id, "plain-text");
    assert_eq!(fallback[0].content, "plain body");
    assert_eq!(fallback[0].raw_content, "plain body");
    let row: Value = include_str!("corpus/exports.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("oracle JSON"))
        .find(|row| row["name"] == "partial-import:export")
        .expect("source partial import");
    let body = serde_json::to_string(&row["input"])?;
    assert_eq!(
        serde_json::to_value(cognition_from_presigned_body(&body, &context))?,
        row["results"]["cognition"]["value"]
    );
    Ok(())
}
