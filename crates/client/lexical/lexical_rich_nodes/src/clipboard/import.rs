//! Priority-ordered clipboard import and selection-aware insertion.
use super::*;
/// Default importer weights; unweighted entries follow these in lexical order.
pub const DEFAULT_IMPORT_MIME_TYPE_PRIORITY: &[(&str, u32)] = &[
    (MIME_LEXICAL, 0),
    (MIME_HTML, 10),
    (MIME_PLAIN, 20),
    (MIME_URI_LIST, 30),
];
/// Import fresh keys through the registered stored-JSON importers.
pub fn generate_nodes_from_serialized_nodes(
    tx: &mut Transaction<'_>,
    nodes: &[Value],
) -> Result<Vec<NodeKey>, Error> {
    nodes
        .iter()
        .map(|node| tx.import_node(node.as_object().ok_or(Error::NodePayloadNotObject)?))
        .collect()
}
/// Give registered clipboard handlers first refusal, then insert and synchronize typing style.
pub fn insert_generated_nodes(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    selection: SelectionSlot,
) -> Result<(), Error> {
    if tx.dispatch(&Command::InsertClipboardNodes {
        nodes: nodes.to_vec(),
        selection,
    })? == Handled::Yes
    {
        return Ok(());
    }
    tx.insert_nodes_at(selection, nodes)?;
    let Ok(range) = tx.range_at(selection) else {
        return Ok(());
    };
    if !range.is_collapsed() {
        return Ok(());
    }
    let anchor = caret_from_point(tx.view(), &range.anchor, CaretDirection::Previous)?;
    let node = if let PointCaret::Text(text) = anchor {
        Some(text.origin)
    } else {
        let end = ChildCaret::new(tx.view(), NodeKey::ROOT, CaretDirection::Previous)
            .ok_or(Error::Invariant("root must be an element"))?;
        let range = CaretRange::new(anchor, end.into())?;
        let mut cursor = range.node_carets(tx.view(), RootMode::Root)?;
        let mut node = None;
        while let Some(caret) = cursor.next(tx.view())? {
            let key = caret.origin();
            if tx.is_text(key) {
                node = Some(key);
                break;
            }
            if tx.is_element(key) && !tx.is_inline(key) {
                break;
            }
        }
        node
    };
    if let Some(key) = node {
        let data = tx.text_data(key)?.clone();
        if data.format != tx.range_at(selection)?.format
            || data.style != tx.range_at(selection)?.style
        {
            tx.set_selection_format_at(selection, data.format)?;
            tx.set_selection_style_at(selection, &data.style)?;
        }
    }
    Ok(())
}
fn plain(tx: &mut Transaction<'_>, text: &str, slot: SelectionSlot) -> Result<(), Error> {
    if !matches!(tx.selection_at(slot)?, Some(Selection::Range(_))) {
        return tx.insert_raw_text_at(slot, text);
    }
    let normalized = text.replace("\r\n", "\n");
    for (i, line) in normalized.split('\n').enumerate() {
        if i > 0 {
            tx.insert_paragraph_at(slot)?;
        }
        for (i, part) in line.split('\t').enumerate() {
            if i > 0 {
                let tab = tx.create(Tab {})?;
                tx.insert_nodes_at(slot, &[tab.key()])?;
            }
            if !part.is_empty() {
                tx.insert_text_at(slot, part)?;
            }
        }
    }
    Ok(())
}
/// Run default rich importers in priority order; supplied HTML nodes come from the view.
pub fn insert_data_transfer_for_rich_text(
    tx: &mut Transaction<'_>,
    namespace: &str,
    entries: &[ClipboardEntry<'_>],
    html_nodes: Option<&[SerializedNode]>,
    selection: SelectionSlot,
) -> Result<bool, Error> {
    let mut entries = entries.iter().collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        (
            DEFAULT_IMPORT_MIME_TYPE_PRIORITY
                .iter()
                .find(|(mime, _)| *mime == entry.mime)
                .map(|(_, priority)| *priority)
                .unwrap_or(u32::MAX),
            entry.mime,
        )
    });
    let plain_text = entries
        .iter()
        .find(|entry| entry.mime == MIME_PLAIN)
        .map(|entry| entry.data);
    for entry in entries {
        if entry.data.is_empty() {
            continue;
        }
        match entry.mime {
            MIME_LEXICAL => {
                let imported = (|| -> Result<bool, Error> {
                    let payload = serde_json::from_str::<LexicalClipboardPayload>(entry.data)?;
                    if payload.namespace != namespace {
                        return Ok(false);
                    }
                    let nodes = generate_nodes_from_serialized_nodes(tx, &payload.nodes)?;
                    insert_generated_nodes(tx, &nodes, selection)?;
                    Ok(true)
                })();
                match imported {
                    Ok(true) => return Ok(true),
                    Ok(false) => {}
                    Err(_) => tracing::warn!(
                        bytes = entry.data.len(),
                        "invalid lexical clipboard content"
                    ),
                }
            }
            MIME_HTML if Some(entry.data) != plain_text => {
                if let Some(html_nodes) = html_nodes {
                    let imported = (|| -> Result<(), Error> {
                        let nodes = generate_nodes_from_dom_drafts(tx, html_nodes)?;
                        insert_generated_nodes(tx, &nodes, selection)
                    })();
                    match imported {
                        Ok(()) => return Ok(true),
                        Err(_) => {
                            tracing::warn!(bytes = entry.data.len(), "invalid HTML clipboard nodes")
                        }
                    }
                }
            }
            MIME_PLAIN | MIME_URI_LIST => {
                plain(tx, entry.data, selection)?;
                return Ok(true);
            }
            _ => {}
        }
    }
    Ok(false)
}
/// Plain-text paste uses the first nonempty plain or URI value as raw text.
pub fn insert_data_transfer_for_plain_text(
    tx: &mut Transaction<'_>,
    entries: &[ClipboardEntry<'_>],
) -> Result<bool, Error> {
    if let Some(data) = [MIME_PLAIN, MIME_URI_LIST].into_iter().find_map(|mime| {
        entries
            .iter()
            .find(|entry| entry.mime == mime && !entry.data.is_empty())
            .map(|entry| entry.data)
    }) {
        tx.insert_raw_text(data)?;
        return Ok(true);
    }
    Ok(false)
}
