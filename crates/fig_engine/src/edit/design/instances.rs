//! Instances: setting their component properties, switching variants,
//! swapping the component they show, and resetting their changes.
//!
//! As in Figma, overrides that still apply survive a swap: an override's
//! layer is looked up in the new component by its place among same-named
//! layers.

use super::Target;
use crate::document::{Document, NodeIdx};
use crate::edit::overrides::{guid_of, key_of, same_path};
use crate::edit::{PropertyInput, Txn, flags};
use crate::error::{FigError, Result};
use crate::model::{
    Guid, NodeType, PropAssignment, PropField, PropValue, Props, SymbolData, TextContent, Vec2,
};
use crate::scene::Scene;
use std::sync::Arc;

/// Where a layer sits in its component: for each ancestor below the
/// component (and the layer), its name, type, and index among
/// same-named, same-typed siblings.
type NamePath = Vec<(Arc<str>, NodeType, usize)>;

fn name_path(doc: &Document, root: NodeIdx, mut i: NodeIdx) -> Option<NamePath> {
    let mut out = Vec::new();
    while i != root {
        let parent = doc.node(i).parent?;
        let p = doc.props(i);
        let nth = doc
            .node(parent)
            .children
            .iter()
            .filter(|&&c| !doc.node(c).removed)
            .take_while(|&&c| c != i)
            .filter(|&&c| {
                let q = doc.props(c);
                q.name() == p.name() && q.node_type() == p.node_type()
            })
            .count();
        out.push((Arc::from(p.name()), p.node_type(), nth));
        i = parent;
    }
    out.reverse();
    Some(out)
}

fn find_by_name_path(doc: &Document, root: NodeIdx, path: &NamePath) -> Option<NodeIdx> {
    let mut at = root;
    for (name, t, nth) in path {
        at = doc
            .node(at)
            .children
            .iter()
            .copied()
            .filter(|&c| !doc.node(c).removed)
            .filter(|&c| {
                let q = doc.props(c);
                q.name() == name.as_ref() && q.node_type() == *t
            })
            .nth(*nth)?;
    }
    Some(at)
}

fn symbol_of(doc: &Document, i: NodeIdx) -> Option<NodeIdx> {
    let p = doc.props(i);
    let id = p
        .swapped_symbol
        .or_else(|| p.symbol.as_ref().and_then(|s| s.symbol_id))?;
    doc.find(guid_of(doc, id))
}

/// `rel`, a guid path inside component `old`, as the path of the
/// corresponding layer inside component `new` (`None` when it has none).
pub(super) fn remap_path(
    doc: &Document,
    old: NodeIdx,
    new: NodeIdx,
    rel: &[Guid],
) -> Option<Vec<Guid>> {
    let (mut o, mut n) = (old, new);
    let mut out = Vec::with_capacity(rel.len());
    for (k, g) in rel.iter().enumerate() {
        if o == n {
            out.extend_from_slice(&rel[k..]);
            return Some(out);
        }
        let old_layer = doc.find(guid_of(doc, *g))?;
        let names = name_path(doc, o, old_layer)?;
        let new_layer = find_by_name_path(doc, n, &names)?;
        out.push(key_of(doc, doc.props(new_layer).guid?));
        if k + 1 < rel.len() {
            o = symbol_of(doc, old_layer)?;
            n = symbol_of(doc, new_layer)?;
        }
    }
    Some(out)
}

/// The text of an override carried to another component: its characters
/// only, laid out again in the new layer's style.
fn carry_text(o: &mut Props) -> bool {
    let Some(t) = &o.text_content else {
        return false;
    };
    o.text_content = Some(Arc::new(TextContent {
        characters: t.characters.clone(),
        ..TextContent::default()
    }));
    o.text_style = None;
    o.text_layout = None;
    o.size = None;
    true
}

/// An axis keeps an instance's size when it was resized, and takes the new
/// component's otherwise.
fn swapped_size(now: Vec2, old: Vec2, new: Vec2) -> Vec2 {
    let pick = |n: f64, o: f64, c: f64| if (n - o).abs() < 1e-6 { c } else { n };
    Vec2::new(pick(now.x, old.x, new.x), pick(now.y, old.y, new.y))
}

fn starts_with(doc: &Document, path: &[Guid], prefix: &[Guid]) -> bool {
    path.len() >= prefix.len() && same_path(doc, &path[..prefix.len()], prefix)
}

impl Txn<'_> {
    pub(super) fn set_property(
        &mut self,
        id: &str,
        property: &str,
        value: &PropertyInput,
    ) -> Result<()> {
        let target = self.target(id)?;
        let shown = self.shown(&target)?;
        if shown.node_type() != NodeType::Instance {
            return Err(FigError::Unsupported(
                "only instances have property values".into(),
            ));
        }
        if let PropertyInput::Variant(v) = value {
            let Some(component) = self.shown_component(&shown) else {
                return Ok(());
            };
            return match self.variant_for(component, property, v) {
                Some(next) if next != component => self.swap_target(target, next),
                _ => Ok(()),
            };
        }
        let def = Guid::parse(property)
            .ok_or_else(|| FigError::Unsupported(format!("no property {property}")))?;
        let value = self.input_value(value)?;
        let mut list = shown
            .prop_assignments
            .as_deref()
            .map(<[PropAssignment]>::to_vec)
            .unwrap_or_default();
        match list.iter_mut().find(|a| a.def_id == def) {
            Some(a) => a.value = value,
            None => list.push(PropAssignment { def_id: def, value }),
        }
        self.store_assignments(&target, list, &[def])
    }

    /// Stores an instance's property values, then lays it out again around
    /// the layers bound to the `changed` properties.
    fn store_assignments(
        &mut self,
        target: &Target,
        list: Vec<PropAssignment>,
        changed: &[Guid],
    ) -> Result<()> {
        let (root, prefix) = match target {
            Target::Doc(i) => {
                self.edit(*i, flags::PROP_ASSIGNMENTS).prop_assignments = Some(list.into());
                (*i, Vec::new())
            }
            Target::Nested { root, path, .. } => {
                self.edit_override(*root, path, |e| e.prop_assignments = Some(list.into()));
                (*root, path.clone())
            }
        };
        self.after_property_change(root, &prefix, changed)
    }

    /// Lays instance `root` out again after the values of `changed`
    /// properties of the instance at `prefix` (empty: `root` itself)
    /// changed: bound text is laid out again, swapped instances show their
    /// new component at its size.
    fn after_property_change(
        &mut self,
        root: NodeIdx,
        prefix: &[Guid],
        changed: &[Guid],
    ) -> Result<()> {
        let Some(root_guid) = self.doc.props(root).guid else {
            return Ok(());
        };
        // The bound layers: in the component of the instance at `prefix`,
        // so their paths are one longer than it.
        let mut bound: Vec<(Vec<Guid>, PropField, Props)> = Vec::new();
        {
            let scene = Scene::build_instance(self.doc, root);
            for n in &scene.nodes {
                let Some((r, path)) = &n.path else { continue };
                if *r != root_guid
                    || path.len() != prefix.len() + 1
                    || !starts_with(self.doc, path, prefix)
                {
                    continue;
                }
                let base = self.doc.props(n.src);
                for r in base.prop_refs.as_deref().unwrap_or_default() {
                    if changed.contains(&r.def_id) {
                        let props = match &n.props {
                            crate::scene::PropSource::Doc(d) => self.doc.props(*d).clone(),
                            crate::scene::PropSource::Owned(p) => (**p).clone(),
                        };
                        bound.push((path.to_vec(), r.field, props));
                    }
                }
            }
        }
        let mut retext = Vec::new();
        let mut moved = Vec::new();
        for (path, field, props) in bound {
            match field {
                PropField::Text => retext.push(path),
                PropField::SwappedSymbol => {
                    if let Some(next) = self.shown_component(&props) {
                        self.fit_swapped(root, &path, &props, next)?;
                    }
                    moved.push(path);
                }
                _ => moved.push(path),
            }
        }
        // Text laid out for the old value no longer applies.
        self.edit_derived(root, |doc, list| {
            list.retain(|d| {
                !d.guid_path
                    .as_deref()
                    .is_some_and(|p| retext.iter().any(|r| same_path(doc, p, r)))
            });
        });
        let size = self.doc.props(root).size();
        self.relayout_instance_with(root, size, &moved, &retext)
    }

    /// After the nested instance at `path` (showing `props`) changed to
    /// show component `next`: its old layers' layout goes, and it takes
    /// the new component's size where it was not resized.
    fn fit_swapped(
        &mut self,
        root: NodeIdx,
        path: &[Guid],
        props: &Props,
        next: NodeIdx,
    ) -> Result<()> {
        let next_size = self.doc.props(next).size();
        let old_size = props
            .symbol
            .as_ref()
            .and_then(|s| s.symbol_id)
            .and_then(|g| self.doc.find(guid_of(self.doc, g)))
            .map(|c| self.doc.props(c).size())
            .unwrap_or(next_size);
        let size = swapped_size(props.size(), old_size, next_size);
        let transform = props.transform;
        self.edit_derived(root, |doc, list| {
            list.retain(|d| {
                !d.guid_path
                    .as_deref()
                    .is_some_and(|p| p.len() > path.len() && starts_with(doc, p, path))
            });
            let k = match list.iter().position(|d| {
                d.guid_path
                    .as_deref()
                    .is_some_and(|p| same_path(doc, p, path))
            }) {
                Some(k) => k,
                None => {
                    list.push(Props {
                        guid_path: Some(path.iter().map(|&g| key_of(doc, g)).collect()),
                        ..Props::default()
                    });
                    list.len() - 1
                }
            };
            let d = &mut list[k];
            d.size = Some(size);
            d.transform = d.transform.or(transform);
            d.fill_geometry = Some(Arc::from([]));
            d.stroke_geometry = Some(Arc::from([]));
            d.recomputed = true;
        });
        Ok(())
    }

    /// Makes an instance (or nested instance) show component `next`.
    pub(super) fn swap_target(&mut self, target: Target, next: NodeIdx) -> Result<()> {
        if self.doc.props(next).node_type() != NodeType::Symbol {
            return Err(FigError::Unsupported(
                "an instance can only show a component".into(),
            ));
        }
        let shown = self.shown(&target)?;
        if shown.node_type() != NodeType::Instance {
            return Err(FigError::Unsupported(
                "only instances can be swapped".into(),
            ));
        }
        let Some(old) = self.shown_component(&shown) else {
            return Ok(());
        };
        if old == next {
            return Ok(());
        }
        let next_guid = self.doc.props(next).guid.unwrap_or_default();
        let defs: Vec<Guid> = self
            .doc
            .props(self.prop_owner(next))
            .prop_defs
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|d| d.id)
            .collect();
        let assignments: Vec<PropAssignment> = shown
            .prop_assignments
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|a| defs.contains(&a.def_id))
            .cloned()
            .collect();
        match target {
            Target::Doc(i) => self.swap_doc(i, old, next, next_guid, assignments),
            Target::Nested { root, path, .. } => {
                self.swap_nested(root, &path, &shown, old, next, next_guid, assignments)
            }
        }
    }

    fn swap_doc(
        &mut self,
        i: NodeIdx,
        old: NodeIdx,
        next: NodeIdx,
        next_guid: Guid,
        assignments: Vec<PropAssignment>,
    ) -> Result<()> {
        let p = self.doc.props(i).clone();
        let symbol = p.symbol.as_deref().cloned().unwrap_or_default();
        let mut retext = Vec::new();
        let mut overrides = Vec::new();
        for o in symbol.overrides.iter() {
            let Some(path) = o.guid_path.as_deref() else {
                continue;
            };
            let Some(mapped) = remap_path(self.doc, old, next, path) else {
                continue;
            };
            let mut o = o.clone();
            if carry_text(&mut o) {
                retext.push(mapped.clone());
            }
            o.guid_path = Some(mapped.into());
            o.recomputed = true;
            overrides.push(o);
        }
        // Text bound to a property with a value is laid out again too.
        retext.extend(self.bound_text_paths(next, &assignments));
        let next_size = self.doc.props(next).size();
        let size = swapped_size(p.size(), self.doc.props(old).size(), next_size);
        let props = self.edit(
            i,
            flags::INSTANCE_OF
                | flags::OVERRIDES
                | flags::PROP_ASSIGNMENTS
                | flags::DERIVED
                | flags::SIZE
                | flags::COMPONENT,
        );
        props.symbol = Some(Arc::new(SymbolData {
            symbol_id: Some(next_guid),
            overrides: overrides.into(),
            uniform_scale: symbol.uniform_scale,
        }));
        props.swapped_symbol = None;
        props.prop_assignments = Some(assignments.into());
        props.derived = Some(Arc::from([]));
        props.size = Some(size);
        self.relayout_instance_with(i, next_size, &[], &retext)
    }

    #[expect(clippy::too_many_arguments, reason = "the parts of one swap")]
    fn swap_nested(
        &mut self,
        root: NodeIdx,
        path: &[Guid],
        shown: &Props,
        old: NodeIdx,
        next: NodeIdx,
        next_guid: Guid,
        assignments: Vec<PropAssignment>,
    ) -> Result<()> {
        let mut retext = Vec::new();
        self.edit_overrides(root, |doc, list| {
            let mut kept = Vec::with_capacity(list.len());
            for o in list.drain(..) {
                let Some(p) = o.guid_path.as_deref() else {
                    kept.push(o);
                    continue;
                };
                if p.len() <= path.len() || !starts_with(doc, p, path) {
                    kept.push(o);
                    continue;
                }
                let Some(rel) = remap_path(doc, old, next, &p[path.len()..]) else {
                    continue;
                };
                let mut o = o.clone();
                let mapped: Vec<Guid> = p[..path.len()].iter().copied().chain(rel).collect();
                if carry_text(&mut o) {
                    retext.push(mapped.clone());
                }
                o.guid_path = Some(mapped.into());
                o.recomputed = true;
                kept.push(o);
            }
            *list = kept;
        });
        for rel in self.bound_text_paths(next, &assignments) {
            retext.push(path.iter().copied().chain(rel).collect());
        }
        self.edit_override(root, path, |e| {
            e.swapped_symbol = Some(next_guid);
            e.prop_assignments = Some(assignments.into());
        });
        self.fit_swapped(root, path, shown, next)?;
        let size = self.doc.props(root).size();
        self.relayout_instance_with(root, size, &[path.to_vec()], &retext)
    }

    /// Paths (inside `component`) of its text layers bound to properties
    /// `assignments` give values.
    fn bound_text_paths(
        &self,
        component: NodeIdx,
        assignments: &[PropAssignment],
    ) -> Vec<Vec<Guid>> {
        let mut out = Vec::new();
        let mut stack = self.doc.node(component).children.clone();
        while let Some(i) = stack.pop() {
            let node = self.doc.node(i);
            if node.removed {
                continue;
            }
            let p = &node.props;
            let bound = p.prop_refs.as_deref().unwrap_or_default().iter().any(|r| {
                r.field == PropField::Text
                    && assignments
                        .iter()
                        .any(|a| a.def_id == r.def_id && matches!(a.value, PropValue::Text(_)))
            });
            if bound && let Some(g) = p.guid {
                out.push(vec![key_of(self.doc, g)]);
            }
            if p.node_type() != NodeType::Instance {
                stack.extend(node.children.iter().copied());
            }
        }
        out
    }

    pub(super) fn reset_instance(&mut self, id: &str, property: Option<&str>) -> Result<()> {
        let target = self.target(id)?;
        let shown = self.shown(&target)?;
        if shown.node_type() != NodeType::Instance {
            return Ok(());
        }
        if let Some(property) = property {
            // A variant property has nothing to reset.
            let Some(def) = Guid::parse(property) else {
                return Ok(());
            };
            let list: Vec<PropAssignment> = shown
                .prop_assignments
                .as_deref()
                .unwrap_or_default()
                .iter()
                .filter(|a| a.def_id != def)
                .cloned()
                .collect();
            return self.store_assignments(&target, list, &[def]);
        }
        match target {
            Target::Doc(i) => {
                let p = self.doc.props(i).clone();
                let component_size = self
                    .shown_component(&p)
                    .map(|c| self.doc.props(c).size())
                    .unwrap_or_else(|| p.size());
                let symbol = p.symbol.as_deref().cloned().unwrap_or_default();
                let props = self.edit(
                    i,
                    flags::OVERRIDES | flags::PROP_ASSIGNMENTS | flags::DERIVED,
                );
                props.symbol = Some(Arc::new(SymbolData {
                    overrides: Arc::from([]),
                    ..symbol
                }));
                props.prop_assignments = Some(Arc::from([]));
                props.derived = Some(Arc::from([]));
                self.relayout_instance(i, component_size, &[])
            }
            Target::Nested { root, path, .. } => {
                self.edit_overrides(root, |doc, list| {
                    list.retain(|o| {
                        !o.guid_path
                            .as_deref()
                            .is_some_and(|p| starts_with(doc, p, &path))
                    });
                });
                self.edit_derived(root, |doc, list| {
                    list.retain(|d| {
                        !d.guid_path
                            .as_deref()
                            .is_some_and(|p| p.len() > path.len() && starts_with(doc, p, &path))
                    });
                });
                let size = self.doc.props(root).size();
                self.relayout_instance(root, size, &[path])
            }
        }
    }
}
