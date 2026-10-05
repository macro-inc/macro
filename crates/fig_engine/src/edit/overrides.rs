//! Editing the layers inside an instance. As in Figma, the change is an
//! override stored on the outermost instance, keyed by the layer's guid
//! path; the component itself is untouched.

use super::{Patch, Txn, flags};
use crate::document::Document;
use crate::error::{FigError, Result};
use crate::model::{
    CornerRadii, Guid, NodeType, PropAssignment, PropField, PropValue, Props, StrokeAlign,
    SymbolData,
};
use crate::scene::Scene;
use std::sync::Arc;

/// A path element as files write it: the node's override key when it has
/// one (components from libraries), else its guid.
pub(super) fn key_of(doc: &Document, g: Guid) -> Guid {
    doc.find(g)
        .and_then(|i| doc.props(i).override_key)
        .unwrap_or(g)
}

/// A path element as the scene uses it: a document guid.
pub(crate) fn guid_of(doc: &Document, g: Guid) -> Guid {
    if doc.by_guid.contains_key(&g) {
        g
    } else {
        doc.by_override_key.get(&g).copied().unwrap_or(g)
    }
}

/// The index of the override for `path`, added when there is none.
fn entry_for(doc: &Document, overrides: &mut Vec<Props>, path: &[Guid]) -> usize {
    if let Some(k) = overrides.iter().position(|o| {
        o.guid_path
            .as_deref()
            .is_some_and(|p| same_path(doc, p, path))
    }) {
        return k;
    }
    overrides.push(Props {
        guid_path: Some(path.iter().map(|&g| key_of(doc, g)).collect()),
        ..Props::default()
    });
    overrides.len() - 1
}

pub(super) fn same_path(doc: &Document, a: &[Guid], b: &[Guid]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(x, y)| guid_of(doc, *x) == guid_of(doc, *y))
}

impl Txn<'_> {
    /// Applies `patch` to the layer `id` (`I<instance>;<guid>;…`) inside an
    /// instance, as an override on that instance.
    pub(super) fn set_override(&mut self, id: &str, patch: &Patch) -> Result<()> {
        let missing = || FigError::NoSuchNode(id.to_owned());
        let rest = id.strip_prefix('I').ok_or_else(missing)?;
        let mut parts = rest.split(';');
        let root_guid = parts.next().and_then(Guid::parse).ok_or_else(missing)?;
        let path: Vec<Guid> = parts
            .map(Guid::parse)
            .collect::<Option<_>>()
            .ok_or_else(missing)?;
        let root = self.doc.find(root_guid).ok_or_else(missing)?;
        if path.is_empty() || self.doc.node(root).removed {
            return Err(missing());
        }
        // What the layer shows now, overrides included.
        let mut shown = {
            let scene = Scene::build_instance(self.doc, root);
            let i = scene.find(self.doc, id).ok_or_else(missing)?;
            scene.props(self.doc, i).clone()
        };
        let symbol = self
            .doc
            .props(root)
            .symbol
            .as_deref()
            .cloned()
            .unwrap_or_default();
        let mut overrides = symbol.overrides.to_vec();
        let k = entry_for(self.doc, &mut overrides, &path);
        let mut entry = overrides[k].clone();
        if let Some(name) = &patch.name {
            entry.name = Some(name.as_str().into());
        }
        if let Some(v) = patch.visible {
            entry.visible = Some(v);
        }
        if let Some(v) = patch.opacity {
            entry.opacity = Some(v.clamp(0.0, 1.0));
        }
        let text_range = patch.text_range.is_some() && shown.node_type() == NodeType::Text;
        if let Some(specs) = patch.fills.as_ref().filter(|_| !text_range) {
            entry.fills = Some(Self::paints(shown.fills(), specs));
            entry.fill_style = None;
        }
        if let Some(specs) = &patch.strokes {
            entry.strokes = Some(Self::paints(shown.strokes(), specs));
            entry.stroke_style = None;
        }
        if let Some(specs) = &patch.effects {
            entry.effects = Some(super::effects_from(shown.effects(), specs));
            entry.effect_style = None;
        }
        if let Some(w) = patch.stroke_weight {
            entry.stroke_weight = Some(w.max(0.0));
        }
        if let Some(a) = &patch.stroke_align {
            entry.stroke_align = Some(match a.as_str() {
                "INSIDE" => StrokeAlign::Inside,
                "OUTSIDE" => StrokeAlign::Outside,
                _ => StrokeAlign::Center,
            });
        }
        if let Some(r) = patch.corner_radius {
            entry.corner_radius = Some(r.max(0.0));
            entry.corner_radii = Some(CornerRadii::uniform(r.max(0.0)));
        }
        let mut relaid = false;
        if shown.node_type() == NodeType::Text
            && let Some(change) = patch.text_change(&shown.clone())
        {
            crate::text::edit_props(self.doc, &mut shown, &change)?;
            entry.text_content = shown.text_content.clone();
            entry.text_style = shown.text_style.clone();
            entry.text_layout = shown.text_layout.clone();
            entry.size = shown.size;
            relaid = true;
        }
        entry.recomputed = true;
        overrides[k] = entry;
        // Text bound to a component property is set through the property,
        // on the instance whose component the layer belongs to.
        let mut root_assignments = None;
        if let Some(chars) = &patch.characters
            && let Some(def) = shown
                .prop_refs
                .as_deref()
                .and_then(|refs| refs.iter().find(|r| r.field == PropField::Text))
                .map(|r| r.def_id)
        {
            let owner = &path[..path.len() - 1];
            let current = if owner.is_empty() {
                self.doc.props(root).prop_assignments.clone()
            } else {
                let scene = Scene::build_instance(self.doc, root);
                let owner_id = owner.iter().fold(format!("I{root_guid}"), |mut s, g| {
                    s.push(';');
                    s.push_str(&g.to_string());
                    s
                });
                scene
                    .find(self.doc, &owner_id)
                    .and_then(|i| scene.props(self.doc, i).prop_assignments.clone())
            };
            let mut list = current
                .as_deref()
                .map(<[PropAssignment]>::to_vec)
                .unwrap_or_default();
            let value = PropValue::Text(chars.as_str().into());
            match list.iter_mut().find(|a| a.def_id == def) {
                Some(a) => a.value = value,
                None => list.push(PropAssignment { def_id: def, value }),
            }
            if owner.is_empty() {
                root_assignments = Some(list);
            } else {
                let o = entry_for(self.doc, &mut overrides, owner);
                overrides[o].prop_assignments = Some(list.into());
                overrides[o].recomputed = true;
            }
        }
        if let Some(list) = root_assignments {
            self.edit(root, flags::PROP_ASSIGNMENTS).prop_assignments = Some(list.into());
        }
        let mut derived = self
            .doc
            .props(root)
            .derived
            .as_deref()
            .map(<[Props]>::to_vec);
        if relaid && let Some(list) = &mut derived {
            // Figma's layout for the old text no longer applies.
            list.retain(|d| {
                !d.guid_path
                    .as_deref()
                    .is_some_and(|p| same_path(self.doc, p, &path))
            });
        }
        let p = self.edit(root, flags::OVERRIDES);
        p.symbol = Some(Arc::new(SymbolData {
            overrides: overrides.into(),
            ..symbol
        }));
        if let Some(list) = derived {
            p.derived = Some(list.into());
        }
        if relaid {
            // The new text's size moves its neighbors in the instance.
            let size = self.doc.props(root).size();
            self.relayout_instance(root, size, &[path])?;
        }
        Ok(())
    }
}
