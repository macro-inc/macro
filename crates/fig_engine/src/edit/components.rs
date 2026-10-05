//! Components and instances: making a component (⌥⌘K), placing instances
//! of one, and detaching an instance (⌥⌘B) into ordinary layers.
//!
//! An instance placed in Macro has no layout Figma derived for it, so the
//! scene draws the component's own layers in it; edits to the component
//! show in its instances.

use super::{Txn, flags};
use crate::document::NodeIdx;
use crate::error::{FigError, Result};
use crate::model::{Affine, NodeType, Props, SymbolData, Vec2};
use crate::scene::{Scene, SceneIdx};
use std::sync::Arc;

impl Txn<'_> {
    /// Makes `ids` a component: one frame becomes a component; other
    /// layers are wrapped in a new one. Returns it.
    pub(super) fn create_component(&mut self, ids: &[NodeIdx]) -> Result<Option<NodeIdx>> {
        let frame = match ids {
            [one] if self.doc.props(*one).node_type() == NodeType::Frame => *one,
            [one] if self.doc.props(*one).node_type() == NodeType::Symbol => return Ok(Some(*one)),
            _ => {
                let parent = ids.first().and_then(|&i| self.doc.node(i).parent);
                let same: Vec<NodeIdx> = ids
                    .iter()
                    .copied()
                    .filter(|&i| self.doc.node(i).parent == parent)
                    .collect();
                let name = match same.as_slice() {
                    [one] => Some(self.doc.props(*one).name().to_owned()),
                    _ => None,
                };
                let Some(g) = self.group(&same, true)? else {
                    return Ok(None);
                };
                let name = name.unwrap_or_else(|| self.next_component_name());
                self.edit(g, flags::NAME).name = Some(name.into());
                g
            }
        };
        self.edit(frame, flags::TYPE).node_type = Some(NodeType::Symbol);
        Ok(Some(frame))
    }

    fn next_component_name(&self) -> String {
        let n = self
            .doc
            .nodes
            .iter()
            .filter(|n| !n.removed && n.props.node_type() == NodeType::Symbol)
            .count();
        format!("Component {}", n + 1)
    }

    /// Places an instance of `component` in `parent` at `index` with the
    /// local transform `transform`.
    pub(super) fn instantiate(
        &mut self,
        component: NodeIdx,
        parent: NodeIdx,
        index: usize,
        transform: Affine,
    ) -> Result<NodeIdx> {
        let main = self.doc.props(component);
        if main.node_type() != NodeType::Symbol {
            return Err(FigError::Unsupported(
                "only components have instances".into(),
            ));
        }
        let symbol_id = main.guid;
        let mut props = main.clone();
        props.guid = Some(self.doc.new_guid());
        props.node_type = Some(NodeType::Instance);
        props.symbol = Some(Arc::new(SymbolData {
            symbol_id,
            ..SymbolData::default()
        }));
        props.transform = Some(transform);
        props.parent = None;
        props.position = None;
        props.override_key = None;
        props.prop_defs = None;
        props.prop_assignments = None;
        props.description = None;
        props.is_state_group = None;
        props.derived = None;
        props.export_settings = None;
        props.prop_refs = None;
        props.variant_specs = None;
        props.variant_orders = None;
        props.key = None;
        // An instance of a variant is named after its component set.
        if let Some(set) = self.doc.node(component).parent
            && self.doc.props(set).is_state_group == Some(true)
        {
            props.name = self.doc.props(set).name.clone();
        }
        let i = self.new_node(props);
        self.attach(i, parent, index, false);
        let guid = self.doc.props(i).guid.unwrap_or_default();
        self.created.push(guid.to_string());
        Ok(i)
    }

    /// Places an instance of `component` with its top left at the page
    /// point `at`, on top of `parent`.
    pub(super) fn place_instance(
        &mut self,
        component: NodeIdx,
        parent: NodeIdx,
        at: Vec2,
    ) -> Result<NodeIdx> {
        let local = self
            .doc
            .world(parent)
            .invert()
            .unwrap_or_default()
            .mul(&Affine::translate(at.x, at.y));
        let index = self.doc.node(parent).children.len();
        self.instantiate(component, parent, index, local)
    }

    /// Detaches an instance: it becomes a frame holding copies of the
    /// layers it showed, with its overrides applied. Nested instances are
    /// detached too.
    pub(super) fn detach_instance(&mut self, instance: NodeIdx) -> Result<()> {
        if self.doc.props(instance).node_type() != NodeType::Instance {
            return Ok(());
        }
        let page = self
            .doc
            .page_of(instance)
            .ok_or_else(|| FigError::Unsupported("the instance is not on a page".into()))?;
        let guid = self.doc.props(instance).guid.unwrap_or_default();
        // What the instance draws, read from the scene, parent first.
        let plan: Vec<(Option<usize>, Props)> = {
            let scene = Scene::build(self.doc, page);
            let Some(root) = scene.find(self.doc, &guid.to_string()) else {
                return Ok(());
            };
            let mut plan = Vec::new();
            collect(&scene, self.doc, root, None, &mut plan);
            plan
        };
        let p = self.edit(instance, flags::TYPE | flags::INSTANCE_OF);
        p.symbol = None;
        p.derived = None;
        p.swapped_symbol = None;
        p.prop_assignments = None;
        p.node_type = Some(NodeType::Frame);
        let mut made: Vec<NodeIdx> = Vec::with_capacity(plan.len());
        for (parent, mut props) in plan {
            let parent = parent.map_or(instance, |k| made[k]);
            props.guid = Some(self.doc.new_guid());
            plain(&mut props);
            if props.node_type() == NodeType::Instance {
                props.node_type = Some(NodeType::Frame);
            }
            let i = self.new_node(props);
            let index = self.doc.node(parent).children.len();
            self.attach(i, parent, index, false);
            made.push(i);
        }
        Ok(())
    }
}

/// Drops what ties a layer to a component.
fn plain(p: &mut Props) {
    p.symbol = None;
    p.derived = None;
    p.swapped_symbol = None;
    p.prop_assignments = None;
    p.prop_refs = None;
    p.guid_path = None;
    p.override_key = None;
    p.parent = None;
    p.position = None;
}

/// The scene subtree under `at` as `(parent plan index, props)`, parents
/// before children.
fn collect(
    scene: &Scene,
    doc: &crate::document::Document,
    at: SceneIdx,
    parent: Option<usize>,
    plan: &mut Vec<(Option<usize>, Props)>,
) {
    for &c in &scene.node(at).children {
        plan.push((parent, scene.props(doc, c).clone()));
        let k = plan.len() - 1;
        collect(scene, doc, c, Some(k), plan);
    }
}

#[cfg(test)]
mod test;
