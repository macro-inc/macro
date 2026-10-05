//! Laying out an instance's layers again, as Figma does when an instance is
//! resized or an override changes a layer's size (a longer label in a
//! button that hugs it).
//!
//! The layers the instance shows are copied into temporary layers, the
//! same constraints and auto layout code as for ordinary layers runs on
//! them, and what moved or changed size is kept as the instance's derived
//! layout (Figma's `derivedSymbolData`). The temporary layers are then
//! removed; they are never saved.

use super::overrides::{key_of, same_path};
use super::{Patch, Txn, flags};
use crate::document::NodeIdx;
use crate::error::Result;
use crate::model::{Affine, Guid, NodeType, Props, Vec2};
use crate::scene::{Scene, SceneIdx};
use std::sync::Arc;

/// One layer of the instance: its parent in the plan, what it shows, and
/// its guid path.
type Planned = (Option<usize>, Props, Arc<[Guid]>);

fn collect(
    scene: &Scene,
    doc: &crate::document::Document,
    at: SceneIdx,
    parent: Option<usize>,
    plan: &mut Vec<Planned>,
) {
    for &c in &scene.node(at).children {
        let Some((_, path)) = scene.node(c).path.clone() else {
            continue;
        };
        plan.push((parent, scene.props(doc, c).clone(), path));
        let k = plan.len() - 1;
        collect(scene, doc, c, Some(k), plan);
    }
}

impl Txn<'_> {
    /// Lays out instance `inst` again: from the size `from` its layers were
    /// laid out for to its current size, and for the layers at `changed`
    /// paths, whose size changed. A hugging instance takes its content's
    /// size.
    pub(super) fn relayout_instance(
        &mut self,
        inst: NodeIdx,
        from: Vec2,
        changed: &[Vec<Guid>],
    ) -> Result<()> {
        if self.doc.props(inst).node_type() != NodeType::Instance {
            return Ok(());
        }
        let Some(guid) = self.doc.props(inst).guid else {
            return Ok(());
        };
        let plan: Vec<Planned> = {
            let scene = Scene::build_instance(self.doc, inst);
            let Some(root) = scene.find(self.doc, &guid.to_string()) else {
                return Ok(());
            };
            let mut plan = Vec::new();
            collect(&scene, self.doc, root, None, &mut plan);
            plan
        };
        if plan.is_empty() {
            return Ok(());
        }

        // The temporary copy, detached from the page. It is the last thing
        // added to the document, so it can be taken off the end afterwards.
        let first_temp = self.doc.nodes.len() as NodeIdx;
        let guid_before = self.doc.next_guid;
        let mut root_props = self.doc.props(inst).clone();
        root_props.guid = Some(self.doc.new_guid());
        root_props.node_type = Some(NodeType::Frame);
        root_props.symbol = None;
        root_props.derived = None;
        root_props.parent = None;
        root_props.position = None;
        root_props.transform = Some(Affine::IDENTITY);
        root_props.size = Some(from);
        root_props.layout_child = None;
        let temp = self.new_node(root_props);
        let mut made: Vec<NodeIdx> = Vec::with_capacity(plan.len());
        for (parent, props, _) in &plan {
            let mut p = props.clone();
            p.guid = Some(self.doc.new_guid());
            p.parent = None;
            p.position = None;
            p.override_key = None;
            p.guid_path = None;
            if p.node_type() == NodeType::Instance {
                // Its own layers are laid out with it; it is a box here.
                p.node_type = Some(NodeType::Frame);
                p.symbol = None;
                p.derived = None;
            }
            let i = self.new_node(p);
            let parent = parent.map_or(temp, |k| made[k]);
            let index = self.doc.node(parent).children.len();
            self.attach(i, parent, index, false);
            made.push(i);
        }

        // Lay it out.
        let target = self.doc.props(inst).size();
        if (target.x - from.x).abs() > 1e-9 || (target.y - from.y).abs() > 1e-9 {
            let patch = Patch {
                width: Some(target.x),
                height: Some(target.y),
                ..Patch::default()
            };
            self.set(temp, &patch)?;
        }
        let mut touched: Vec<(NodeIdx, bool)> = plan
            .iter()
            .zip(&made)
            .filter(|((_, _, path), _)| changed.iter().any(|c| c.as_slice() == path.as_ref()))
            .map(|(_, &i)| (i, true))
            .collect();
        touched.push((temp, true));
        self.reflow_after(&touched);

        // Keep what changed as derived layout.
        let mut derived = self
            .doc
            .props(inst)
            .derived
            .as_deref()
            .map(<[Props]>::to_vec)
            .unwrap_or_default();
        for ((_, before, path), &i) in plan.iter().zip(&made) {
            let now = self.doc.props(i).clone();
            let moved = now.transform != before.transform;
            let sized = now.size != before.size;
            let relaid = now.text_layout != before.text_layout;
            if !(moved || sized || relaid) {
                continue;
            }
            let k = match derived.iter().position(|d| {
                d.guid_path
                    .as_deref()
                    .is_some_and(|p| same_path(self.doc, p, path))
            }) {
                Some(k) => k,
                None => {
                    derived.push(Props {
                        guid_path: Some(path.iter().map(|&g| key_of(self.doc, g)).collect()),
                        ..Props::default()
                    });
                    derived.len() - 1
                }
            };
            let d = &mut derived[k];
            d.recomputed = true;
            d.transform = now.transform;
            d.size = now.size;
            if sized {
                // Outlines for the old size no longer fit.
                d.fill_geometry = Some(now.fill_geometry.clone().unwrap_or_else(|| Arc::from([])));
                d.stroke_geometry =
                    Some(now.stroke_geometry.clone().unwrap_or_else(|| Arc::from([])));
            }
            if relaid {
                d.text_layout = now.text_layout.clone();
                d.text_style = now.text_style.clone();
            }
        }
        let size = self.doc.props(temp).size();
        self.discard_from(first_temp);
        self.doc.next_guid = guid_before;
        let p = self.edit(inst, flags::DERIVED);
        p.derived = Some(derived.into());
        if size != target {
            self.edit(inst, flags::SIZE).size = Some(size);
        }
        Ok(())
    }

    /// Removes the nodes from `first` on (temporary ones) from the document
    /// and from this step's bookkeeping: they are never saved or undone.
    fn discard_from(&mut self, first: NodeIdx) {
        self.before.retain(|(i, _)| *i < first);
        self.seen.retain(|i| *i < first);
        self.floating.retain(|i| *i < first);
        self.relayout.retain(|i| *i < first);
        for node in self.doc.nodes.drain(first as usize..) {
            if let Some(g) = node.props.guid {
                self.doc.by_guid.remove(&g);
            }
        }
    }
}
