use crate::*;
use lexical_model::*;
#[derive(Clone, Copy)]
pub(crate) enum ExportFlavor {
    Upstream,
    Macro,
}
pub(crate) fn export_flavor(session: &crate::EditorSession) -> ExportFlavor {
    if session.surface().registry().get("custom-code").is_some() {
        ExportFlavor::Macro
    } else {
        ExportFlavor::Upstream
    }
}
pub(crate) fn markdown_for_session(
    session: &crate::EditorSession,
    flavor: u32,
    selected: bool,
) -> Result<String, BoundaryError> {
    if matches!(export_flavor(session), ExportFlavor::Upstream) {
        return markdown(session.surface().state(), flavor, selected);
    }
    let external = match flavor {
        0 => false,
        1 => true,
        _ => return Err(BoundaryError::Invalid("markdown flavor")),
    };
    Ok(document_session::export_application_markdown(
        session.surface().state(),
        external,
        selected,
        session.hostname.as_deref(),
    )?)
}

pub(crate) fn saved_state(session: &crate::EditorSession) -> Result<String, BoundaryError> {
    let state = session.surface().state();
    if matches!(export_flavor(session), ExportFlavor::Macro) {
        Ok(serde_json::to_string(
            &macro_document_model::save::saved_state(state)?,
        )?)
    } else {
        Ok(serde_json::to_string(&state.to_json()?)?)
    }
}
pub(crate) fn markdown(
    state: &EditorState,
    flavor: u32,
    selected: bool,
) -> Result<String, BoundaryError> {
    let flavor = match flavor {
        0 => document_session::MarkdownFlavor::Upstream,
        1 => document_session::MarkdownFlavor::Application,
        _ => return Err(BoundaryError::Invalid("markdown flavor")),
    };
    Ok(document_session::export_markdown(state, flavor, selected)?)
}

fn html(
    state: &EditorState,
    selected: bool,
    flavor: ExportFlavor,
) -> Result<String, BoundaryError> {
    html_for_selection(
        state,
        if selected { state.selection() } else { None },
        flavor,
    )
}
fn html_for_selection(
    state: &EditorState,
    selection: Option<&Selection>,
    flavor: ExportFlavor,
) -> Result<String, BoundaryError> {
    if matches!(flavor, ExportFlavor::Macro) {
        return Ok(document_session::export_application_html_for_selection(
            state, selection,
        )?);
    }

    Ok(document_session::export_html_for_selection(
        state, selection,
    )?)
}
pub(crate) fn clipboard(
    state: &EditorState,
    namespace: &str,
    blocks: bool,
    flavor: ExportFlavor,
) -> Result<wire::ClipboardMsg, BoundaryError> {
    if blocks {
        return block_clipboard(state, namespace, flavor);
    }

    let plain = state
        .selection()
        .map(|selection| selection.text_content(state.view()))
        .transpose()?
        .unwrap_or_default();
    let lexical = lexical_rich_nodes::clipboard::get_lexical_content(
        state.view(),
        namespace,
        state.selection(),
    )?
    .unwrap_or_default();
    Ok(wire::ClipboardMsg {
        plain,
        lexical,
        html: if state.selection().is_some() {
            html(state, true, flavor)?
        } else {
            String::new()
        },
    })
}
/// Block dragging explicitly includes descendants without changing normal copy semantics.
fn block_clipboard(
    state: &EditorState,
    namespace: &str,
    flavor: ExportFlavor,
) -> Result<wire::ClipboardMsg, BoundaryError> {
    let Some(Selection::Node(roots)) = state.selection() else {
        return Err(BoundaryError::Invalid("block clipboard selection"));
    };
    let view = state.view();
    let mut expanded = NodeSelection::new();
    let mut pending: Vec<_> = roots.keys().collect();
    while let Some(key) = pending.pop() {
        if !view.contains(key) || expanded.has(key) {
            continue;
        }
        expanded.add(key);
        if view.is_element(key) {
            pending.extend(view.children_keys(key)?);
        }
    }
    let selection = Selection::Node(expanded);
    let lexical =
        lexical_rich_nodes::clipboard::get_lexical_content(view, namespace, Some(&selection))?
            .unwrap_or_default();
    Ok(wire::ClipboardMsg {
        plain: roots.text_content(view),
        lexical,
        html: html_for_selection(state, Some(&selection), flavor)?,
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
        0 => reply.text = html(state, msg.flags & 1 != 0, export_flavor(session))?,
        1 => reply.text = markdown_for_session(session, msg.flags & 1, true)?,
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
        7 => reply.text = bulk::serialize(state)?,
        8 => {
            if let Some(cursors) = surface.selection_cursors() {
                reply.nodes = vec![serde_json::to_string(&lexical_loro::encode_selection(
                    &cursors,
                ))?];
            }
        }
        9 => {
            if msg.flags != session.machine.generation() {
                return Err(BoundaryError::Invalid("application query generation"));
            }
            let envelope: serde_json::Value = serde_json::from_str(&msg.text)?;
            let name = envelope
                .get("name")
                .and_then(serde_json::Value::as_str)
                .ok_or(BoundaryError::Invalid("application query name"))?;
            let data = envelope
                .get("data")
                .ok_or(BoundaryError::Invalid("application query data"))?;
            let value = macro_document_model::surface::query(name, data, msg.flags, state)?
                .ok_or(BoundaryError::Invalid("application query"))?;
            reply.text = serde_json::to_string(&value)?;
        }
        _ => return Err(BoundaryError::Invalid("query kind")),
    }
    Ok(reply)
}

#[cfg(test)]
mod block_test {
    use super::*;
    #[test]
    fn block_drag_copies_descendants_without_expanding_ordinary_node_copy(
    ) -> Result<(), BoundaryError> {
        use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};
        let mut editor = macro_document_model::surface::preset_builder_with_mode(
            macro_document_model::EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        editor.update(|tx| {
            let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
            let a = tx.create(ListItemNode::default())?;
            let b = tx.create(ListItemNode::default())?;
            let first = tx.create_text("first")?;
            let second = tx.create_text("second")?;
            tx.append(a, &[first.key()])?;
            tx.append(b, &[second.key()])?;
            tx.append(list, &[a.key(), b.key()])?;
            tx.append(NodeKey::ROOT, &[list.key()])?;
            let mut selection = NodeSelection::new();
            selection.add(list);
            tx.set_selection(Some(Selection::Node(selection)))
        })?;
        let ordinary = clipboard(
            editor.state(),
            "document-session",
            false,
            ExportFlavor::Macro,
        )?;
        let drag = clipboard(
            editor.state(),
            "document-session",
            true,
            ExportFlavor::Macro,
        )?;
        let normal: serde_json::Value = serde_json::from_str(&ordinary.lexical)?;
        let full: serde_json::Value = serde_json::from_str(&drag.lexical)?;
        assert_eq!(
            normal.pointer("/nodes/0/children"),
            Some(&serde_json::json!([]))
        );
        assert_eq!(
            full.pointer("/nodes/0/children/0/children/0/text")
                .and_then(serde_json::Value::as_str),
            Some("first")
        );
        assert_eq!(
            full.pointer("/nodes/0/children/1/children/0/text")
                .and_then(serde_json::Value::as_str),
            Some("second")
        );
        assert_eq!(drag.plain, ordinary.plain);
        assert!(drag.html.contains("first"));
        assert!(drag.html.contains("second"));
        assert_eq!(
            clipboard(
                editor.state(),
                "document-session",
                false,
                ExportFlavor::Macro
            )?
            .lexical,
            ordinary.lexical
        );
        Ok(())
    }
}
