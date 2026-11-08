//! Borrowed views over committed and pending node maps.
mod api;
mod record;
pub use record::{NodeRecord, NodeRef};
mod selection;
mod structural;
use crate::node::NodeSlot;
use crate::*;
pub use api::Read;
use std::{any::TypeId, borrow::Cow, sync::LazyLock};
pub use structural::CommonAncestor;
/// A read-only view whose returned borrows live as long as the underlying state.
#[derive(Clone, Copy)]
pub struct StateRef<'state> {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) native_projection: Option<&'state crate::foreign::projection::NativeProjection>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) source_records: Option<&'state crate::state::NodeMap>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) retired_records: Option<&'state crate::state::NodeMap>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_origin: Option<crate::foreign::ReadOriginRef<'state>>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) detached_selections: &'state [Option<Selection>],
    pub(crate) state: &'state EditorState,
    pub(crate) previous_selection: Option<&'state Selection>,
    pub(crate) composition_key: Option<NodeKey>,
}
/// A node and its containing state, supplied to virtual predicates.
#[derive(Clone, Copy)]
pub struct NodeView<'state> {
    /// Node identity.
    pub key: NodeKey,
    /// Containing state.
    pub state: StateRef<'state>,
}
/// An element predicate's view.
#[derive(Clone, Copy)]
pub struct ElementView<'state> {
    /// Element identity.
    pub key: NodeKey,
    /// Containing state.
    pub state: StateRef<'state>,
}
/// A text predicate's view.
#[derive(Clone, Copy)]
pub struct TextView<'state> {
    /// Text identity.
    pub key: NodeKey,
    /// Containing state.
    pub state: StateRef<'state>,
}
/// A decorator predicate's view.
pub type DecoratorView<'state> = NodeView<'state>;
/// A line break predicate's view.
pub type LineBreakView<'state> = NodeView<'state>;
impl<'state> ElementView<'state> {
    /// Framework fields; internal dispatch guarantees an element.
    pub fn data(self) -> &'state ElementData {
        static EMPTY: LazyLock<ElementData> = LazyLock::new(ElementData::default);
        self.state.element(self.key).unwrap_or(&EMPTY)
    }
}
impl<'state> TextView<'state> {
    /// Framework fields; internal dispatch guarantees a text node.
    pub fn data(self) -> &'state TextData {
        static EMPTY: LazyLock<TextData> = LazyLock::new(TextData::default);
        self.state.text(self.key).unwrap_or(&EMPTY)
    }
}
impl<'state> StateRef<'state> {
    pub(crate) fn cached_root_text_content(self) -> std::sync::Arc<str> {
        self.state
            .root_text
            .get_or_init(|| std::sync::Arc::from(self.text_content(NodeKey::ROOT).as_ref()))
            .clone()
    }
    pub(crate) fn slot(self, key: NodeKey) -> Option<&'state NodeSlot> {
        self.state.nodes.get(&key).map(AsRef::as_ref)
    }
    /// Root.
    pub fn root(self) -> NodeKey {
        NodeKey::ROOT
    }
    /// Node.
    pub fn node(self, key: impl Into<NodeKey>) -> Option<NodeRef<'state>> {
        self.slot(key.into()).map(|slot| NodeRef {
            slot,
            registry: &self.state.registry,
        })
    }
    /// Get.
    pub fn get<Node: NodeType>(self, key: impl Into<NodeKey>) -> Option<&'state Node> {
        let key = key.into();
        #[cfg(feature = "foreign-nodes")]
        if let Some(frame) = self.native_projection.filter(|frame| frame.key == key) {
            return frame.get::<Node>();
        }
        self.node(key)?.get::<Node>()
    }
    /// Cast.
    pub fn cast<Node: NodeType>(self, key: impl Into<NodeKey>) -> Option<Id<Node>> {
        let key = key.into();
        self.is::<Node>(key).then(|| Id::new_unchecked(key))
    }
    /// Is.
    pub fn is<Node: NodeType>(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        #[cfg(feature = "foreign-nodes")]
        if let Some(slot) = self.slot(key)
            && self
                .state
                .registry
                .registered(slot.type_index)
                .foreign
                .is_some()
        {
            return self
                .state
                .registry
                .registered(slot.type_index)
                .ancestry
                .contains(&TypeId::of::<Node>());
        }
        self.get::<Node>(key).is_some()
    }
    /// Kind.
    pub fn kind(self, key: impl Into<NodeKey>) -> Option<NodeKind> {
        self.slot(key.into()).map(|slot| slot.base.kind())
    }
    /// Type index.
    pub fn type_index(self, key: impl Into<NodeKey>) -> Option<NodeTypeIndex> {
        self.slot(key.into()).map(|slot| slot.type_index)
    }
    /// Element.
    pub fn element(self, key: impl Into<NodeKey>) -> Option<&'state ElementData> {
        match &self.slot(key.into())?.base {
            BaseData::Element(data) => Some(data),
            _ => None,
        }
    }
    /// Text.
    pub fn text(self, key: impl Into<NodeKey>) -> Option<&'state TextData> {
        match &self.slot(key.into())?.base {
            BaseData::Text(data) => Some(data),
            _ => None,
        }
    }
    /// Parent.
    pub fn parent(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.slot(key.into()).and_then(|slot| slot.links.parent)
    }
    /// Prev sibling.
    pub fn prev_sibling(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.slot(key.into()).and_then(|slot| slot.links.prev)
    }
    /// Next sibling.
    pub fn next_sibling(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.slot(key.into()).and_then(|slot| slot.links.next)
    }
    /// First child.
    pub fn first_child(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.element(key).and_then(|data| data.first)
    }
    /// Last child.
    pub fn last_child(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        self.element(key).and_then(|data| data.last)
    }
    /// Parent or err.
    pub fn parent_or_err(self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        let key = key.into();
        self.parent(key).ok_or(Error::NoParent(key))
    }
    /// First child or err.
    pub fn first_child_or_err(self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        let key = key.into();
        self.first_child(key).ok_or(Error::NoChild(key))
    }
    /// Last child or err.
    pub fn last_child_or_err(self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        let key = key.into();
        self.last_child(key).ok_or(Error::NoChild(key))
    }
    /// Children size.
    pub fn children_size(self, key: impl Into<NodeKey>) -> u32 {
        self.element(key).map_or(0, ElementData::children_size)
    }
    /// Is empty.
    pub fn is_empty(self, key: impl Into<NodeKey>) -> bool {
        self.children_size(key) == 0
    }
    /// Children.
    pub fn children(self, key: impl Into<NodeKey>) -> Children<'state> {
        Children {
            view: self,
            next: self.first_child(key),
            reverse: false,
        }
    }
    /// Children keys.
    pub fn children_keys(self, key: impl Into<NodeKey>) -> Result<Vec<NodeKey>, Error> {
        let key = key.into();
        self.element(key).ok_or(Error::NotAnElement(key))?;
        Ok(self.children(key).collect())
    }
    /// Next siblings.
    pub fn next_siblings(self, key: impl Into<NodeKey>) -> Siblings<'state> {
        Children {
            view: self,
            next: self.next_sibling(key),
            reverse: false,
        }
    }
    /// Prev siblings.
    pub fn prev_siblings(self, key: impl Into<NodeKey>) -> std::vec::IntoIter<NodeKey> {
        let mut items: Vec<_> = Children {
            view: self,
            next: self.prev_sibling(key),
            reverse: true,
        }
        .collect();
        items.reverse();
        items.into_iter()
    }
    /// Ancestors.
    pub fn ancestors(self, key: impl Into<NodeKey>) -> Ancestors<'state> {
        Ancestors {
            view: self,
            next: self.parent(key),
        }
    }
    /// Child at index.
    pub fn child_at_index(self, key: impl Into<NodeKey>, index: ChildIndex) -> Option<NodeKey> {
        self.children(key).nth(index.0 as usize)
    }
    /// Index within parent.
    pub fn index_within_parent(self, key: impl Into<NodeKey>) -> Option<ChildIndex> {
        let key = key.into();
        self.children(self.parent(key)?)
            .position(|child| child == key)
            .and_then(|i| u32::try_from(i).ok())
            .map(ChildIndex)
    }
    /// Is last child.
    pub fn is_last_child(self, key: impl Into<NodeKey>) -> Result<bool, Error> {
        let key = key.into();
        Ok(self.last_child(self.parent_or_err(key)?) == Some(key))
    }
    /// Is attached.
    pub fn is_attached(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some()
            && (key == NodeKey::ROOT || self.ancestors(key).any(|key| key == NodeKey::ROOT))
    }
    /// Has ancestor.
    pub fn has_ancestor(self, child: impl Into<NodeKey>, ancestor: impl Into<NodeKey>) -> bool {
        let ancestor = ancestor.into();
        self.ancestors(child).any(|key| key == ancestor)
    }
    /// Is parent of.
    pub fn is_parent_of(self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> bool {
        self.has_ancestor(b, a)
    }
    /// Descendants.
    pub fn descendants(self, key: impl Into<NodeKey>) -> Descendants<'state> {
        Descendants {
            view: self,
            stack: self
                .children(key)
                .map(|key| (key, 1))
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
        }
    }
    /// All text nodes.
    pub fn all_text_nodes(self, key: impl Into<NodeKey>) -> std::vec::IntoIter<NodeKey> {
        self.descendants(key)
            .filter_map(|(key, _)| (self.kind(key) == Some(NodeKind::Text)).then_some(key))
            .collect::<Vec<_>>()
            .into_iter()
    }
    /// First descendant.
    pub fn first_descendant(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        let mut key = self.first_child(key)?;
        while let Some(child) = self.first_child(key) {
            key = child;
        }
        Some(key)
    }
    /// Last descendant.
    pub fn last_descendant(self, key: impl Into<NodeKey>) -> Option<NodeKey> {
        let mut key = self.last_child(key)?;
        while let Some(child) = self.last_child(key) {
            key = child;
        }
        Some(key)
    }
    /// First descendant of the indexed child, or the last descendant past the end.
    pub fn descendant_by_index(
        self,
        key: impl Into<NodeKey>,
        index: ChildIndex,
    ) -> Option<NodeKey> {
        let key = key.into();
        if index.0 >= self.children_size(key) {
            let child = self.last_child(key)?;
            self.last_descendant(child).or(Some(child))
        } else {
            let child = self.child_at_index(key, index)?;
            self.first_descendant(child).or(Some(child))
        }
    }
    /// Post-order within shared ancestry: descendants precede their ancestors.
    pub fn is_before(self, a: impl Into<NodeKey>, b: impl Into<NodeKey>) -> Result<bool, Error> {
        let a = a.into();
        let b = b.into();
        self.slot(a).ok_or(Error::NodeNotFound(a))?;
        self.slot(b).ok_or(Error::NodeNotFound(b))?;
        match self.common_ancestor(a, b) {
            Some(CommonAncestor::Descendant { .. }) => Ok(true),
            Some(CommonAncestor::Branch { ancestor, a, b }) => {
                for child in self.children(ancestor) {
                    if child == a {
                        return Ok(true);
                    }
                    if child == b {
                        return Ok(false);
                    }
                }
                Err(Error::Invariant("common ancestor branch is not a child"))
            }
            _ => Ok(false),
        }
    }
    /// Top level element.
    pub fn top_level_element(self, key: impl Into<NodeKey>) -> Result<Option<NodeKey>, Error> {
        let mut key = key.into();
        let original = key;
        self.slot(key).ok_or(Error::NodeNotFound(key))?;
        while let Some(parent) = self.parent(key) {
            if self.is_root_or_shadow_root(parent) {
                if self.kind(key) == Some(NodeKind::Element)
                    || (key == original && self.kind(key) == Some(NodeKind::Decorator))
                {
                    return Ok(Some(key));
                }
                return Err(Error::RootChildNotBlock);
            }
            key = parent;
        }
        Ok(None)
    }
    /// Top level element or err.
    pub fn top_level_element_or_err(self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        let key = key.into();
        self.top_level_element(key)?.ok_or(if key == NodeKey::ROOT {
            Error::RootNotTopLevel
        } else {
            Error::NoParent(key)
        })
    }
    /// Nearest root or shadow root.
    pub fn nearest_root_or_shadow_root(self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        let key = key.into();
        std::iter::once(key)
            .chain(self.ancestors(key))
            .find(|key| self.is_root_or_shadow_root(*key))
            .ok_or(Error::NoParent(key))
    }
    /// Nodes of type index.
    pub fn nodes_of_type_index(self, index: NodeTypeIndex) -> Vec<NodeKey> {
        let mut keys: Vec<_> = self
            .state
            .nodes
            .iter()
            .filter_map(|(key, slot)| {
                (slot.type_index == index && self.is_attached(*key)).then_some(*key)
            })
            .collect();
        keys.sort();
        keys
    }
    /// Nodes of type.
    pub fn nodes_of_type<Node: NodeType>(self) -> Vec<Id<Node>> {
        self.state
            .registry
            .index_of::<Node>()
            .map_or_else(Vec::new, |i| {
                self.nodes_of_type_index(i)
                    .into_iter()
                    .map(Id::new_unchecked)
                    .collect()
            })
    }
    /// Get dyn.
    pub fn get_dyn<Interface: ?Sized + 'static>(
        self,
        key: impl Into<NodeKey>,
    ) -> Option<&'state Interface> {
        let slot = self.slot(key.into())?;
        self.state
            .registry
            .project_dyn::<Interface>(slot.type_index, slot.data.as_any())
    }
    /// Has language field.
    pub fn has_language_field(self, key: impl Into<NodeKey>) -> bool {
        self.slot(key.into()).is_some_and(|slot| {
            self.state
                .registry
                .registered(slot.type_index)
                .has_language_field
        })
    }
    /// Is parent required.
    pub fn is_parent_required(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .is_parent_required)(slot.data.as_any(), NodeView { key, state: self })
        })
    }
    /// Is inline.
    pub fn is_inline(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).is_inline)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Can be empty.
    pub fn can_be_empty(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_be_empty)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Can insert text before.
    pub fn can_insert_text_before(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .can_insert_text_before)(
                slot.data.as_any(), NodeView { key, state: self }
            )
        })
    }
    /// Can insert text after.
    pub fn can_insert_text_after(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .can_insert_text_after)(
                slot.data.as_any(), NodeView { key, state: self }
            )
        })
    }
    /// Is shadow root.
    pub fn is_shadow_root(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).is_shadow_root)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Can indent.
    pub fn can_indent(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_indent)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Can merge with.
    pub fn can_merge_with(self, key: impl Into<NodeKey>, other: NodeKey) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_merge_with)(
                slot.data.as_any(),
                NodeView { key, state: self },
                other,
            )
        })
    }
    /// Can merge when empty.
    pub fn can_merge_when_empty(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .can_merge_when_empty)(slot.data.as_any(), NodeView { key, state: self })
        })
    }
    /// Can replace with.
    pub fn can_replace_with(self, key: impl Into<NodeKey>, replacement: NodeKey) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_replace_with)(
                slot.data.as_any(),
                NodeView { key, state: self },
                replacement,
            )
        })
    }
    /// Can insert after.
    pub fn can_insert_after(self, key: impl Into<NodeKey>, other: NodeKey) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_insert_after)(
                slot.data.as_any(),
                NodeView { key, state: self },
                other,
            )
        })
    }
    /// Exclude from copy.
    pub fn exclude_from_copy(
        self,
        key: impl Into<NodeKey>,
        destination: Option<CopyDestination>,
    ) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .exclude_from_copy)(
                slot.data.as_any(),
                NodeView { key, state: self },
                destination,
            )
        })
    }
    /// Extract with child.
    pub fn extract_with_child(
        self,
        key: impl Into<NodeKey>,
        child: NodeKey,
        selection: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .extract_with_child)(
                slot.data.as_any(),
                NodeView { key, state: self },
                child,
                selection,
                destination,
            )
        })
    }
    /// Indent.
    pub fn indent(self, key: impl Into<NodeKey>) -> u32 {
        let key = key.into();
        self.slot(key).map_or(0, |slot| {
            (self.state.registry.vtable(slot.type_index).indent)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Can have format.
    pub fn can_have_format(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).can_have_format)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Is text entity.
    pub fn is_text_entity(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).is_text_entity)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Is isolated.
    pub fn is_isolated(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self.state.registry.vtable(slot.type_index).is_isolated)(
                slot.data.as_any(),
                NodeView { key, state: self },
            )
        })
    }
    /// Is keyboard selectable.
    pub fn is_keyboard_selectable(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.slot(key).is_some_and(|slot| {
            (self
                .state
                .registry
                .vtable(slot.type_index)
                .is_keyboard_selectable)(
                slot.data.as_any(), NodeView { key, state: self }
            )
        })
    }
    /// Is root or shadow root.
    pub fn is_root_or_shadow_root(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        key == NodeKey::ROOT || self.is_shadow_root(key)
    }
    /// Is simple text.
    pub fn is_simple_text(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.is::<Text>(key)
            && self.type_index(key) == self.state.registry.index_of::<Text>()
            && self.text(key).is_some_and(|text| {
                text.mode == TextMode::Normal
                    && !text.absent.contains(crate::node::AbsentKeys::MODE)
            })
    }
    /// Is composing.
    pub fn is_composing(self, key: impl Into<NodeKey>) -> bool {
        self.composition_key == Some(key.into())
    }
    /// Is leaf.
    pub fn is_leaf(self, key: impl Into<NodeKey>) -> bool {
        self.kind(key).is_some_and(|kind| kind != NodeKind::Element)
    }
    /// Is block element.
    pub fn is_block_element(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.kind(key) == Some(NodeKind::Element) && !self.is_inline(key)
    }
    /// Is inline element or decorator.
    pub fn is_inline_element_or_decorator(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        matches!(
            self.kind(key),
            Some(NodeKind::Element | NodeKind::Decorator)
        ) && self.is_inline(key)
    }
    /// Is token or tab.
    pub fn is_token_or_tab(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        self.is::<Tab>(key) || self.text(key).is_some_and(TextData::is_token)
    }
    /// Is token or segmented.
    pub fn is_token_or_segmented(self, key: impl Into<NodeKey>) -> bool {
        self.text(key)
            .is_some_and(|text| text.is_token() || text.is_segmented())
    }
    /// Text content.
    /// s2: EL-03
    pub fn text_content(self, key: impl Into<NodeKey>) -> Cow<'state, str> {
        let key = key.into();
        let Some(slot) = self.slot(key) else {
            return Cow::Borrowed("");
        };
        match &slot.base {
            BaseData::Text(data) => Cow::Borrowed(data.text.as_str()),
            BaseData::LineBreak => Cow::Borrowed("\n"),
            BaseData::Decorator => (self.state.registry.vtable(slot.type_index).text_content)(
                slot.data.as_any(),
                NodeView { key, state: self },
            ),
            BaseData::Element(_) => {
                let mut text = String::new();
                for child in self.children(key) {
                    text.push_str(&self.text_content(child));
                    if self.is_block_element(child) && self.next_sibling(child).is_some() {
                        text.push_str("\n\n");
                    }
                }
                Cow::Owned(text)
            }
        }
    }
    /// Text content size.
    pub fn text_content_size(self, key: impl Into<NodeKey>) -> Utf16Offset {
        let key = key.into();
        self.text(key).map_or_else(
            || {
                Utf16Offset(
                    u32::try_from(self.text_content(key).encode_utf16().count())
                        .unwrap_or(u32::MAX),
                )
            },
            |data| data.text.utf16_len(),
        )
    }
    /// Selection.
    pub fn selection(self) -> Option<&'state Selection> {
        self.state.selection.as_ref()
    }
    /// Previous selection.
    pub fn previous_selection(self) -> Option<&'state Selection> {
        self.previous_selection
    }
    /// Get state.
    /// s2: NS-03, NS-04, NS-06
    pub fn get_state<ValueType: StateValue>(
        self,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
    ) -> Result<ValueType, Error> {
        let key = key.into();
        let slot = self.slot(key).ok_or(Error::NodeNotFound(key))?;
        for entry in &self
            .state
            .registry
            .registered(slot.type_index)
            .state_layout
            .entries
        {
            if entry.key.name() == state_key.name()
                && entry.key.identity() != crate::node_state::AnyStateKey::identity(state_key)
            {
                return Err(Error::StateKeyCollision {
                    key: state_key.name(),
                });
            }
        }
        #[cfg(feature = "foreign-nodes")]
        if slot
            .state
            .as_ref()
            .is_some_and(|state| state.foreign.contains(state_key.name()))
        {
            return Err(Error::StateKeyCollision {
                key: state_key.name(),
            });
        }
        state_key.read(slot.state.as_deref())
    }
    /// State change.
    /// s2: NS-07
    pub fn state_change<ValueType: StateValue>(
        self,
        previous: StateRef<'_>,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
    ) -> Result<Option<(ValueType, ValueType)>, Error> {
        let key = key.into();
        let before = previous.get_state(key, state_key)?;
        let after = self.get_state(key, state_key)?;
        Ok((!state_key.is_equal(&before, &after)).then_some((after, before)))
    }
    /// Export json.
    pub fn export_json(self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        let key = key.into();
        let slot = self.slot(key).ok_or(Error::NodeNotFound(key))?;
        let registration = self.state.registry.registered(slot.type_index);
        let v = self.state.registry.vtable(slot.type_index);
        let mut json = SerializedNode::new();
        match &slot.base {
            BaseData::Element(data) => {
                json.insert("children".into(), serde_json::json!([]));
                json.insert("direction".into(), serde_json::to_value(data.direction)?);
                json.insert("format".into(), serde_json::to_value(data.format)?);
                json.insert("indent".into(), serde_json::json!(self.indent(key)));
            }
            BaseData::Text(data) => {
                json.insert("detail".into(), serde_json::json!(data.detail.bits()));
                json.insert("format".into(), serde_json::json!(data.format.bits()));
                json.insert("mode".into(), serde_json::to_value(data.mode)?);
                json.insert("style".into(), serde_json::json!(data.style));
                json.insert("text".into(), serde_json::json!(data.text.as_str()));
            }
            _ => {}
        }
        match &slot.base {
            BaseData::Element(data) => data.absent.omit(&mut json),
            BaseData::Text(data) => data.absent.omit(&mut json),
            _ => {}
        }
        json.insert("type".into(), serde_json::json!(registration.type_name));
        json.insert(
            "version".into(),
            serde_json::json!((v.json_version)(slot.data.as_any())),
        );
        if let Some(state) = &slot.state {
            #[cfg(feature = "foreign-nodes")]
            state.export(
                &self
                    .state
                    .registry
                    .foreign_states
                    .layout(&registration.state_layout),
                &mut json,
            );
            #[cfg(not(feature = "foreign-nodes"))]
            state.export(&registration.state_layout, &mut json);
        }
        if let BaseData::Element(data) = &slot.base
            && !self.is_root_or_shadow_root(key)
            && !self
                .children(key)
                .any(|child| self.kind(child) == Some(NodeKind::Text))
        {
            if !data.text_format.is_empty() {
                json.insert(
                    "textFormat".into(),
                    serde_json::json!(data.text_format.bits()),
                );
            }
            if !data.text_style.is_empty() {
                json.insert("textStyle".into(), serde_json::json!(data.text_style));
            }
        }
        if slot.base.kind() != NodeKind::LineBreak {
            json.extend(slot.data.to_json()?);
        }
        (v.adjust_export_json)(slot.data.as_any(), NodeView { key, state: self }, &mut json)?;
        Ok(json)
    }
    /// Export a text slice through an ephemeral clone and its custom export hooks.
    /// The containing snapshot, node key and all other framework fields remain unchanged.
    pub fn export_text_slice(
        self,
        key: impl Into<NodeKey>,
        text: &str,
    ) -> Result<SerializedNode, Error> {
        let key = key.into();
        if self.text_data(key)?.text.as_str() == text {
            return self.export_json(key);
        }
        let mut record = self.node_or_err(key)?.to_owned();
        let BaseData::Text(data) = &mut record.slot.base else {
            return Err(Error::NodeTypeMismatch(key));
        };
        data.text = TextBuffer::new(text);
        let mut snapshot = self.state.clone();
        snapshot.nodes.insert(key, std::sync::Arc::new(record.slot));
        StateRef {
            #[cfg(feature = "foreign-nodes")]
            native_projection: self.native_projection,
            #[cfg(feature = "foreign-nodes")]
            detached_selections: self.detached_selections,
            #[cfg(feature = "foreign-nodes")]
            source_records: self.source_records,
            #[cfg(feature = "foreign-nodes")]
            retired_records: self.retired_records,
            #[cfg(feature = "foreign-nodes")]
            foreign_origin: self.foreign_origin,
            state: &snapshot,
            previous_selection: self.previous_selection,
            composition_key: self.composition_key,
        }
        .export_json(key)
    }
    /// Export node.
    pub fn export_node(self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        let key = key.into();
        let mut json = self.export_json(key)?;
        if self.kind(key) == Some(NodeKind::Element) {
            let children = self
                .children(key)
                .map(|key| self.export_node(key).map(serde_json::Value::Object))
                .collect::<Result<Vec<_>, _>>()?;
            json.insert("children".into(), serde_json::Value::Array(children));
        }
        Ok(json)
    }
    pub(crate) fn type_flags(self, key: NodeKey) -> TypeFlags {
        TypeFlags {
            is_inline: self.is_inline(key),
            can_insert_text_before: self.can_insert_text_before(key),
            can_insert_text_after: self.can_insert_text_after(key),
            is_isolated: self.is_isolated(key),
            is_keyboard_selectable: self.is_keyboard_selectable(key),
            is_shadow_root: self.is_shadow_root(key),
        }
    }
}
/// Direct children, lazily following sibling links.
pub struct Children<'state> {
    view: StateRef<'state>,
    next: Option<NodeKey>,
    reverse: bool,
}
impl Iterator for Children<'_> {
    type Item = NodeKey;
    fn next(&mut self) -> Option<NodeKey> {
        let key = self.next?;
        self.next = if self.reverse {
            self.view.prev_sibling(key)
        } else {
            self.view.next_sibling(key)
        };
        Some(key)
    }
}
/// Siblings following a node in document order.
pub type Siblings<'state> = Children<'state>;
/// Ancestors from nearest to farthest.
pub struct Ancestors<'state> {
    view: StateRef<'state>,
    next: Option<NodeKey>,
}
impl Iterator for Ancestors<'_> {
    type Item = NodeKey;
    fn next(&mut self) -> Option<NodeKey> {
        let key = self.next?;
        self.next = self.view.parent(key);
        Some(key)
    }
}
/// Pre-order descendants with depth relative to the starting node.
pub struct Descendants<'state> {
    view: StateRef<'state>,
    stack: Vec<(NodeKey, u32)>,
}
impl Iterator for Descendants<'_> {
    type Item = (NodeKey, u32);
    fn next(&mut self) -> Option<Self::Item> {
        let (key, depth) = self.stack.pop()?;
        let children: Vec<_> = self.view.children(key).collect();
        self.stack
            .extend(children.into_iter().rev().map(|key| (key, depth + 1)));
        Some((key, depth))
    }
}
