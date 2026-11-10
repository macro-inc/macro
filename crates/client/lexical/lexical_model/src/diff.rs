//! Structural view patches between immutable snapshots.
use crate::collections::{HashMap, IndexSet};
use crate::*;
use std::sync::Arc;
mod decorator_observer;
pub use decorator_observer::*;
mod encode;
pub use encode::*;
/// Optional patch groups.
#[derive(Clone, Copy, Debug, Default)]
pub struct DiffOptions {
    /// Include NodeState, which the DOM ordinarily ignores.
    pub include_state: bool,
}
/// A structural patch spanning a commit chain.
#[derive(Clone, PartialEq, Debug)]
pub struct Diff {
    /// Node key generation.
    pub generation: u32,
    /// Chain includes a full map comparison.
    pub full_reconcile: bool,
    /// Host already displays this node's text.
    pub view_text_matches: Option<NodeKey>,
    /// Ordered operations.
    pub ops: Vec<DiffOp>,
    /// Native-only observations resolved by the consuming view at exposure.
    /// Flat encoding does not serialize signatures or assign observation revisions.
    pub decorator_renders: Vec<DecoratorRenderChange>,
}
/// Final component policy for one touched decorator in this patch.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct DecoratorRenderChange {
    /// Full lifetime identity, including key generation.
    pub key: NodeKey,
    /// Pure final policy, without observing an intermediate publication.
    /// None retires a removed decorator's consuming-view observation.
    pub policy: Option<DecoratorRenderPolicy>,
}
/// All view-relevant text fields except content.
#[derive(Clone, PartialEq, Debug)]
pub struct TextProps {
    /// Format bits.
    pub format: TextFormat,
    /// Text editing mode.
    pub mode: TextMode,
    /// Text detail bits.
    pub detail: TextDetail,
    /// Inline CSS.
    pub style: Arc<str>,
}
impl From<&TextData> for TextProps {
    fn from(data: &TextData) -> Self {
        Self {
            format: data.format,
            mode: data.mode,
            detail: data.detail,
            style: data.style.clone(),
        }
    }
}
/// All view-relevant element fields except child links.
#[derive(Clone, PartialEq, Debug)]
pub struct ElementProps {
    /// Block alignment.
    pub format: ElementFormat,
    /// Virtual indentation.
    pub indent: u32,
    /// Explicit direction.
    pub direction: Option<TextDirection>,
    /// Default text format.
    pub text_format: TextFormat,
    /// Element CSS.
    pub style: Arc<str>,
    /// Default text CSS.
    pub text_style: Arc<str>,
}
fn element_props(view: StateRef<'_>, key: NodeKey) -> Result<ElementProps, Error> {
    let data = view.element_data(key)?;
    Ok(ElementProps {
        format: data.format,
        indent: {
            #[cfg(feature = "foreign-nodes")]
            if view.state.foreign_instances.has_hooks() {
                data.indent
            } else {
                view.indent(key)
            }
            #[cfg(not(feature = "foreign-nodes"))]
            view.indent(key)
        },
        direction: data.direction,
        text_format: data.text_format,
        style: data.style.clone(),
        text_style: data.text_style.clone(),
    })
}
/// One structural or property-group operation.
#[derive(Clone, PartialEq, Debug)]
pub enum DiffOp {
    /// Set the actual consuming-view component lifetime with full u64 precision.
    SetDecoratorRevision {
        /// Full node lifetime identity.
        key: NodeKey,
        /// Eager native invalidation or resolved signature observation revision.
        revision: u64,
    },
    /// Remove a node; a subtree root has no removed parent.
    Remove {
        /// Removed key.
        key: NodeKey,
        /// Host must detach this subtree.
        subtree_root: bool,
    },
    /// Create an element before its descendants.
    CreateElement {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Element base fields.
        base: ElementProps,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a text node.
    CreateText {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Text content.
        text: String,
        /// Text base fields.
        base: TextProps,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a decorator.
    CreateDecorator {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a line break.
    CreateLineBreak {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
    },
    /// Replace a container's child order (host performs keyed moves).
    Children {
        /// Container key.
        parent: NodeKey,
        /// Complete new child order.
        children: Vec<NodeKey>,
    },
    /// Change text content.
    Text {
        /// Text node.
        key: NodeKey,
        /// New content.
        text: String,
    },
    /// Replace text base fields.
    TextProps {
        /// Text node.
        key: NodeKey,
        /// New fields.
        props: TextProps,
    },
    /// Replace element base fields.
    ElementProps {
        /// Element node.
        key: NodeKey,
        /// New fields.
        props: ElementProps,
    },
    /// Replace user-defined node properties.
    NodeProps {
        /// Node key.
        key: NodeKey,
        /// New properties.
        props: SerializedNode,
    },
    /// Replace NodeState for consumers that request it.
    State {
        /// Node key.
        key: NodeKey,
        /// Exported state fields, or no state.
        state: Option<SerializedNode>,
    },
}
fn own_props(view: StateRef<'_>, key: NodeKey) -> Result<SerializedNode, Error> {
    #[cfg(feature = "foreign-nodes")]
    let mut props = if view.state.foreign_instances.has_hooks() {
        let slot = view.slot(key).ok_or(Error::NodeNotFound(key))?;
        if let Some(payload) = slot
            .data
            .as_any()
            .downcast_ref::<crate::foreign::projection::ForeignPayload>()
        {
            payload.native.to_json()?
        } else {
            slot.data.to_json()?
        }
    } else {
        view.export_json(key)?
    };
    #[cfg(not(feature = "foreign-nodes"))]
    let mut props = view.export_json(key)?;
    let base: &[&str] = match view.kind(key) {
        Some(NodeKind::Text) => &["format", "detail", "mode", "style", "text"],
        Some(NodeKind::Element) => &[
            "children",
            "format",
            "indent",
            "direction",
            "textFormat",
            "style",
            "textStyle",
        ],
        _ => &[],
    };
    for field in base.iter().copied().chain(["type", "version", "$"]) {
        props.remove(field);
    }
    Ok(props)
}
fn state_props(view: StateRef<'_>, key: NodeKey) -> Result<Option<SerializedNode>, Error> {
    #[cfg(feature = "foreign-nodes")]
    if view.state.foreign_instances.has_hooks() {
        return Ok(None);
    }
    let slot = view.slot(key).ok_or(Error::NodeNotFound(key))?;
    Ok(slot.state.as_ref().map(|state| {
        let mut json = SerializedNode::new();
        state.export(
            &view.state.registry.registered(slot.type_index).state_layout,
            &mut json,
        );
        json
    }))
}
#[derive(Default)]
struct ChildPositions {
    parents: IndexSet<NodeKey>,
    indices: HashMap<(NodeKey, NodeKey), u32>,
    #[cfg(test)]
    scanned_children: usize,
}

impl ChildPositions {
    fn index(&mut self, view: StateRef<'_>, parent: NodeKey, key: NodeKey) -> u32 {
        let Some(element) = view.element(parent) else {
            return u32::MAX;
        };
        if element.first == Some(key) {
            return 0;
        }
        if element.last == Some(key) {
            return element.size.checked_sub(1).unwrap_or(u32::MAX);
        }
        // A diff reads an immutable state. Reuse this parent's ranks across
        // created-node and child-list ordering instead of walking its siblings
        // for each descendant. Boundary-only sorts leave the rank tables unallocated.
        if self.parents.insert(parent) {
            self.indices
                .reserve(usize::try_from(element.size).unwrap_or(0));
            for (index, child) in view.children(parent).enumerate() {
                #[cfg(test)]
                {
                    self.scanned_children += 1;
                }
                if let Ok(index) = u32::try_from(index) {
                    self.indices.entry((parent, child)).or_insert(index);
                }
            }
        }
        self.indices
            .get(&(parent, key))
            .copied()
            .unwrap_or(u32::MAX)
    }
}

fn preorder_sort(
    view: StateRef<'_>,
    keys: impl IntoIterator<Item = NodeKey>,
    positions: &mut ChildPositions,
) -> Vec<NodeKey> {
    #[cfg(test)]
    if test::legacy_order_enabled() {
        return test::legacy_order_for_diff(view, keys);
    }
    let mut keys = keys.into_iter();
    let Some(first) = keys.next() else {
        return Vec::new();
    };
    let Some(second) = keys.next() else {
        return vec![first];
    };
    let mut nodes = std::iter::once(first)
        .chain(std::iter::once(second))
        .chain(keys)
        .map(|key| {
            let mut path = vec![];
            let mut current = key;
            while let Some(parent) = view.parent(current) {
                path.push(positions.index(view, parent, current));
                current = parent;
            }
            path.reverse();
            (path, key)
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|(a, ka), (b, kb)| a.cmp(b).then(ka.cmp(kb)));
    let ordered: Vec<_> = nodes.into_iter().map(|(_, key)| key).collect();
    #[cfg(test)]
    assert_eq!(
        ordered,
        test::legacy_preorder_sort(view, ordered.iter().copied())
    );
    ordered
}
impl Commit {
    /// Build a patch across preceding, main and follow-up commits.
    /// s2: LST-01, LST-09
    pub fn diff(&self, options: &DiffOptions) -> Result<Diff, Error> {
        let last = self.chain().last().unwrap_or(self);
        let mut diff = Diff {
            generation: last.next.max_key().generation(),
            full_reconcile: self.chain().any(|c| c.full_reconcile),
            view_text_matches: None,
            ops: vec![],
            decorator_renders: vec![],
        };
        self.visit_diff(options, |op| diff.ops.push(op))?;
        diff.decorator_renders = collect_decorator_renders(
            self.chain().next().unwrap_or(self).prev.view(),
            last.next.view(),
            diff.full_reconcile,
            self.chain().flat_map(|commit| {
                commit
                    .changes
                    .dirty_leaves
                    .iter()
                    .chain(commit.changes.dirty_elements.keys())
                    .copied()
            }),
            &diff.ops,
        )?;
        Ok(diff)
    }
    pub(crate) fn visit_diff(
        &self,
        options: &DiffOptions,
        emit: impl FnMut(DiffOp),
    ) -> Result<(), Error> {
        let first = self.chain().next().unwrap_or(self);
        let last = self.chain().last().unwrap_or(self);
        let prev = first.prev.view();
        let next = last.next.view();
        let full = self.chain().any(|c| c.full_reconcile);
        if full {
            visit_transition_diff(prev, next, true, std::iter::empty(), options, emit)
        } else {
            visit_transition_diff(
                prev,
                next,
                false,
                self.chain().flat_map(|commit| {
                    commit
                        .changes
                        .dirty_leaves
                        .iter()
                        .chain(commit.changes.dirty_elements.keys())
                        .copied()
                }),
                options,
                emit,
            )
        }
    }
}

/// Collect pure native policies without advancing a consuming-view observation.
pub(crate) fn collect_decorator_renders(
    prev: StateRef<'_>,
    next: StateRef<'_>,
    full: bool,
    dirty: impl Iterator<Item = NodeKey>,
    ops: &[DiffOp],
) -> Result<Vec<DecoratorRenderChange>, Error> {
    let mut keys = IndexSet::default();
    if full {
        keys.extend(next.state.nodes.keys().copied());
    } else {
        keys.extend(dirty);
    }
    keys.extend(ops.iter().filter_map(|op| match op {
        DiffOp::Remove { key, .. } => Some(*key),
        _ => None,
    }));
    let mut renders = vec![];
    for key in keys {
        if next.contains(key)
            && let Some(policy) = next.decorator_render_policy(key)?
        {
            renders.push(DecoratorRenderChange {
                key,
                policy: Some(policy),
            });
        } else if !next.contains(key) && prev.kind(key) == Some(NodeKind::Decorator) {
            renders.push(DecoratorRenderChange { key, policy: None });
        }
    }
    Ok(renders)
}

pub(crate) fn visit_transition_diff(
    prev: StateRef<'_>,
    next: StateRef<'_>,
    full: bool,
    dirty: impl Iterator<Item = NodeKey>,
    options: &DiffOptions,
    mut emit: impl FnMut(DiffOp),
) -> Result<(), Error> {
    let mut prev_positions = ChildPositions::default();
    let mut next_positions = ChildPositions::default();
    let mut changed = IndexSet::default();
    if full {
        let mut keys = prev
            .state
            .nodes
            .keys()
            .chain(next.state.nodes.keys())
            .copied()
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        for key in keys {
            if match (prev.state.nodes.get(&key), next.state.nodes.get(&key)) {
                (Some(a), Some(b)) => !Arc::ptr_eq(a, b),
                _ => true,
            } {
                changed.insert(key);
            }
        }
    } else {
        changed.extend(dirty);
    }
    // Dirty detached subtree roots are enough for GC; descendants stay clean.
    // A view must still forget every removed descendant, without changing the
    // upstream mutation-listener dirty-set contract.
    for key in changed.iter().copied().collect::<Vec<_>>() {
        if prev.is_element(key) && !next.contains(key) {
            changed.extend(prev.descendants(key).map(|(key, _)| key));
        }
    }
    let removed: IndexSet<_> = changed
        .iter()
        .copied()
        .filter(|key| prev.contains(*key) && !next.contains(*key))
        .collect();
    for key in preorder_sort(prev, removed.iter().copied(), &mut prev_positions) {
        emit(DiffOp::Remove {
            key,
            subtree_root: prev
                .parent(key)
                .is_none_or(|parent| !removed.contains(&parent)),
        });
    }
    let created = preorder_sort(
        next,
        changed
            .iter()
            .copied()
            .filter(|key| !prev.contains(*key) && next.contains(*key)),
        &mut next_positions,
    );
    for key in &created {
        let key = *key;
        let type_index = next.type_index(key).ok_or(Error::NodeNotFound(key))?;
        let props = own_props(next, key)?;
        emit(match next.kind(key).ok_or(Error::NodeNotFound(key))? {
            NodeKind::Element => DiffOp::CreateElement {
                key,
                type_index,
                base: element_props(next, key)?,
                props,
            },
            NodeKind::Text => DiffOp::CreateText {
                key,
                type_index,
                text: next.text_data(key)?.text.as_str().to_owned(),
                base: next.text_data(key)?.into(),
                props,
            },
            NodeKind::Decorator => DiffOp::CreateDecorator {
                key,
                type_index,
                props,
            },
            NodeKind::LineBreak => DiffOp::CreateLineBreak { key, type_index },
        });
    }
    let mut parents = IndexSet::default();
    for key in &changed {
        // Element property writes and ancestor dirty marks do not change
        // child order. Moved/reordered children below add both parents even
        // when first/last/size happen to remain equal.
        let a = prev.slot(*key);
        let b = next.slot(*key);
        if next.is_element(*key)
            && match (a.map(|s| &s.base), b.map(|s| &s.base)) {
                (Some(BaseData::Element(a)), Some(BaseData::Element(b))) => {
                    a.first != b.first || a.last != b.last || a.size != b.size
                }
                _ => true,
            }
        {
            parents.insert(*key);
        }
        let links_changed = match (a, b) {
            (Some(a), Some(b)) => {
                a.links.parent != b.links.parent
                    || a.links.prev != b.links.prev
                    || a.links.next != b.links.next
            }
            _ => true,
        };
        if !links_changed {
            continue;
        }
        if let Some(parent) = prev.parent(*key)
            && next.is_element(parent)
        {
            parents.insert(parent);
        }
        if let Some(parent) = next.parent(*key) {
            parents.insert(parent);
        }
    }
    for parent in preorder_sort(next, parents, &mut next_positions) {
        let children = next.children_keys(parent)?;
        if !prev.contains(parent) || prev.children_keys(parent)? != children {
            emit(DiffOp::Children { parent, children });
        }
    }
    for key in changed {
        let (Some(a), Some(b)) = (prev.slot(key), next.slot(key)) else {
            continue;
        };
        if Arc::ptr_eq(&a.data, &b.data) && std::ptr::eq(a, b) {
            continue;
        }
        if let (BaseData::Text(a), BaseData::Text(b)) = (&a.base, &b.base) {
            if a.text != b.text {
                emit(DiffOp::Text {
                    key,
                    text: b.text.as_str().to_owned(),
                });
            }
            if TextProps::from(a) != TextProps::from(b) {
                emit(DiffOp::TextProps {
                    key,
                    props: b.into(),
                });
            }
        }
        if matches!(
            (&a.base, &b.base),
            (BaseData::Element(_), BaseData::Element(_))
        ) {
            let props = element_props(next, key)?;
            if element_props(prev, key)? != props {
                emit(DiffOp::ElementProps { key, props });
            }
        }
        if !a.data.dyn_eq(b.data.as_ref()) {
            emit(DiffOp::NodeProps {
                key,
                props: own_props(next, key)?,
            });
        }
        #[cfg(feature = "foreign-nodes")]
        let include_state = options.include_state && !next.state.foreign_instances.has_hooks();
        #[cfg(not(feature = "foreign-nodes"))]
        let include_state = options.include_state;
        if include_state && !NodeState::equivalent(a.state.as_deref(), b.state.as_deref()) {
            emit(DiffOp::State {
                key,
                state: state_props(next, key)?,
            });
        }
    }
    if options.include_state {
        for key in created {
            if let Some(state) = state_props(next, key)? {
                emit(DiffOp::State {
                    key,
                    state: Some(state),
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
