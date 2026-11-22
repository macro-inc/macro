//! Native snippet conversion: source Markdown extraction, then target-registry parsing.
use crate::{EditorType, NodeClock, NodeHost, NodeRandom};
use lexical_model::*;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

// The source plugin keeps its extraction editor outside document updates/history.
// Retain that lifetime, including its known empty/malformed-input cache behavior.
#[derive(Clone, Default)]
pub(super) struct ExtractionState {
    issued: BTreeMap<NodeKey, String>,
    editor: Arc<Mutex<Option<Editor>>>,
}

pub(super) struct Extracted {
    pub markdown: String,
    pub import_error: Option<String>,
}

pub(super) fn track_request(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    identity: String,
) -> Result<(), Error> {
    tx.extension_mut::<ExtractionState>()?
        .issued
        .insert(key, identity);
    Ok(())
}
pub(super) fn has_request(
    tx: &Transaction<'_>,
    key: NodeKey,
    identity: &str,
) -> Result<bool, Error> {
    Ok(tx
        .extension::<ExtractionState>()?
        .issued
        .get(&key)
        .is_some_and(|issued| issued == identity))
}
pub(super) fn consume_request(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    identity: &str,
) -> Result<(), Error> {
    if has_request(tx, key, identity)? {
        tx.extension_mut::<ExtractionState>()?.issued.remove(&key);
    }
    Ok(())
}

pub(super) fn extract(
    tx: &Transaction<'_>,
    raw: &SerializedEditorState,
) -> Result<Extracted, Error> {
    let cache = tx.extension::<ExtractionState>()?.clone();
    let mut held = cache
        .editor
        .lock()
        .map_err(|_| Error::Invariant("snippet extractor lock"))?;
    if held.is_none() {
        let mut builder =
            crate::preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless);
        if let Some(clock) = tx.try_extension::<NodeClock>() {
            builder = builder.extension_state(clock.clone());
        }
        if let Some(random) = tx.try_extension::<NodeRandom>() {
            builder = builder.extension_state(random.clone());
        }
        if let Some(host) = tx.try_extension::<NodeHost>() {
            builder = builder.extension_state(host.clone());
        }
        *held = Some(
            builder
                .build()
                .map_err(|error| Error::invariant(format!("Snippet source registry: {error}")))?,
        );
    }
    let extractor = held.as_mut().ok_or(Error::Invariant("snippet extractor"))?;
    let (state, import_error) = if raw
        .root
        .get("children")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        (extractor.state().clone(), None)
    } else {
        let previous = extractor.state().clone();
        let mut raw = raw.clone();
        // initializeEditorWithState catches import errors and leaves the prior
        // extraction state intact. Preserve the recorded OFF behavior verbatim.
        match strip_drafts(&mut raw.root)
            .and_then(|()| extractor.parse_editor_state(&raw))
            .and_then(|parsed| {
                extractor.set_editor_state(parsed, TagSet::default())?;
                Ok(extractor.state().clone())
            }) {
            Ok(state) => (state, None),
            Err(error) => (previous, Some(error.to_string())),
        }
    };
    let options = crate::transformers::MacroMarkdownOptions {
        app_hostname: tx
            .try_extension::<NodeHost>()
            .and_then(|host| host.0.clone()),
    };
    let callbacks = crate::transformers::transformers("internal", &options)
        .map_err(|error| Error::invariant(format!("Snippet extractor: {error}")))?;
    // The source editorStateAsMarkdown applies this exact empty-line adjustment.
    let markdown = lexical_markdown::convert_to_markdown_string(
        &state,
        &callbacks,
        None,
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )
    .map_err(|error| Error::invariant(format!("Snippet Markdown: {error}")))?
    .replace("\n\n\n \n\n\n", "\n\n \n\n");
    drop(held);
    Ok(Extracted {
        markdown,
        import_error,
    })
}

pub(super) fn parse(
    tx: &Transaction<'_>,
    preset: EditorType,
    markdown: &str,
) -> Result<Vec<SerializedNode>, Error> {
    if markdown.trim_matches(is_js_whitespace).is_empty() {
        return Ok(vec![]);
    }
    let parsed = crate::markdown::parser::parse_for_preset(tx, preset, markdown)?;
    serde_json::from_value(
        parsed
            .root
            .get("children")
            .cloned()
            .ok_or(Error::Invariant("snippet parser children"))?,
    )
    .map_err(Error::from)
}

// Match stripDraftCommentMarks before source import, without changing live/save policy.
fn strip_drafts(node: &mut SerializedNode) -> Result<(), Error> {
    let Some(children) = node.get_mut("children").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    let previous = std::mem::take(children);
    for mut child in previous {
        if let Some(fields) = child.as_object_mut() {
            strip_drafts(fields)?;
            if fields.get("type").and_then(Value::as_str) == Some("comment-mark")
                && fields.get("isDraft") == Some(&Value::Bool(true))
            {
                let Some(Value::Array(content)) = fields.remove("children") else {
                    return Err(Error::Invariant("draft snippet comment children"));
                };
                children.extend(content);
                continue;
            }
        }
        children.push(child);
    }
    Ok(())
}
