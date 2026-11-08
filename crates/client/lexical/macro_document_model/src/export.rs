//! Portable lexical-service export routes over its replacement-free registry.
use crate::{Result, nodes::*, policy::SearchText};
use lexical_model::*;
use serde::{Deserialize, Serialize};

/// Search index block with exact shallow exportJSON bytes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchableNode {
    /// Durable block identity.
    pub node_id: String,
    /// Search projection.
    pub content: String,
    /// Source JSON.stringify of shallow exportJSON.
    pub raw_content: String,
}
/// Cognition block with internal Markdown and shallow JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CognitionNode {
    /// Durable block identity.
    pub node_id: String,
    /// Stored node type.
    pub r#type: String,
    /// Internal Markdown.
    pub content: String,
    /// Shallow source JSON.stringify bytes.
    pub raw_content: String,
}
/// Ordered Markdown blocks and embedded images for cognition v2.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NewMdNode {
    /// One top-level element.
    Generic {
        /// Durable block identity.
        #[serde(rename = "nodeId")]
        node_id: String,
        /// Internal Markdown.
        content: String,
        /// Stored node type.
        tag: String,
    },
    /// URL-backed image.
    StaticImage {
        /// Image URL.
        #[serde(default, skip_serializing_if = "Maybe::is_missing")]
        url: Maybe<String>,
    },
    /// Document-storage image.
    DssImage {
        /// Stored image id.
        #[serde(default, skip_serializing_if = "Maybe::is_missing")]
        id: Maybe<String>,
    },
}
/// Markdown transformer selection for service exports.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MarkdownTarget {
    /// Reversible Macro syntax.
    #[default]
    Internal,
    /// Reader-facing Markdown.
    External,
    /// Internal Markdown reduced to embedding text.
    Embedding,
}
/// Root child text content separated by a single newline.
pub fn to_plaintext(state: &EditorState) -> String {
    state
        .view()
        .children(NodeKey::ROOT)
        .map(|key| state.view().text_content(key).into_owned())
        .collect::<Vec<_>>()
        .join("\n")
}
/// Node-specific search handlers take precedence over recursive element text.
pub fn extract_search_text(state: &EditorState, key: NodeKey) -> String {
    let view = state.view();
    if let Some(node) = view.get_dyn::<dyn SearchText>(key)
        && let Some(text) = node.search_text()
    {
        return text.into_owned();
    }
    if !view.is_element(key) {
        return view.text_content(key).into_owned();
    }
    let children: Vec<_> = view.children(key).collect();
    let mut out = String::new();
    for (index, child) in children.iter().enumerate() {
        out.push_str(&extract_search_text(state, *child));
        if index + 1 != children.len() && view.is_element(*child) && !view.is_inline(*child) {
            out.push_str("\n\n");
        }
    }
    out
}
/// Search blocks in root-child order, skipping absent or empty durable ids.
pub fn to_search_text(state: &EditorState) -> Result<Vec<SearchableNode>> {
    let mut out = Vec::new();
    for key in state.view().children(NodeKey::ROOT) {
        if let Some(id) = crate::node_ids::get_id(state.view(), key)? {
            out.push(SearchableNode {
                node_id: id.into(),
                content: extract_search_text(state, key),
                raw_content: to_js_json_string(&serde_json::Value::Object(
                    state.view().export_json(key)?,
                )),
            });
        }
    }
    Ok(out)
}
fn options(host: Option<&str>) -> crate::transformers::MacroMarkdownOptions {
    crate::transformers::MacroMarkdownOptions {
        app_hostname: host.map(Into::into),
    }
}
/// Export one element as the only block of a detached root, without mutating state.
pub fn element_node_to_markdown(
    state: &EditorState,
    key: NodeKey,
    target: MarkdownTarget,
    host: Option<&str>,
) -> Result<String> {
    // The source deep copy reads every own exportJSON before Markdown conversion.
    for record in lexical_rich_nodes::utils::dfs(state.view(), Some(key), None) {
        state.view().export_json(record.node)?;
    }
    let list = if target == MarkdownTarget::External {
        "external"
    } else {
        "internal"
    };
    let transformers = crate::transformers::transformers(list, &options(host))?;
    let markdown = lexical_markdown::convert_nodes_to_markdown_string(
        state,
        &transformers,
        &[key],
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )?;
    Ok(if target == MarkdownTarget::External {
        markdown
    } else {
        markdown.replace("\n\n\n \n\n\n", "\n\n \n\n")
    })
}
/// Cognition v1 includes only identified top-level elements.
pub fn to_cognition_text(state: &EditorState) -> Result<Vec<CognitionNode>> {
    let mut out = Vec::new();
    for key in state.view().children(NodeKey::ROOT) {
        if state.view().is_element(key)
            && let Some(id) = crate::node_ids::get_id(state.view(), key)?
        {
            // The service's update error handler logs and stops this callback, retaining prior results.
            let Ok(content) = element_node_to_markdown(state, key, MarkdownTarget::Internal, None)
            else {
                break;
            };
            out.push(CognitionNode {
                node_id: id.into(),
                r#type: state.view().type_name(key)?.into(),
                content,
                raw_content: to_js_json_string(&serde_json::Value::Object(
                    state.view().export_json(key)?,
                )),
            });
        }
    }
    Ok(out)
}
fn image(node: &ImageNode) -> NewMdNode {
    if matches!(&node.media.src_type, Maybe::Value(value) if value == "dss") {
        NewMdNode::DssImage {
            id: node.media.id.clone(),
        }
    } else {
        NewMdNode::StaticImage {
            url: node.media.url.clone(),
        }
    }
}
/// Cognition v2 preserves root ordering and enumerates nested images after their block.
pub fn to_cognition_v2(state: &EditorState) -> Result<Vec<NewMdNode>> {
    let mut out = Vec::new();
    let view = state.view();
    for key in view.children(NodeKey::ROOT) {
        if let Some(node) = view.get::<ImageNode>(key) {
            out.push(image(node));
            continue;
        }
        if !view.is_element(key) {
            continue;
        }
        let Some(id) = crate::node_ids::get_id(view, key)? else {
            continue;
        };
        let Ok(content) = element_node_to_markdown(state, key, MarkdownTarget::Internal, None)
        else {
            break;
        };
        out.push(NewMdNode::Generic {
            node_id: id.into(),
            content,
            tag: view.type_name(key)?.into(),
        });
        for record in lexical_rich_nodes::utils::dfs(view, Some(key), None) {
            if let Some(node) = view.get::<ImageNode>(record.node) {
                out.push(image(node));
            }
        }
    }
    Ok(out)
}
/// Whole-document Markdown through the service's transformer target.
/// External document links require the host hostname explicitly.
pub fn to_markdown_text(
    state: &EditorState,
    target: MarkdownTarget,
    host: Option<&str>,
) -> Result<String> {
    let list = if target == MarkdownTarget::External {
        "external"
    } else {
        "internal"
    };
    let transformers = crate::transformers::transformers(list, &options(host))?;
    let markdown = crate::markdown::convert_to_markdown_string(
        state,
        &transformers,
        None,
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )?;
    Ok(if target == MarkdownTarget::Embedding {
        crate::parsers::markdown_to_embedding_text(&markdown)
    } else {
        markdown
    })
}
/// Resolve a comment's live text and UTF-16-limited surrounding blocks.
pub fn to_comment_mark_context(
    state: &EditorState,
    mark_id: &str,
) -> Result<Option<CommentMarkContext>> {
    Ok(crate::nodes::get_comment_mark_context(
        state.view(),
        mark_id,
        CommentContextOptions::default(),
    )?)
}
/// Convert a fetched cognition body, retaining the source fallback on any conversion failure.
pub fn cognition_from_presigned_body(body: &str) -> Vec<CognitionNode> {
    let converted = (|| -> Result<Vec<CognitionNode>> {
        let raw: SerializedEditorState = serde_json::from_str(body)?;
        let mut editor = crate::export_builder().build()?;
        let state = editor.parse_editor_state(&raw)?;
        to_cognition_text(&state)
    })();
    converted.unwrap_or_else(|_| {
        vec![CognitionNode {
            node_id: "plain-text".into(),
            content: body.into(),
            raw_content: body.into(),
            r#type: "markdown".into(),
        }]
    })
}

/// Import through the service's replacement-free registry and explicit host capabilities.
/// The service logs import diagnostics and retains the reached state; strict callers use
/// Editor::parse_editor_state instead. Text-cache failures still return an error.
pub fn parse_export_state(
    raw: &SerializedEditorState,
    context: &crate::DocumentContext,
) -> Result<EditorState> {
    let mut editor = crate::export_builder()
        .extension_state(context.clock.clone())
        .extension_state(context.random.clone())
        .extension_state(context.host.clone())
        .build()?;
    let report = editor.parse_editor_state_report(raw)?;
    for (key, _) in report.state.view().descendants(NodeKey::ROOT) {
        if let Some(node) = report.state.view().get::<ContactMentionNode>(key) {
            node.validate_text_content()?;
        }
    }
    editor.set_editor_state(report.state, TagSet::default())?;
    Ok(editor.state().clone())
}
