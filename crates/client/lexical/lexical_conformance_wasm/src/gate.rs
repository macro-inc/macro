//! Actual WASM boundary for the Macro comment gate differential.
use lexical_model::*;
use macro_document_model::{DocumentContext, NodeClock, NodeHost, NodeRandom, comment_gate::*};
use serde_json::{Value, json};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
/// Normalize and compare one source gate pair, preserving exact failures as data.
#[wasm_bindgen]
pub fn gate_compare(before: &str, after: &str) -> String {
    let observed = (|| -> macro_document_model::Result<Value> {
        let context = DocumentContext {
            clock: NodeClock(Arc::new(|| 1794052800000)),
            random: NodeRandom(Arc::new(|size| vec![0; size])),
            host: NodeHost::default(),
            keys: KeySource::default(),
            editor_created: None,
        };
        let before =
            content_without_comments_with_context(&serde_json::from_str(before)?, &context)?;
        let after = content_without_comments_with_context(&serde_json::from_str(after)?, &context)?;
        Ok(json!({"commentOnly":before == after,"before":before,"after":after}))
    })();
    let result = match observed {
        Ok(actual) => json!({"actual":actual,"error":null}),
        Err(error) => json!({"actual":{"throws":true},"error":error.to_string()}),
    };
    to_js_json_string(&result)
}
