//! The Source search field belongs to the local storage writer, not ordinary editor JSON.
use crate::index::NodeIndex;
use crate::policy::synced_children;
use crate::*;
use serde_json::Value;

const FIELD: &str = "searchText";

#[derive(Default)]
struct IdGroup {
    children: Vec<NodeKey>,
    last_element: Option<NodeKey>,
}

#[derive(Default)]
struct RootIds {
    by_key: FxHashMap<NodeKey, Identity>,
    groups: OrderedMap<String, IdGroup>,
}

#[derive(PartialEq, Eq)]
struct Identity {
    source: Option<String>,
    recipient: Option<String>,
}

struct ValueForId {
    id: String,
    text: String,
}

struct Authored {
    container: ContainerID,
    value: ValueForId,
}

#[derive(Default)]
pub(crate) struct SearchText {
    ids: Option<RootIds>,
    authored: OrderedMap<NodeKey, Authored>,
}

#[derive(Default)]
pub(crate) struct Draft {
    ids: Option<RootIds>,
    values: OrderedMap<NodeKey, Option<ValueForId>>,
    applied: OrderedSet<NodeKey>,
}

impl Draft {
    pub(crate) fn keys(&self) -> impl Iterator<Item = NodeKey> + '_ {
        self.values.keys().copied()
    }

    pub(crate) fn apply(&mut self, key: NodeKey, json: &mut SerializedNode) -> Result<bool> {
        let Some(value) = self.values.get(&key) else {
            return Ok(false);
        };
        if let Some(value) = value
            && !apply_value(json, value)
        {
            return Err(diverged(
                "root search text recipient changed during storage export",
            ));
        }
        self.applied.insert(key);
        Ok(true)
    }
}

fn serialized_id(json: &SerializedNode) -> Option<&str> {
    json.get("$")?
        .as_object()?
        .get("id")?
        .as_str()
        .filter(|id| !id.is_empty())
}

fn apply_value(json: &mut SerializedNode, value: &ValueForId) -> bool {
    let Some(Value::Object(state)) = json.get_mut("$") else {
        return false;
    };
    if state.get("id").and_then(Value::as_str) != Some(value.id.as_str()) {
        return false;
    }
    state.insert(FIELD.into(), Value::String(value.text.clone()));
    true
}

fn identity(view: StateRef<'_>, key: NodeKey, policy: &dyn SyncPolicy) -> Result<Option<Identity>> {
    let source = if view.is_element(key) {
        policy.root_search_text_id(view, key)?
    } else {
        None
    };
    let recipient = serialized_id(&view.export_json(key)?).map(str::to_owned);
    Ok((source.is_some() || recipient.is_some()).then_some(Identity { source, recipient }))
}

impl SearchText {
    pub(crate) fn prepare(
        &self,
        view: StateRef<'_>,
        policy: &dyn SyncPolicy,
        dirty: impl Iterator<Item = NodeKey>,
        root_structure: bool,
    ) -> Result<Draft> {
        let mut result = Draft::default();
        let mut affected = OrderedSet::default();
        if !root_structure && let Some(ids) = &self.ids {
            let mut rebuild = false;
            for key in dirty.filter(|&key| view.parent(key) == Some(NodeKey::ROOT)) {
                let current = identity(view, key, policy)?;
                if current.as_ref() != ids.by_key.get(&key) {
                    rebuild = true;
                    break;
                }
                if let Some(current) = current {
                    affected.extend(current.source.into_iter().chain(current.recipient));
                }
            }
            if !rebuild {
                for id in affected {
                    Self::derive_group(view, &id, &ids.groups[&id], &mut result.values);
                }
                return Ok(result);
            }
        }

        let mut ids = RootIds::default();
        for key in view.children(NodeKey::ROOT) {
            let Some(identity) = identity(view, key, policy)? else {
                continue;
            };
            if let Some(id) = &identity.source {
                ids.groups.entry(id.clone()).or_default().last_element = Some(key);
            }
            if let Some(id) = &identity.recipient {
                ids.groups.entry(id.clone()).or_default().children.push(key);
            }
            ids.by_key.insert(key, identity);
        }
        for (id, group) in &ids.groups {
            Self::derive_group(view, id, group, &mut result.values);
        }
        for &key in self.authored.keys() {
            // A moved former top-level node keeps its ordinary stored field,
            // if any. Only the writer's previous overlay is retired.
            result.values.entry(key).or_insert(None);
        }
        result.ids = Some(ids);
        Ok(result)
    }

    fn derive_group(
        view: StateRef<'_>,
        id: &str,
        group: &IdGroup,
        values: &mut OrderedMap<NodeKey, Option<ValueForId>>,
    ) {
        if let Some(source) = group.last_element {
            let text = view.text_content(source).into_owned();
            for key in &group.children {
                values.insert(
                    *key,
                    Some(ValueForId {
                        id: id.into(),
                        text: text.clone(),
                    }),
                );
            }
        }
    }

    pub(crate) fn apply_expected(
        &self,
        key: NodeKey,
        index: &NodeIndex,
        json: &mut SerializedNode,
    ) {
        if let Some(authored) = self.authored.get(&key)
            && index
                .nodes
                .get(&key)
                .is_some_and(|slot| slot.map == authored.container)
        {
            apply_value(json, &authored.value);
        }
    }

    pub(crate) fn apply_expected_tree(
        &self,
        view: StateRef<'_>,
        key: NodeKey,
        policy: &dyn SyncPolicy,
        index: &NodeIndex,
        json: &mut SerializedNode,
    ) {
        self.apply_expected(key, index, json);
        if let Some(Value::Array(children)) = json.get_mut("children") {
            for (child, key) in children.iter_mut().zip(synced_children(view, key, policy)) {
                if let Some(child) = child.as_object_mut() {
                    self.apply_expected_tree(view, key, policy, index, child);
                }
            }
        }
    }

    pub(crate) fn seal(&mut self, draft: Draft, index: &NodeIndex) {
        if let Some(ids) = draft.ids {
            self.ids = Some(ids);
        }
        for (key, value) in draft.values {
            if !draft.applied.contains(&key) {
                continue;
            }
            if let Some(value) = value
                && let Some(slot) = index.nodes.get(&key)
            {
                self.authored.insert(
                    key,
                    Authored {
                        container: slot.map.clone(),
                        value,
                    },
                );
            } else {
                self.authored.shift_remove(&key);
            }
        }
    }

    pub(crate) fn accept_remote(
        &mut self,
        updated: Vec<(NodeKey, ContainerID)>,
        index: &NodeIndex,
        changed: bool,
    ) {
        if changed {
            self.invalidate_roots();
        }
        for (key, container) in updated {
            if self
                .authored
                .get(&key)
                .is_some_and(|row| row.container == container)
            {
                self.authored.shift_remove(&key);
            }
        }
        self.retire_unbound(index);
    }

    pub(crate) fn invalidate_roots(&mut self) {
        self.ids = None;
    }

    pub(crate) fn retire_unbound(&mut self, index: &NodeIndex) {
        self.authored.retain(|key, authored| {
            index
                .nodes
                .get(key)
                .is_some_and(|slot| slot.map == authored.container)
        });
    }
}
