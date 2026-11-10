//! Snapshot reconciliation using the persisted loro-mirror schema.
use super::*;
use loro::LoroMovableList;
use serde_json::Value;
use std::borrow::Cow;

/// Reconcile the document's root map and commit with the source mirror origin.
/// Existing containers are retained; list movement uses post-deletion positions.
pub fn set_state(doc: &LoroDoc, root: &Value) -> Result<()> {
    set_state_inner(doc, root, None)
}
/// Fully reconcile already-synced editor state while retaining protected local fields.
/// For a live editor snapshot, use [`set_synced_editor_state`] to retain imported storage.
#[tracing::instrument(name = "doc.projection.full_sync", skip_all, err)]
pub fn set_synced_state(
    doc: &LoroDoc,
    state: &SerializedEditorState,
    policy: &dyn SyncPolicy,
) -> Result<()> {
    set_state_inner(doc, &Value::Object(state.root.clone()), Some(policy))
}
/// Reconcile an editor snapshot while retaining its imported storage values.
#[tracing::instrument(name = "doc.projection.full_sync", skip_all, err)]
pub fn set_synced_editor_state(
    doc: &LoroDoc,
    state: &EditorState,
    policy: &dyn SyncPolicy,
) -> Result<()> {
    let root = crate::policy::stored_node(state.view(), NodeKey::ROOT, policy)?;
    set_state_inner(doc, &Value::Object(root), Some(policy))
}
fn set_state_inner(doc: &LoroDoc, root: &Value, policy: Option<&dyn SyncPolicy>) -> Result<()> {
    let root = root.as_object().ok_or_else(|| schema_error("root"))?;
    reconcile(&doc.get_map("root"), root, policy)?;
    doc.commit_with(loro::CommitOptions::new().origin(LOCAL_ORIGIN));
    Ok(())
}
fn reconcile(map: &LoroMap, new: &SerializedNode, policy: Option<&dyn SyncPolicy>) -> Result<()> {
    let before = schema::from_loro(&map.get_deep_value())?;
    let mut before = Cow::Borrowed(before.as_object().ok_or_else(|| schema_error("node"))?);
    let mut new_fields = Cow::Borrowed(new);
    if let Some(policy) = policy {
        mask_local_state(before.to_mut(), policy);
        storage_fields(new_fields.to_mut(), policy);
    }
    schema::diff_map(
        map,
        &before,
        &new_fields,
        schema::MapSchema::Node,
        &mut ProjectionStats::default(),
    )?;
    match new.get("children") {
        Some(Value::Array(children)) => {
            let list = match map.get("children") {
                Some(ValueOrContainer::Container(Container::MovableList(list))) => list,
                _ => map.insert_container("children", LoroMovableList::new())?,
            };
            reconcile_children(&list, children, policy)?;
        }
        Some(value) => {
            map.insert("children", schema::to_loro(value))?;
        }
        None if map.get("children").is_some() => {
            map.delete("children")?;
        }
        None => {}
    }
    Ok(())
}
fn id(node: &Value) -> Option<&str> {
    node.get("$")?
        .get("id")?
        .as_str()
        .filter(|id| !id.is_empty())
}
fn reconcile_children(
    list: &LoroMovableList,
    new: &[Value],
    policy: Option<&dyn SyncPolicy>,
) -> Result<()> {
    let old: Vec<_> = (0..list.len())
        .map(|index| {
            let map = schema::map_at(list.get(index), "children")?;
            let value = schema::from_loro(&map.get_deep_value())?;
            Ok((map, value))
        })
        .collect::<Result<_>>()?;
    let positions: std::collections::HashMap<_, _> = old
        .iter()
        .enumerate()
        .filter_map(|(index, (_, value))| id(value).map(|id| (id.to_owned(), index)))
        .collect();
    let wanted: std::collections::HashSet<_> = new.iter().filter_map(id).collect();
    let mut live: Vec<_> = old
        .iter()
        .enumerate()
        .map(|(index, (_, value))| (id(value).map(str::to_owned), index))
        .collect();
    let missing = old.iter().filter(|(_, value)| id(value).is_none()).count()
        + new.iter().filter(|value| id(value).is_none()).count();
    let new_ids: Vec<_> = new.iter().filter_map(id).collect();
    let duplicate = old.len().saturating_sub(positions.len())
        - old.iter().filter(|(_, value)| id(value).is_none()).count()
        + new_ids.len().saturating_sub(
            new_ids
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>()
                .len(),
        );
    if missing > 0 || duplicate > 0 {
        tracing::warn!(
            missing,
            duplicate,
            "snapshot children have missing or duplicate ids"
        );
    }
    let deleted: Vec<_> = live
        .iter()
        .enumerate()
        .filter_map(|(index, (id, _))| {
            id.as_deref()
                .is_some_and(|id| !wanted.contains(id))
                .then_some(index)
        })
        .collect();
    for index in deleted.into_iter().rev() {
        list.delete(index, 1)?;
        live.remove(index);
    }
    let common: Vec<_> = new
        .iter()
        .filter_map(|value| id(value).filter(|id| positions.contains_key(*id)))
        .collect();
    let sequence: Vec<_> = common
        .iter()
        .filter_map(|id| positions.get(*id).copied())
        .collect();
    let keep = local::lis(&sequence);
    for (rank, id) in common.iter().enumerate() {
        if keep.contains(&rank) {
            continue;
        }
        let from = live
            .iter()
            .position(|(_, original)| Some(original) == positions.get(*id))
            .ok_or_else(|| diverged("snapshot move source missing"))?;
        let value = live.remove(from);
        let to = if rank == 0 {
            0
        } else {
            let previous = common
                .get(rank - 1)
                .ok_or_else(|| diverged("snapshot predecessor missing"))?;
            live.iter()
                .position(|(_, original)| Some(original) == positions.get(*previous))
                .ok_or_else(|| diverged("snapshot move predecessor missing"))?
                + 1
        };
        live.insert(to, value);
        if from != to {
            list.mov(from, to)?;
        }
    }
    for (index, node) in new.iter().enumerate() {
        let own = node.as_object().ok_or_else(|| schema_error("child"))?;
        if id(node).is_some_and(|id| positions.contains_key(id)) {
            continue;
        }
        let map = list.insert_container(index, LoroMap::new())?;
        let mut stored = Cow::Borrowed(own);
        if let Some(policy) = policy {
            storage_tree(stored.to_mut(), policy);
        }
        schema::initialize_map(&map, &stored, schema::MapSchema::Node)?;
        live.insert(index, (id(node).map(str::to_owned), usize::MAX));
    }
    for node in new {
        if let Some(id) = id(node)
            && positions.contains_key(id)
        {
            let index = live
                .iter()
                .position(|(_, original)| Some(original) == positions.get(id))
                .ok_or_else(|| diverged("snapshot common child missing"))?;
            let map = schema::map_at(list.get(index), "common child")?;
            reconcile(
                &map,
                node.as_object().ok_or_else(|| schema_error("child"))?,
                policy,
            )?;
        }
    }
    Ok(())
}
