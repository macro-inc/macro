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
    /// Reconstruct a boundary index. Resolve it with `Registry::node` before use.
    pub fn from_raw(value: u16) -> Self {
        Self(value)
    }
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
    /// Runtime node definition; absent for statically registered Rust nodes.
    #[cfg(feature = "foreign-nodes")]
    pub foreign: Option<Arc<ForeignNodeType>>,
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
    #[cfg(feature = "foreign-nodes")]
    pub(crate) native_overlays:
        HashMap<NodeTypeIndex, crate::foreign::native_overlay::NativeOverlay>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_states: crate::foreign::state::ForeignStateRegistry,
    pub(crate) opaque_unknown_types: bool,
    pub(crate) table_selection_hooks: Option<Arc<dyn TableSelectionHooks>>,
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
/// Transform shared across registered node types.
pub type AnyTransformFn = fn(&mut Transaction<'_>, NodeKey) -> Result<(), Error>;
/// Types covered by a shared transform.
#[derive(Clone, Copy, Debug)]
pub enum TransformScope {
    /// All registered types.
    All,
    /// All types except root.
    AllExceptRoot,
    /// Named types and their direct replacements.
    Types(&'static [&'static str]),
}
pub(crate) trait ErasedTransform: Send + Sync {
    fn run(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error>;
}
struct TypedTransform<Node: NodeType>(TransformFn<Node>);
impl<Node: NodeType> ErasedTransform for TypedTransform<Node> {
    fn run(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
        (self.0)(tx, Id::new_unchecked(key))
    }
}
#[derive(Clone)]
pub(crate) enum RegisteredTransform {
    Plain(AnyTransformFn),
    Typed(Arc<dyn ErasedTransform>),
}
impl RegisteredTransform {
    pub(crate) fn run(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
        match self {
            Self::Plain(f) => f(tx, key),
            Self::Typed(f) => f.run(tx, key),
        }
    }
}
enum TransformTarget {
    Type(TypeId, &'static str),
    Scope(TransformScope),
}
type TransformRegistrations = Vec<(TransformTarget, RegisteredTransform)>;
/// Configuration builder; the six built-in types are always registered first.
pub struct EditorBuilder {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) native_overlays: Vec<(String, Arc<dyn ForeignHooks>)>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_states: Vec<ForeignStateConfig>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_instance_hooks: Option<Arc<dyn ForeignInstanceHooks>>,
    opaque_unknown_types: bool,
    pub(crate) extensions: crate::extension::Extensions,
    pub(crate) duplicate_extension: Option<&'static str>,
    pub(crate) plugins: Vec<Arc<dyn Plugin>>,
    pub(crate) initial_state: Option<SerializedEditorState>,
    table_selection_hooks: Option<Arc<dyn TableSelectionHooks>>,
    vtables: Vec<NodeVTable>,
    mode: EditorMode,
    keys: KeySource,
    view_host: ViewHost,
    replacements: Vec<(TypeId, TypeId, Box<dyn Replacement>)>,
    projections: HashMap<(TypeId, TypeId), Box<dyn Any + Send + Sync>>,
    transforms: TransformRegistrations,
    include_static_transforms: bool,
}
impl EditorBuilder {
    /// Build with an explicit headless or view-attached mode.
    pub fn new(mode: EditorMode) -> Self {
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_states: vec![],
            #[cfg(feature = "foreign-nodes")]
            native_overlays: vec![],
            #[cfg(feature = "foreign-nodes")]
            foreign_instance_hooks: None,
            opaque_unknown_types: false,
            extensions: Default::default(),
            duplicate_extension: None,
            plugins: vec![],
            initial_state: None,
            table_selection_hooks: None,
            vtables: vec![],
            mode,
            keys: KeySource::PerEditor,
            view_host: ViewHost::HEADLESS,
            replacements: vec![],
            projections: HashMap::default(),
            transforms: vec![],
            include_static_transforms: true,
        }
        .node::<Root>()
        .node::<Text>()
        .node::<LineBreak>()
        .node::<Tab>()
        .node::<Paragraph>()
        .node::<Artificial>()
    }
    /// Supply table geometry and editing behavior.
    pub fn table_selection_hooks(mut self, hooks: impl TableSelectionHooks) -> Self {
        self.table_selection_hooks = Some(Arc::new(hooks));
        self
    }
    /// Register a runtime node type in builder order.
    #[cfg(feature = "foreign-nodes")]
    pub fn foreign_node(mut self, node: ForeignNodeType) -> Self {
        self.vtables.push(crate::foreign::dispatch::vtable(node));
        self
    }
    /// Register a node type in builder order.
    pub fn node<Node: NodeType>(mut self) -> Self {
        self.vtables.push(Node::Kind::vtable());
        self
    }
    /// Leave class static transforms to an external runtime while retaining
    /// explicit registrations and the engine's core text normalization.
    pub fn without_static_transforms(mut self) -> Self {
        self.include_static_transforms = false;
        self
    }
    /// Run a typed transform for this type and its direct replacement.
    pub fn transform<Node: NodeType>(mut self, transform: TransformFn<Node>) -> Self {
        self.transforms.push((
            TransformTarget::Type(TypeId::of::<Node>(), Node::TYPE),
            RegisteredTransform::Typed(Arc::new(TypedTransform(transform))),
        ));
        self
    }
    /// Run one transform across a scope resolved after all registrations.
    pub fn transform_each(mut self, transform: AnyTransformFn, scope: TransformScope) -> Self {
        self.transforms.push((
            TransformTarget::Scope(scope),
            RegisteredTransform::Plain(transform),
        ));
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
    /// Preserve unregistered serialized node types for collaborative sessions.
    /// Disabled by default; strict server/editor imports retain upstream errors.
    pub fn opaque_unknown_types(mut self, enabled: bool) -> Self {
        self.opaque_unknown_types = enabled;
        self
    }
    /// Validate registrations and build the configured editor.
    pub fn build(mut self) -> Result<Editor, BuildError> {
        if self.opaque_unknown_types {
            self = self
                .node::<crate::opaque::OpaqueElement>()
                .node::<crate::opaque::OpaqueText>()
                .node::<crate::opaque::OpaqueDecorator>();
        }
        if let Some(type_name) = self.duplicate_extension {
            return Err(BuildError::DuplicateExtensionState { type_name });
        }
        let mut plugin_names = std::collections::HashSet::new();
        for plugin in &self.plugins {
            if !plugin_names.insert(plugin.name()) {
                return Err(BuildError::DuplicatePlugin {
                    name: plugin.name(),
                });
            }
        }
        if !self.include_static_transforms {
            for vtable in &mut self.vtables {
                vtable.transforms.clear();
            }
        }
        let mut registry = Registry {
            #[cfg(feature = "foreign-nodes")]
            native_overlays: Default::default(),
            #[cfg(feature = "foreign-nodes")]
            foreign_states: Default::default(),
            opaque_unknown_types: self.opaque_unknown_types,
            table_selection_hooks: self.table_selection_hooks,
            nodes: vec![],
            vtables: self.vtables,
            by_name: HashMap::default(),
            by_type: HashMap::default(),
            table: vec![],
            replacements: HashMap::default(),
            projections: self.projections,
        };
        #[cfg(feature = "foreign-nodes")]
        for config in self.foreign_states {
            registry
                .foreign_states
                .register(config)
                .map_err(|key| BuildError::StateKeyCollision { key })?;
        }
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
            #[cfg(feature = "foreign-nodes")]
            let is_foreign = v.foreign.is_some();
            #[cfg(not(feature = "foreign-nodes"))]
            let is_foreign = false;
            if !is_foreign {
                registry.by_type.insert(v.type_id, index);
            }
            registry.nodes.push(RegisteredNode {
                index,
                #[cfg(feature = "foreign-nodes")]
                foreign: v.foreign.clone(),
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
        #[cfg(feature = "foreign-nodes")]
        crate::foreign::registry::resolve_parents(&mut registry)?;
        #[cfg(feature = "foreign-nodes")]
        crate::foreign::native_overlay::install(&mut registry, self.native_overlays)?;
        #[cfg(feature = "foreign-nodes")]
        crate::foreign::state::validate_declarations(&registry)?;
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
        let mut registrations: Vec<(Vec<NodeTypeIndex>, RegisteredTransform)> = vec![];
        for (target, transform) in self.transforms {
            let indices = match target {
                TransformTarget::Type(id, name) => vec![
                    *registry
                        .by_type
                        .get(&id)
                        .ok_or(BuildError::TransformForUnregisteredType { type_name: name })?,
                ],
                TransformTarget::Scope(TransformScope::Types(names)) => names
                    .iter()
                    .map(|name| {
                        registry
                            .get(name)
                            .map(|node| node.index)
                            .ok_or(BuildError::TransformForUnregisteredType { type_name: name })
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                TransformTarget::Scope(scope) => registry
                    .types()
                    .filter(|node| matches!(scope, TransformScope::All) || node.type_name != "root")
                    .map(|node| node.index)
                    .collect(),
            };
            registrations.push((indices, transform));
        }
        for i in 0..registry.nodes.len() {
            let index = registry.nodes[i].index;
            // Exact registrations precede registrations inherited from a direct replacement.
            for (indices, transform) in &registrations {
                if indices.contains(&index) {
                    registry.vtables[i].transforms.push(transform.clone());
                }
            }
            for (indices, transform) in &registrations {
                if !indices.contains(&index)
                    && indices
                        .iter()
                        .any(|original| registry.registered(*original).replaced_by == Some(index))
                {
                    registry.vtables[i].transforms.push(transform.clone());
                }
            }
        }
        #[cfg(feature = "foreign-nodes")]
        for (index, overlay) in &mut registry.native_overlays {
            overlay.baseline.transforms = registry.vtables[usize::from(index.get())]
                .transforms
                .clone();
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
                        #[cfg(feature = "foreign-nodes")]
                        foreign_identity: Default::default(),
                        #[cfg(feature = "foreign-nodes")]
                        foreign_instance: Default::default(),
                        #[cfg(feature = "foreign-nodes")]
                        foreign_instance_write: None,
                        #[cfg(feature = "foreign-nodes")]
                        foreign_root_cache: None,
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
        let mut editor = Editor::new(registry, self.mode, self.keys, self.view_host)
            .map_err(|e| BuildError::InitialState(Box::new(e)))?;
        #[cfg(feature = "foreign-nodes")]
        if let Some(hooks) = self.foreign_instance_hooks {
            editor
                .install_foreign_instance_hooks(hooks)
                .map_err(|error| BuildError::InitialState(Box::new(error)))?;
        }
        editor.extensions = self.extensions;
        (editor.listeners, editor.listener_table) = crate::plugin::listeners(&self.plugins);
        editor.plugins = self.plugins;
        if let Some(json) = self.initial_state {
            let prev = editor.state.clone();
            let parsed = editor
                .parse_editor_state(&json)
                .map_err(|e| BuildError::InitialState(Box::new(e)))?;
            editor.state = parsed.clone();
            let mut tx = editor.transaction();
            tx.request_full_reconcile();
            let mut initial = tx
                .commit()
                .map_err(|e| BuildError::InitialState(Box::new(e)))?;
            initial.prev = prev;
            initial
                .changes
                .dirty_elements
                .insert(NodeKey::ROOT, DirtyIntent::Intentional);
            initial.changes.mutations = std::iter::once(NodeKey::ROOT)
                .chain(parsed.view().descendants(NodeKey::ROOT).map(|(k, _)| k))
                .map(|k| (k, Mutation::Created))
                .collect();
            let mut initial = editor.run_after_commit(initial);
            if let Some(failure) = initial.follow_up_error {
                return Err(BuildError::InitialState(Box::new(
                    Error::InitialFollowUpFailed(failure.error),
                )));
            }
            editor.initial_commits = std::mem::take(&mut initial.following);
            if let Some(first) = editor.initial_commits.first() {
                let mut chain = first.clone();
                chain
                    .following
                    .extend(editor.initial_commits.iter().skip(1).cloned());
                editor.initial_diff = Some(
                    chain
                        .diff(&DiffOptions {
                            include_state: true,
                        })
                        .map_err(|error| BuildError::InitialState(Box::new(error)))?,
                );
            }
        }
        Ok(editor)
    }
}
