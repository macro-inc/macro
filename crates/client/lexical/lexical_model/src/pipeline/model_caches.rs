use crate::*;
use std::sync::Arc;
/// Cache writes happen after mutation reporting and never mark a record dirty.
pub(crate) fn apply(tx: &mut Transaction<'_>) {
    if tx.editor.mode() != EditorMode::ViewAttached || tx.sealed {
        return;
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
        }
    }
}
