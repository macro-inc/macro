//! Source `auto-link.test.ts` (#10348): a URL saved before the editor linked it carries
//! Lexical's formatting escapes; export writes plain-text URLs as typed and import
//! links a URL whose only escapes are formatting escapes.
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

fn links(node: &Value, out: &mut Vec<(String, String)>) {
    if node["type"] == "link" {
        let text = node["children"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|child| child["text"].as_str())
            .collect::<String>();
        out.push((text, node["url"].as_str().unwrap_or_default().into()));
    }
    for child in node["children"].as_array().into_iter().flatten() {
        links(child, out);
    }
}

fn imported_links(markdown: &str) -> Result<Vec<(String, String)>> {
    let state = markdown::markdown_to_serialized_editor_state_with_ids(markdown, &context())?;
    let mut out = Vec::new();
    links(&serde_json::to_value(&state)?["root"], &mut out);
    Ok(out)
}

fn text(content: &str, format: u32) -> Value {
    json!({"detail":0,"format":format,"mode":"normal","style":"","text":content,"type":"text","version":1})
}

#[test]
fn links_a_url_whose_only_escapes_are_formatting_escapes() -> Result<()> {
    let url = "https://example.com/post?a=x_y*z~w&s=20";
    assert_eq!(
        imported_links(r"Read https://example.com/post?a=x\_y\*z\~w&s=20 later")?,
        vec![(url.to_string(), url.to_string())]
    );
    Ok(())
}

#[test]
fn saves_plain_text_urls_as_typed_and_keeps_escapes_in_formatted_text() -> Result<()> {
    let url = "https://example.com/post?a=x_y&s=20";
    let italic_url = "https://example.com/a*b";
    let state: lexical_model::SerializedEditorState = serde_json::from_value(json!({
        "root": {"type":"root","version":1,"direction":null,"format":"","indent":0,"children":[
            {"type":"paragraph","version":1,"direction":null,"format":"","indent":0,
             "textFormat":0,"textStyle":"","children":[
                text(&format!("snake_case {url} and "), 0),
                text(italic_url, 2),
            ]}
        ]}
    }))?;
    let markdown = markdown::serialized_editor_state_to_markdown(&state, &context())?;
    assert_eq!(
        markdown,
        format!(r"snake\_case {url} and *https://example.com/a\*b*")
    );
    assert_eq!(
        imported_links(&markdown)?,
        vec![
            (url.to_string(), url.to_string()),
            (italic_url.to_string(), italic_url.to_string()),
        ]
    );
    Ok(())
}
