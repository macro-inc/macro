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
    if root_text_changed(tx)
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

// A single leaf replacement in an otherwise identical tree changes the root
// string exactly when it changes that leaf's string. Leave the root cache lazy:
// callers that request the whole document still pay for that read, once.
fn root_text_changed(tx: &Transaction<'_>) -> bool {
    let previous = &tx.editor.state;
    let next = &tx.pending;
    let next_view = tx.view();
    let previous_view = StateRef {
        #[cfg(feature = "foreign-nodes")]
        foreign_origin: next_view.foreign_origin,
        ..previous.view()
    };
    let unchanged_elements = !tx.full_reconcile
        && previous.opaque_text_count == 0
        && next.opaque_text_count == 0
        && tx.dirty_leaves.len() <= 1
        && next
            .registry
            .types()
            .all(|node| node.kind != NodeKind::Element || node.flags.is_some())
        && tx.dirty_elements.keys().all(|key| {
            let (Some(a), Some(b)) = (previous.nodes.get(key), next.nodes.get(key)) else {
                return false;
            };
            let (BaseData::Element(ae), BaseData::Element(be)) = (&a.base, &b.base) else {
                return false;
            };
            a.type_index == b.type_index
                && a.data.dyn_eq(b.data.as_ref())
                && a.links.parent == b.links.parent
                && a.links.prev == b.links.prev
                && a.links.next == b.links.next
                && ae.first == be.first
                && ae.last == be.last
                && ae.size == be.size
        });
    if unchanged_elements {
        let Some(key) = tx.dirty_leaves.first() else {
            return false;
        };
        if let (Some(a), Some(b)) = (previous.nodes.get(key), next.nodes.get(key))
            && a.links.parent == b.links.parent
            && a.links.prev == b.links.prev
            && a.links.next == b.links.next
        {
            return previous_view.text_content(*key) != next_view.text_content(*key);
        }
    }
    next_view.cached_root_text_content() != previous_view.cached_root_text_content()
}

#[cfg(all(test, feature = "foreign-nodes"))]
mod test;
