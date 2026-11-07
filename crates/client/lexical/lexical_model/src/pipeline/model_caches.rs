use crate::*;
use std::sync::Arc;
/// Cache writes happen after mutation reporting. Root reconciliation retains
/// upstream's intentional dirty mark without adding a cache-only mutation.
pub(crate) fn apply(tx: &mut Transaction<'_>) {
    if tx.editor.mode() != EditorMode::ViewAttached {
        return;
    }
    // Reconciliation writes the root text cache through getWritable. Keep its
    // record identity distinct even though the cache itself lives on the state.
    if tx.pending.root_text_content() != tx.editor.state.root_text_content()
        && let Some(root) = tx.pending.nodes.get_mut(&NodeKey::ROOT)
    {
        Arc::make_mut(root);
        tx.dirty_elements
            .insert(NodeKey::ROOT, DirtyIntent::Intentional);
    }
    let keys = if tx.full_reconcile {
        tx.pending.nodes.keys().copied().collect::<Vec<_>>()
    } else {
        tx.dirty_elements.keys().copied().collect::<Vec<_>>()
    };
    for key in keys {
        if !tx.editor.state.nodes.contains_key(&key) || tx.is_root_or_shadow_root(key) {
            continue;
        }
        let first = tx
            .descendants(key)
            .find(|(child, _)| tx.kind(*child) == Some(NodeKind::Text));
        let Some((format, style)) = first.and_then(|(child, _)| {
            tx.view()
                .text(child)
                .map(|data| (data.format, data.style.clone()))
        }) else {
            continue;
        };
        if tx
            .view()
            .element(key)
            .is_some_and(|data| data.text_format != format || data.text_style != style)
            && let Some(record) = tx.pending.nodes.get_mut(&key)
            && let BaseData::Element(data) = &mut Arc::make_mut(record).base
        {
            data.text_format = format;
            data.text_style = style;
            tx.dirty_elements.insert(key, DirtyIntent::Intentional);
        }
    }
}
