//! Exact source references and reply extraction, including malformed nested views.
use macro_document_model::*;
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn authored_references_match_source() -> Result<()> {
    let context = DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    };
    for line in include_str!("corpus/mentions.jsonl").lines() {
        let row: Value = serde_json::from_str(line)?;
        let markdown = row["markdown"].as_str().expect("markdown");
        let actual = if row["kind"] == "mentions" {
            mentions::extract_channel_mentions_from_markdown(markdown, &context)
                .and_then(|value| Ok(serde_json::to_value(value)?))
        } else {
            mentions::extract_explicit_reply(markdown, &context)
                .and_then(|value| Ok(serde_json::to_value(value)?))
        };
        let observed = actual
            .as_ref()
            .map_or_else(|_| json!({"throws":true}), |value| json!({"value":value}));
        assert_eq!(
            observed,
            row["expected"],
            "{} {} {:?}",
            row["kind"],
            markdown,
            actual.err()
        );
    }
    Ok(())
}
