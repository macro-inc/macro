//! I/O-free dev corpus adapters. Errors deliberately contain no document content.
use lexical_model::{KeySource, SerializedEditorState};
use macro_document_model::{DocumentContext, NodeClock, NodeHost, NodeRandom, export::*};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};
use wasm_bindgen::prelude::*;

#[derive(Debug, thiserror::Error)]
enum CorpusError {
    #[error("invalid corpus input")]
    Input,
    #[error("conversion failed")]
    Conversion(#[from] macro_document_model::Error),
    #[error("invalid corpus JSON")]
    Json(#[from] serde_json::Error),
}

fn field<T: DeserializeOwned>(input: &Value, name: &str) -> Result<T, CorpusError> {
    Ok(serde_json::from_value(
        input.get(name).ok_or(CorpusError::Input)?.clone(),
    )?)
}

fn context() -> DocumentContext {
    let counter = AtomicU8::new(0);
    DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(move |size| {
            (0..size)
                .map(|_| counter.fetch_add(1, Ordering::Relaxed) & 63)
                .collect()
        })),
        host: NodeHost::default(),
        keys: KeySource::default(),
        editor_created: None,
    }
}

fn convert(route: &str, input: &Value) -> Result<Value, CorpusError> {
    let context = context();
    match route {
        "snapshot/state" => Ok(
            json!({"snapshot": lexical_loro::snapshot::raw_state_to_loro_snapshot(input.get("state").ok_or(CorpusError::Input)?, Some(lexical_loro::golden::MARKDOWN_GOLDEN)).map_err(macro_document_model::Error::from)?}),
        ),
        "snapshot/markdown" => {
            let markdown: String = field(input, "markdown")?;
            Ok(
                json!({"snapshot": macro_document_model::snapshot::markdown_to_loro_snapshot(&markdown, &context)?}),
            )
        }
        "snapshot/notion" => {
            let markdown: String = field(input, "markdown")?;
            let links = field(input, "links")?;
            let result = macro_document_model::snapshot::notion_markdown_to_loro_snapshot(
                &markdown, &links, &context,
            )?;
            Ok(json!({"snapshot":result.snapshot,"markdown":result.markdown}))
        }
        "mentions" => Ok(serde_json::to_value(
            macro_document_model::mentions::extract_channel_mentions_from_markdown(
                &field::<String>(input, "markdown")?,
                &context,
            )?,
        )?),
        "extract-reply" => Ok(serde_json::to_value(
            macro_document_model::mentions::extract_explicit_reply(
                &field::<String>(input, "markdown")?,
                &context,
            )?,
        )?),
        "agent-context" => Ok(json!(
            macro_document_model::agent_context::compose_agent_context_prompt(input, &context)?
        )),
        "agent-announcement" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_session_announcement(
                &serde_json::from_value(input.clone())?,
                &context
            )?
        )),
        "agent-chat-reply" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_chat_reply(
                &serde_json::from_value(input.clone())?,
                &context
            )?
        )),
        "agent-connection-prompt" => Ok(json!(
            macro_document_model::agent_reply::compose_agent_connection_prompt(
                &serde_json::from_value(input.clone())?,
                &context
            )?
        )),
        "image-markdown" => Ok(json!(
            macro_document_model::markdown::compose_image_markdown(
                &serde_json::from_value(input.clone())?,
                &context
            )?
        )),
        "xml" => Ok(json!(macro_document_model::xml::to_xml(&field(
            input, "state"
        )?)?)),
        "comment-only-change" => {
            let before = macro_document_model::comment_gate::content_without_comments_with_context(
                &field(input, "before")?,
                &context,
            )?;
            let after = macro_document_model::comment_gate::content_without_comments_with_context(
                &field(input, "after")?,
                &context,
            )?;
            Ok(json!({"commentOnly": before == after, "before":before, "after":after}))
        }
        _ => {
            let raw: SerializedEditorState = field(input, "state")?;
            let state = parse_export_state(&raw, &context)?;
            match route {
                "plaintext" => Ok(json!(to_plaintext(&state))),
                "search" => Ok(serde_json::to_value(to_search_text(&state)?)?),
                "cognition" => Ok(serde_json::to_value(to_cognition_text(&state)?)?),
                "cognitionv2" => Ok(serde_json::to_value(to_cognition_v2(&state)?)?),
                "markdown/internal" => Ok(json!(to_markdown_text(
                    &state,
                    MarkdownTarget::Internal,
                    None
                )?)),
                "markdown/external" => Ok(json!(to_markdown_text(
                    &state,
                    MarkdownTarget::External,
                    None
                )?)),
                "markdown/embedding" => Ok(json!(to_markdown_text(
                    &state,
                    MarkdownTarget::Embedding,
                    None
                )?)),
                "comment-mark" => Ok(serde_json::to_value(to_comment_mark_context(
                    &state,
                    &field::<String>(input, "markId")?,
                )?)?),
                "json-roundtrip" => Ok(serde_json::to_value(
                    state.to_json().map_err(macro_document_model::Error::from)?,
                )?),
                _ => Err(CorpusError::Input),
            }
        }
    }
}

/// Compare through actual Rust functions; caller owns storage and content-free reporting.
#[wasm_bindgen]
pub fn corpus_route(route: &str, input: &str) -> String {
    let result = serde_json::from_str(input)
        .map_err(CorpusError::from)
        .and_then(|input| convert(route, &input));
    let result = match result {
        Ok(value) => json!({"ok":value}),
        Err(_) => json!({"error":"conversion"}),
    };
    lexical_model::to_js_json_string(&result)
}

#[cfg(test)]
mod test;
