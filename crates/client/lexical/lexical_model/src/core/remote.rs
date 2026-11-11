//! Ordered remote projection edits, preserving active selection fixups.
use super::*;
use crate::collections::{HashMap, IndexSet};
impl Transaction<'_> {
    /// Create an exact registered node from remote fields, without replacements or virtual setters.
    pub fn import_remote_node(&mut self, json: &SerializedNode) -> Result<NodeKey, Error> {
        if json
            .get("children")
            .is_some_and(|value| value.as_array().is_none_or(|children| !children.is_empty()))
        {
            return Err(Error::RemoteChildrenInCreate);
        }
        let name = json
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or(Error::Invariant("remote node type"))?;
        let index = self.pending.registry.import_index(name, json)?;
        let key = (self.pending.registry.vtable(index).import_exact)(self, json)?;
        self.apply_remote_fields(key, json)?;
        Ok(key)
    }
}
fn update_fields(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    json: &SerializedNode,
    retain: &[&str],
) -> Result<(), Error> {
    if let Some(name) = json.get("type").and_then(serde_json::Value::as_str)
        && tx.type_name(key)? != name
    {
        return Err(Error::NodeTypeMismatch(key));
    }
    tx.apply_remote_fields_retaining_state(key, json, retain)
}
pub(super) fn apply(
    tx: &mut Transaction<'_>,
    changes: &[NodeChange],
    effects: &mut Vec<Effect>,
) -> Result<(), Error> {
    let mut locals = HashMap::default();
    let mut created = vec![];
    let resolve = |target: NodeTarget, locals: &HashMap<LocalNode, NodeKey>| match target {
        NodeTarget::Key(key) => Ok(key),
        NodeTarget::Local(local) => locals
            .get(&local)
            .copied()
            .ok_or(Error::UnknownLocalNode(local)),
    };
    for change in changes {
        match change {
            NodeChange::Create { local, json } => {
                if locals.contains_key(local) {
                    return Err(Error::DuplicateLocalNode(*local));
                }
                let key = tx.import_remote_node(json)?;
                locals.insert(*local, key);
                created.push((*local, key));
            }
            NodeChange::Children { parent, children } => {
                let parent = resolve(*parent, &locals)?;
                let children = children
                    .iter()
                    .map(|target| resolve(*target, &locals))
                    .collect::<Result<Vec<_>, _>>()?;
                let unique: IndexSet<_> = children.iter().copied().collect();
                if unique.len() != children.len() {
                    return Err(Error::DuplicateRemoteChild);
                }
                for old in tx.children_keys(parent)? {
                    if !unique.contains(&old) {
                        // remove preserves the same active element-point fixups and dirt order.
                        tx.default_remove(old, true, true)?;
                    }
                }
                for (index, key) in children.iter().enumerate() {
                    let index =
                        ChildIndex(u32::try_from(index).map_err(|_| Error::SpliceOutOfRange)?);
                    if tx.child_at_index(parent, index) != Some(*key) {
                        tx.splice(parent, index, 0, &[*key])?;
                    }
                }
            }
            NodeChange::Update { node, json } => {
                update_fields(tx, resolve(*node, &locals)?, json, &[])?;
            }
            NodeChange::UpdateRootRetainingState { json, retain } => {
                update_fields(tx, NodeKey::ROOT, json, retain)?;
            }
            NodeChange::SpliceText {
                node,
                range,
                insert,
            } => {
                let key = resolve(*node, &locals)?;
                let data = tx.view().text_data(key)?;
                let start = data.text.byte_offset(range.start)?;
                let end = data.text.byte_offset(range.end)?;
                if start > end {
                    return Err(Error::InvalidRemoteTextRange);
                }
                let text = format!(
                    "{}{}{}",
                    data.text
                        .as_str()
                        .get(..start)
                        .ok_or(Error::InvalidRemoteTextRange)?,
                    insert,
                    data.text
                        .as_str()
                        .get(end..)
                        .ok_or(Error::InvalidRemoteTextRange)?
                );
                let BaseData::Text(data) = &mut tx.writable(key)?.base else {
                    return Err(Error::NotAText(key));
                };
                data.text = TextBuffer::new(text);
            }
            NodeChange::Remove { node } => {
                tx.remove(resolve(*node, &locals)?, true)?;
            }
        }
    }
    if !created.is_empty() {
        effects.push(Effect::RemoteNodesCreated(created));
    }
    Ok(())
}
