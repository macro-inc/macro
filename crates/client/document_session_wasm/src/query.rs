use crate::*;
use lexical_model::*;
pub(crate) fn markdown(
    state: &EditorState,
    flavor: u32,
    selected: bool,
) -> Result<String, BoundaryError> {
    let list_indent = match flavor {
        0 => 4,
        1 => 2,
        _ => return Err(BoundaryError::Invalid("markdown flavor")),
    };
    let options = lexical_markdown::MarkdownOptions {
        list_indent,
        ..Default::default()
    };
    if selected {
        Ok(lexical_markdown::convert_selection_to_markdown_string(
            state,
            &lexical_markdown::builtin::TRANSFORMERS,
            state.selection(),
            &options,
        )?)
    } else {
        Ok(lexical_markdown::convert_to_markdown_string(
            state,
            &lexical_markdown::builtin::TRANSFORMERS,
            None,
            &options,
        )?)
    }
}
fn html(state: &EditorState, selected: bool) -> Result<String, BoundaryError> {
    let registry = lexical_html::register_core(lexical_html::ExportRegistry::builder());
    let registry = [
        "heading",
        "quote",
        "link",
        "autolink",
        "list",
        "listitem",
        "code",
        "code-highlight",
        "mark",
        "table",
        "tablerow",
        "tablecell",
    ]
    .into_iter()
    .fold(registry, |registry, name| {
        registry.override_export(name, rich_html)
    })
    .build();
    Ok(
        lexical_html::HtmlExporter::new(registry, lexical_html::EditorTheme::default())
            .generate_html_from_nodes(state, if selected { state.selection() } else { None })?,
    )
}
fn rich_html<'a>(
    ctx: &lexical_html::ExportCtx<'a>,
    key: NodeKey,
) -> lexical_html::Result<lexical_html::DomExportOutput<'a>> {
    use lexical_html::{DomExportOutput, HtmlElement};
    let node = ctx.state.view().export_json(key)?;
    let kind = node
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if kind == "code-highlight" {
        return Ok(DomExportOutput::node(lexical_html::nodes::text_export_dom(
            ctx,
            key,
            lexical_html::nodes::text_create_dom(ctx, key)?,
        )?));
    }
    let tag = match kind {
        "heading" => node
            .get("tag")
            .and_then(serde_json::Value::as_str)
            .filter(|tag| matches!(*tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"))
            .unwrap_or("h1"),
        "quote" => "blockquote",
        "link" | "autolink" => "a",
        "list" => {
            if node.get("listType").and_then(serde_json::Value::as_str) == Some("number") {
                "ol"
            } else {
                "ul"
            }
        }
        "listitem" => "li",
        "code" => "pre",
        "mark" => "mark",
        "table" => "table",
        "tablerow" => "tr",
        "tablecell" => {
            if node
                .get("headerState")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                > 0
            {
                "th"
            } else {
                "td"
            }
        }
        _ => "span",
    };
    let mut element = HtmlElement::new(tag);
    if tag == "a" {
        let url = node
            .get("url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let safe = lexical_rich_nodes::link::sanitize_url(url);
        element.set_attribute("href", safe);
        for attribute in ["target", "rel", "title"] {
            if let Some(value) = node.get(attribute).and_then(serde_json::Value::as_str) {
                element.set_attribute(attribute, value);
            }
        }
    }
    if tag == "ol" {
        if let Some(start) = node.get("start").and_then(serde_json::Value::as_u64) {
            element.set_attribute("start", start.to_string());
        }
    }
    if matches!(tag, "td" | "th") {
        for (key, attribute) in [("colSpan", "colspan"), ("rowSpan", "rowspan")] {
            if let Some(span) = node
                .get(key)
                .and_then(serde_json::Value::as_u64)
                .filter(|v| *v > 1)
            {
                element.set_attribute(attribute, span.to_string());
            }
        }
    }
    if ctx.state.view().is_element(key) {
        lexical_html::nodes::element_export_dom(ctx, key, &mut element)?;
    }
    Ok(DomExportOutput::element(element))
}
pub(crate) fn clipboard(state: &EditorState) -> Result<wire::ClipboardMsg, BoundaryError> {
    let entries = lexical_rich_nodes::clipboard::get_clipboard_data_from_selection(
        state.view(),
        "document-session",
        state.selection(),
    )?;
    Ok(wire::ClipboardMsg {
        plain: entries.get("text/plain").cloned().unwrap_or_default(),
        lexical: entries
            .get("application/x-lexical-editor")
            .cloned()
            .unwrap_or_default(),
        html: if state.selection().is_some() {
            html(state, true)?
        } else {
            String::new()
        },
    })
}
pub(crate) fn query(
    session: &crate::EditorSession,
    msg: wire::QueryMsg,
) -> Result<wire::QueryReplyMsg, BoundaryError> {
    let surface = session.surface();
    let state = surface.state();
    let view = state.view();
    let mut reply = wire::QueryReplyMsg {
        text: String::new(),
        count: 0,
        keys: vec![],
        nodes: vec![],
        points: vec![],
    };
    match msg.kind {
        0 => reply.text = html(state, msg.flags & 1 != 0)?,
        1 => reply.text = markdown(state, msg.flags & 1, true)?,
        2 => {
            use lexical_rich_nodes::utils::matcher::RegexMatcher;
            let matcher = RegexMatcher::new(&msg.text, if msg.flags & 1 != 0 { "iu" } else { "u" })
                .map_err(|_| BoundaryError::Invalid("find regex"))?;
            for key in view.all_text_nodes(NodeKey::ROOT) {
                let text = view.text_content(key);
                for found in matcher.find_all(&text) {
                    reply.points.push(wire::PointMsg {
                        key: key.index(),
                        offset: found.index.get(),
                        _type: 0,
                    });
                    reply.points.push(wire::PointMsg {
                        key: key.index(),
                        offset: found.end().get(),
                        _type: 0,
                    });
                    reply.count += 1;
                }
            }
        }
        3 => {
            reply.count = state.root_text_content().split_whitespace().count() as u32;
        }
        4 => {
            let registered = surface
                .registry()
                .get(&msg.text)
                .ok_or(BoundaryError::Invalid("node type"))?;
            for key in view.nodes_of_type_index(registered.index) {
                reply.keys.push(key.index());
                reply
                    .nodes
                    .push(serde_json::to_string(&view.export_json(key)?)?);
            }
        }
        5 => {
            for (key, _) in view.descendants(NodeKey::ROOT) {
                if view
                    .export_json(key)?
                    .get("$")
                    .and_then(|state| state.get("id"))
                    .and_then(serde_json::Value::as_str)
                    == Some(&msg.text)
                {
                    reply.keys.push(key.index());
                    break;
                }
            }
        }
        6 => reply.text = serde_json::to_string(&view.export_json(NodeKey::ROOT)?)?,
        7 => reply.text = serde_json::to_string(&state.to_json()?)?,
        8 => {
            if let Some(cursors) = surface.selection_cursors() {
                reply.nodes = vec![serde_json::to_string(&lexical_loro::encode_selection(
                    &cursors,
                ))?];
            }
        }
        _ => return Err(BoundaryError::Invalid("query kind")),
    }
    Ok(reply)
}
