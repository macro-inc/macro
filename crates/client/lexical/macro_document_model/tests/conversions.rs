//! Independent source imports and exports across both profiles and all three lists.
use lexical_model::*;
use macro_document_model::{transformers::*, *};
use std::sync::Arc;
#[derive(serde::Deserialize)]
struct Case {
    profile: String,
    list: String,
    input: String,
    initial: Option<SerializedEditorState>,
    json: Option<String>,
    markdown: Option<String>,
    error: Option<String>,
}
#[test]
fn source_markdown_conversions() {
    let mut failures = Vec::new();
    let mut count = 0;
    for line in include_str!("corpus/conversions.jsonl").lines() {
        let case: Case = serde_json::from_str(line).expect("source conversion fixture");
        let builder = if case.profile == "headless" {
            headless_builder()
        } else {
            export_builder()
        };
        let mut editor = builder
            .extension_state(NodeClock(Arc::new(|| 1794052800000)))
            .extension_state(NodeRandom(Arc::new(|size| vec![0; size])))
            .build()
            .expect("source registry");
        let options = MacroMarkdownOptions {
            app_hostname: Some("localhost".into()),
        };
        let transformers = transformers(&case.list, &options).expect("source list");
        let opts = lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        };
        let result = (|| -> lexical_markdown::Result<(String, String)> {
            if let Some(initial) = &case.initial {
                let state = editor.parse_editor_state(initial)?;
                editor.set_editor_state(state, TagSet::default())?;
            } else {
                editor.update(|tx| {
                    lexical_markdown::convert_from_markdown_string(
                        tx,
                        &case.input,
                        &transformers,
                        None,
                        &opts,
                    )
                    .map_err(|error| lexical_model::Error::invariant(error.to_string()))
                })?;
            }
            let json = to_js_json_string(
                &serde_json::to_value(editor.state().to_json()?)
                    .map_err(lexical_model::Error::from)?,
            );
            let markdown = lexical_markdown::convert_to_markdown_string(
                editor.state(),
                &transformers,
                None,
                &opts,
            )?;
            Ok((json, markdown))
        })();
        match result {
            Ok((json,markdown)) if case.json.as_deref()==Some(&json) && case.markdown.as_deref()==Some(&markdown)=>{},
            Err(_) if case.error.is_some()=>{},
            result=>failures.push(format!("{}/{} {:?}\nactual: {result:?}\nexpected JSON: {:?}\nexpected markdown: {:?}\nexpected error: {:?}",case.profile,case.list,case.input,case.json,case.markdown,case.error)),
        }
        count += 1;
    }
    eprintln!(
        "{} source conversions passed, {} failed",
        count - failures.len(),
        failures.len()
    );
    for failure in &failures {
        eprintln!("{}", failure.lines().next().unwrap_or(""));
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
    assert!(count > 500);
}

#[test]
fn external_document_card_requires_an_explicit_hostname() -> macro_document_model::Result<()> {
    use macro_document_model::nodes::{DocumentCardNode, Maybe};
    let mut editor = export_builder().build().unwrap();
    editor.update(|tx| {
        let node = tx.create(DocumentCardNode {
            document_id: Maybe::Value("doc".into()),
            document_name: Maybe::Value("Example".into()),
            block_name: Maybe::Value("md".into()),
            ..Default::default()
        })?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(())
    })?;
    let registry = lexical_markdown::Transformers::new([transformer(
        "E_DOCUMENT_CARD",
        &MacroMarkdownOptions::default(),
    )?]);
    assert!(matches!(
        macro_document_model::markdown::convert_to_markdown_string(
            editor.state(),
            &registry,
            None,
            &Default::default()
        ),
        Err(macro_document_model::Error::MissingHostname)
    ));
    let registry = lexical_markdown::Transformers::new([transformer(
        "E_DOCUMENT_CARD",
        &MacroMarkdownOptions {
            app_hostname: Some("localhost".into()),
        },
    )?]);
    assert_eq!(
        macro_document_model::markdown::convert_to_markdown_string(
            editor.state(),
            &registry,
            None,
            &Default::default()
        )?,
        "[Example](https://dev.macro.com/app/md/doc)"
    );
    Ok(())
}
