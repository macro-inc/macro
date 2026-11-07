//! Immutable registered node metadata and editor configuration.
use crate::collections::HashMap;
use crate::node::AnyNodeData;
use crate::*;
use std::{
    any::{Any, TypeId},
    sync::Arc,
};
/// Dense index into a registry, in registration order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct NodeTypeIndex(pub(crate) u16);
impl NodeTypeIndex {
    /// Numeric index for boundary encoding.
    pub fn get(self) -> u16 {
        self.0
    }
}
/// Type-level view behavior; inapplicable fields are false.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct TypeFlags {
    /// The `is_inline` predicate.
    pub is_inline: bool,
    /// The `can_insert_text_before` predicate.
    pub can_insert_text_before: bool,
    /// The `can_insert_text_after` predicate.
    pub can_insert_text_after: bool,
    /// The `is_keyboard_selectable` predicate.
    pub is_keyboard_selectable: bool,
    /// The `is_isolated` predicate.
    pub is_isolated: bool,
    /// The `is_shadow_root` predicate.
    pub is_shadow_root: bool,
}
/// One entry of the type table sent to a view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TypeTableRow {
    /// Dense registry index.
    pub index: NodeTypeIndex,
    /// Serialized node name.
    pub type_name: &'static str,
    /// Framework kind.
    pub kind: NodeKind,
    /// None when flags depend on instance state.
    pub flags: Option<TypeFlags>,
}
/// Public metadata of a registered node type.
pub struct RegisteredNode {
    /// Dense registry index.
    pub index: NodeTypeIndex,
    /// Serialized name.
    pub type_name: &'static str,
    /// Upstream class name.
    pub class_name: &'static str,
    /// Framework kind.
    pub kind: NodeKind,
    /// Self followed by non-marker ancestors.
    pub ancestry: Vec<TypeId>,
    /// Direct registered replacement.
    pub replaced_by: Option<NodeTypeIndex>,
    /// Inherited state declarations.
    pub state_layout: StateLayout,
    /// Inherited language capability.
    pub has_language_field: bool,
    /// Static flags, or None for per-instance predicates.
    pub flags: Option<TypeFlags>,
}
type Projection<Interface> =
    Box<dyn for<'a> Fn(&'a dyn Any) -> Option<&'a Interface> + Send + Sync>;
pub(crate) trait Replacement: Send + Sync {
    fn replace(&self, value: &dyn Any) -> Result<Arc<dyn AnyNodeData>, Error>;
}
struct TypedReplacement<Original, ReplacementNode>(fn(Original) -> ReplacementNode);
impl<Original: NodeType, ReplacementNode: NodeType> Replacement
    for TypedReplacement<Original, ReplacementNode>
{
    fn replace(&self, value: &dyn Any) -> Result<Arc<dyn AnyNodeData>, Error> {
        Ok(Arc::new((self.0)(
            value
                .downcast_ref::<Original>()
                .ok_or(Error::Invariant("replacement type mismatch"))?
                .clone(),
        )))
    }
}
/// Registry shared by all snapshots from one editor.
/// s2: CFG-05, CFG-07
pub struct Registry {
    pub(crate) nodes: Vec<RegisteredNode>,
    pub(crate) vtables: Vec<NodeVTable>,
    by_name: HashMap<&'static str, NodeTypeIndex>,
    by_type: HashMap<TypeId, NodeTypeIndex>,
    table: Vec<TypeTableRow>,
    pub(crate) replacements: HashMap<NodeTypeIndex, Box<dyn Replacement>>,
    projections: HashMap<(TypeId, TypeId), Box<dyn Any + Send + Sync>>,
}
impl Registry {
    /// Find a type by its serialized name.
    pub fn get(&self, name: &str) -> Option<&RegisteredNode> {
        self.by_name.get(name).map(|index| self.registered(*index))
    }
    /// Find a type or report an unregistered name.
    pub fn get_or_err(&self, name: &str) -> Result<&RegisteredNode, Error> {
        self.get(name)
            .ok_or_else(|| Error::UnregisteredNodeType(name.to_owned()))
    }
    /// Whether a Rust type is registered.
    pub fn has<Node: NodeType>(&self) -> bool {
        self.index_of::<Node>().is_some()
    }
    /// Registry index of an exact Rust type.
    pub fn index_of<Node: NodeType>(&self) -> Option<NodeTypeIndex> {
        self.by_type.get(&TypeId::of::<Node>()).copied()
    }
    /// Metadata at an index, or None if the index is outside this registry.
    pub fn node(&self, index: NodeTypeIndex) -> Option<&RegisteredNode> {
        self.nodes.get(usize::from(index.0))
    }
    pub(crate) fn registered(&self, index: NodeTypeIndex) -> &RegisteredNode {
        &self.nodes[usize::from(index.0)]
    }
    /// Types in registration order.
    pub fn types(&self) -> impl ExactSizeIterator<Item = &RegisteredNode> {
        self.nodes.iter()
    }
    /// View type table computed at build time.
    pub fn type_table(&self) -> &[TypeTableRow] {
        &self.table
    }
    /// Follow the replacement chain to its final type.
    pub fn resolve_replacements(&self, mut index: NodeTypeIndex) -> Option<NodeTypeIndex> {
        while let Some(next) = self.node(index)?.replaced_by {
            index = next;
        }
        Some(index)
    }
    pub(crate) fn vtable(&self, index: NodeTypeIndex) -> &NodeVTable {
        &self.vtables[usize::from(index.0)]
    }
    pub(crate) fn project_dyn<'a, Interface: ?Sized + 'static>(
        &self,
        index: NodeTypeIndex,
        data: &'a dyn Any,
    ) -> Option<&'a Interface> {
        for ancestor in &self.registered(index).ancestry {
            if let Some(erased) = self
                .projections
                .get(&(*ancestor, TypeId::of::<Interface>()))
            {
                let project = erased.downcast_ref::<Projection<Interface>>()?;
                return project((self.vtable(index).project)(data, *ancestor)?);
            }
        }
        None
    }
}
type TransformRegistrations = Vec<(
    TypeId,
    &'static str,
    fn(&mut Transaction<'_>, NodeKey) -> Result<(), Error>,
)>;
/// Configuration builder; the six built-in types are always registered first.
pub struct EditorBuilder {
    vtables: Vec<NodeVTable>,
    mode: EditorMode,
    keys: KeySource,
    view_host: ViewHost,
    replacements: Vec<(TypeId, TypeId, Box<dyn Replacement>)>,
    projections: HashMap<(TypeId, TypeId), Box<dyn Any + Send + Sync>>,
    transforms: TransformRegistrations,
}
impl EditorBuilder {
    /// Build with an explicit headless or view-attached mode.
    pub fn new(mode: EditorMode) -> Self {
        Self {
            vtables: vec![],
            mode,
            keys: KeySource::PerEditor,
            view_host: ViewHost::HEADLESS,
            replacements: vec![],
            projections: HashMap::default(),
            transforms: vec![],
        }
        .node::<Root>()
        .node::<Text>()
        .node::<LineBreak>()
        .node::<Tab>()
        .node::<Paragraph>()
        .node::<Artificial>()
    }
    /// Register a node type in builder order.
    pub fn node<Node: NodeType>(mut self) -> Self {
        self.vtables.push(Node::Kind::vtable());
        self
    }
    /// Register a subtype replacement and its conversion.
    /// s2: ID-08, ID-09
    pub fn replace<Original: NodeType, ReplacementNode: NodeType>(
        mut self,
        with: fn(Original) -> ReplacementNode,
    ) -> Self {
        if !self
            .vtables
            .iter()
            .any(|v| v.type_id == TypeId::of::<ReplacementNode>())
        {
            self.vtables.push(ReplacementNode::Kind::vtable());
        }
        self.replacements.push((
            TypeId::of::<Original>(),
            TypeId::of::<ReplacementNode>(),
            Box::new(TypedReplacement(with)),
        ));
        self
    }
    /// Register a typed package-level trait projection.
    pub fn node_trait<Node: NodeType, Interface: ?Sized + 'static>(
        mut self,
        project: fn(&Node) -> &Interface,
    ) -> Self {
        let erased: Projection<Interface> =
            Box::new(move |data| data.downcast_ref::<Node>().map(project));
        self.projections.insert(
            (TypeId::of::<Node>(), TypeId::of::<Interface>()),
            Box::new(erased),
        );
        self
    }
    /// Select shared or independent key numbering.
    pub fn key_source(mut self, source: KeySource) -> Self {
        self.keys = source;
        self
    }
    /// Configure the view host without changing it during updates.
    pub fn view_host(mut self, host: ViewHost) -> Self {
        self.view_host = host;
        self
    }
    /// Validate registrations and compute type-level flags in isolated scratch states.
    /// s2: CFG-08
    pub fn build(self) -> Result<Editor, BuildError> {
        let mut registry = Registry {
            nodes: vec![],
            vtables: self.vtables,
            by_name: HashMap::default(),
            by_type: HashMap::default(),
            table: vec![],
            replacements: HashMap::default(),
            projections: self.projections,
        };
        for (position, v) in registry.vtables.iter().enumerate() {
            if v.marker {
                return Err(BuildError::BaseMarkerRegistered {
                    class_name: v.class_name,
                });
            }
            if let Some(first) = registry.by_name.get(v.type_name) {
                return Err(BuildError::DuplicateNodeType {
                    type_name: v.type_name,
                    first: registry.registered(*first).class_name,
                    second: v.class_name,
                });
            }
            let index =
                NodeTypeIndex(u16::try_from(position).map_err(|_| BuildError::TooManyNodeTypes)?);
            for entry in &v.required {
                if v.required.iter().any(|other| {
                    other.key.name() == entry.key.name()
                        && (other.key.identity() != entry.key.identity()
                            || other.flat != entry.flat)
                }) {
                    return Err(BuildError::StateKeyCollision {
                        key: entry.key.name(),
                    });
                }
            }
            registry.by_name.insert(v.type_name, index);
            registry.by_type.insert(v.type_id, index);
            registry.nodes.push(RegisteredNode {
                index,
                type_name: v.type_name,
                class_name: v.class_name,
                kind: v.kind,
                ancestry: v.ancestry.clone(),
                replaced_by: None,
                state_layout: StateLayout {
                    entries: v.required.clone(),
                },
                has_language_field: v.language,
                flags: None,
            });
        }
        for (original, replacement, with) in self.replacements {
            let a = *registry
                .by_type
                .get(&original)
                .ok_or(BuildError::ReplacementNotSubtype {
                    original: "unregistered",
                    replacement: "replacement",
                })?;
            let b =
                *registry
                    .by_type
                    .get(&replacement)
                    .ok_or(BuildError::ReplacementNotSubtype {
                        original: "original",
                        replacement: "unregistered",
                    })?;
            if a == b || !registry.registered(b).ancestry.contains(&original) {
                return Err(BuildError::ReplacementNotSubtype {
                    original: registry.registered(a).type_name,
                    replacement: registry.registered(b).type_name,
                });
            }
            registry.nodes[usize::from(a.0)].replaced_by = Some(b);
            registry.replacements.insert(a, with);
        }
        for (id, name, transform) in self.transforms {
            let index = *registry
                .by_type
                .get(&id)
                .ok_or(BuildError::TransformForUnregisteredType { type_name: name })?;
            registry.vtables[usize::from(index.0)]
                .transforms
                .push(transform);
        }
        let mut registry = Arc::new(registry);
        let mut rows = vec![];
        for node in registry.types() {
            let v = registry.vtable(node.index);
            let flags = if v.per_instance {
                None
            } else {
                let data = (v.probe)().ok_or(BuildError::NoFlagProbe {
                    type_name: node.type_name,
                })?;
                let mut scratch = EditorState::empty(registry.clone())
                    .map_err(|e| BuildError::InitialState(Box::new(e)))?;
                let key = if node.kind == NodeKind::Element && node.type_name == "root" {
                    NodeKey::ROOT
                } else {
                    NodeKey::from_parts(KeyParts {
                        generation: 0,
                        index: 1,
                    })
                };
                let base = (v.initial_base)(data.as_any())
                    .map_err(|e| BuildError::InitialState(Box::new(e)))?;
                scratch.nodes.insert(
                    key,
                    Arc::new(crate::node::NodeSlot {
                        key,
                        type_index: node.index,
                        links: Default::default(),
                        base,
                        state: None,
                        data,
                    }),
                );
                Some(scratch.view().type_flags(key))
            };
            rows.push(TypeTableRow {
                index: node.index,
                type_name: node.type_name,
                kind: node.kind,
                flags,
            });
        }
        let inner = Arc::get_mut(&mut registry).ok_or_else(|| {
            BuildError::InitialState(Box::new(Error::Invariant(
                "scratch registry is still borrowed",
            )))
        })?;
        for row in &rows {
            inner.nodes[usize::from(row.index.0)].flags = row.flags;
        }
        inner.table = rows;
        Editor::new(registry, self.mode, self.keys, self.view_host)
            .map_err(|e| BuildError::InitialState(Box::new(e)))
    }
}
