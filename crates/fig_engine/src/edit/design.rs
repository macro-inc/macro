//! Design systems, as in Figma: instances' component properties and
//! variants (`instances`), variants and component properties on main
//! components (`variants`, `properties`), and shared styles (`styles`).
//!
//! An instance's property values are stored on the instance (or, for a
//! nested instance, as an override on the outermost one); Figma keeps a
//! component set's variant properties three ways (the variants' names,
//! their `variantPropSpecs`, and the set's definitions and value orders),
//! and edits here keep all three in step.

use super::overrides::{entry_for, guid_of};
use super::{Op, PropertyInput, Txn, flags};
use crate::document::NodeIdx;
use crate::error::{FigError, Result};
use crate::model::{Guid, NodeType, PropValue, Props, SymbolData};
use crate::scene::Scene;
use std::sync::Arc;

mod instances;
mod properties;
mod styles;
mod variants;

pub(crate) use variants::parse_variant_name;

/// A layer the editor names: a document node, or a layer inside an
/// instance (its outermost instance and its guid path there).
pub(super) enum Target {
    Doc(NodeIdx),
    Nested {
        root: NodeIdx,
        path: Vec<Guid>,
        id: String,
    },
}

impl Txn<'_> {
    pub(super) fn apply_design(&mut self, op: &Op) -> Result<()> {
        match op {
            Op::SetProperty {
                ids,
                property,
                value,
            } => {
                for id in ids {
                    self.set_property(id, property, value)?;
                }
            }
            Op::SwapInstance { ids, component } => {
                let component = self.resolve(component)?;
                for id in ids {
                    let target = self.target(id)?;
                    self.swap_target(target, component)?;
                }
            }
            Op::ResetInstance { ids, property } => {
                for id in ids {
                    self.reset_instance(id, property.as_deref())?;
                }
            }
            Op::CombineAsVariants { ids } => {
                let all = self.layers(ids)?;
                self.combine_as_variants(&all)?;
            }
            Op::AddVariant { set, from } => {
                let set = self.resolve(set)?;
                let from = from.as_deref().map(|f| self.resolve(f)).transpose()?;
                self.add_variant(set, from)?;
            }
            Op::AddVariantProperty { set, name, value } => {
                let set = self.resolve(set)?;
                self.add_variant_property(set, name, value)?;
            }
            Op::RenameVariantProperty { set, from, to } => {
                let set = self.resolve(set)?;
                self.rename_variant_property(set, from, to)?;
            }
            Op::RemoveVariantProperty { set, name } => {
                let set = self.resolve(set)?;
                self.remove_variant_property(set, name)?;
            }
            Op::SetVariantValue {
                ids,
                property,
                value,
            } => {
                for i in self.resolve_all(ids)? {
                    self.set_variant_value(i, property, value)?;
                }
            }
            Op::AddComponentProperty {
                component,
                name,
                kind,
                value,
                layer,
            } => {
                let component = self.resolve(component)?;
                let layer = layer.as_deref().map(|l| self.resolve(l)).transpose()?;
                self.add_component_property(component, name, kind, value.as_ref(), layer)?;
            }
            Op::EditComponentProperty {
                component,
                property,
                name,
                value,
            } => {
                let component = self.resolve(component)?;
                let def = parse_def(property)?;
                self.edit_component_property(component, def, name.as_deref(), value.as_ref())?;
            }
            Op::DeleteComponentProperty {
                component,
                property,
            } => {
                let component = self.resolve(component)?;
                let def = parse_def(property)?;
                self.delete_component_property(component, def)?;
            }
            Op::BindProperty {
                ids,
                field,
                property,
            } => {
                let def = property.as_deref().map(parse_def).transpose()?;
                for i in self.layers(ids)? {
                    self.bind_property(i, field, def)?;
                }
            }
            Op::ExposeInstance { ids, exposed } => {
                for i in self.layers(ids)? {
                    if self.doc.props(i).node_type() == NodeType::Instance {
                        self.edit(i, flags::COMPONENT).props_bubbled = Some(*exposed);
                    }
                }
            }
            Op::ApplyStyle { ids, kind, style } => {
                let style = style.as_deref().map(|s| self.resolve(s)).transpose()?;
                for id in ids {
                    self.apply_style(id, kind, style)?;
                }
            }
            Op::CreateStyle { kind, name, from } => {
                self.create_style(kind, name, from)?;
            }
            Op::EditStyle { style, name, props } => {
                let style = self.resolve(style)?;
                self.edit_style(style, name.as_deref(), props)?;
            }
            Op::DeleteStyle { ids } => {
                for i in self.resolve_all(ids)? {
                    self.delete_style(i);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Resolves a layer id, inside instances too.
    pub(super) fn target(&self, id: &str) -> Result<Target> {
        let Some(rest) = id.strip_prefix('I') else {
            return Ok(Target::Doc(self.resolve(id)?));
        };
        let missing = || FigError::NoSuchNode(id.to_owned());
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
        Ok(Target::Nested {
            root,
            path,
            id: id.to_owned(),
        })
    }

    /// What a layer shows now, overrides and property values included.
    pub(super) fn shown(&self, target: &Target) -> Result<Props> {
        match target {
            Target::Doc(i) => Ok(self.doc.props(*i).clone()),
            Target::Nested { root, id, .. } => {
                let scene = Scene::build_instance(self.doc, *root);
                let i = scene
                    .find(self.doc, id)
                    .ok_or_else(|| FigError::NoSuchNode(id.clone()))?;
                Ok(scene.props(self.doc, i).clone())
            }
        }
    }

    /// Changes the override of the layer at `path` in instance `root`.
    pub(super) fn edit_override(
        &mut self,
        root: NodeIdx,
        path: &[Guid],
        f: impl FnOnce(&mut Props),
    ) {
        self.edit_overrides(root, |doc, list| {
            let k = entry_for(doc, list, path);
            f(&mut list[k]);
            list[k].recomputed = true;
        });
    }

    /// Changes instance `root`'s list of overrides.
    pub(super) fn edit_overrides(
        &mut self,
        root: NodeIdx,
        f: impl FnOnce(&crate::document::Document, &mut Vec<Props>),
    ) {
        let symbol = self
            .doc
            .props(root)
            .symbol
            .as_deref()
            .cloned()
            .unwrap_or_default();
        let mut list = symbol.overrides.to_vec();
        f(self.doc, &mut list);
        self.edit(root, flags::OVERRIDES).symbol = Some(Arc::new(SymbolData {
            overrides: list.into(),
            ..symbol
        }));
    }

    /// Changes instance `root`'s derived layout.
    pub(super) fn edit_derived(
        &mut self,
        root: NodeIdx,
        f: impl FnOnce(&crate::document::Document, &mut Vec<Props>),
    ) {
        let mut list = self
            .doc
            .props(root)
            .derived
            .as_deref()
            .map(<[Props]>::to_vec)
            .unwrap_or_default();
        f(self.doc, &mut list);
        self.edit(root, flags::DERIVED).derived = Some(list.into());
    }

    /// The component an instance shows (a swap, else its main component).
    pub(super) fn shown_component(&self, p: &Props) -> Option<NodeIdx> {
        let id = p
            .swapped_symbol
            .or_else(|| p.symbol.as_ref().and_then(|s| s.symbol_id))?;
        self.doc.find(guid_of(self.doc, id))
    }

    /// Where a component's properties are defined: its component set for
    /// a variant, else itself.
    pub(super) fn prop_owner(&self, component: NodeIdx) -> NodeIdx {
        match self.doc.node(component).parent {
            Some(p) if self.doc.props(p).is_state_group == Some(true) => p,
            _ => component,
        }
    }

    /// The main component (or component set) a layer belongs to.
    pub(super) fn component_of(&self, mut i: NodeIdx) -> Option<NodeIdx> {
        loop {
            let p = self.doc.props(i);
            if p.node_type() == NodeType::Symbol || p.is_state_group == Some(true) {
                return Some(i);
            }
            i = self.doc.node(i).parent?;
        }
    }

    /// A value the editor sent, as stored.
    pub(super) fn input_value(&self, value: &PropertyInput) -> Result<PropValue> {
        Ok(match value {
            PropertyInput::Bool(b) => PropValue::Bool(*b),
            PropertyInput::Text(t) => PropValue::Text(t.as_str().into()),
            PropertyInput::Component(id) => {
                let c = self.resolve(id)?;
                if self.doc.props(c).node_type() != NodeType::Symbol {
                    return Err(FigError::Unsupported(
                        "instance swap properties take a component".into(),
                    ));
                }
                PropValue::Symbol(self.doc.props(c).guid.unwrap_or_default())
            }
            PropertyInput::Variant(_) => {
                return Err(FigError::Unsupported(
                    "a variant is chosen by its property's name".into(),
                ));
            }
        })
    }
}

/// A property definition id (`12:34`).
fn parse_def(id: &str) -> Result<Guid> {
    Guid::parse(id).ok_or_else(|| FigError::Unsupported(format!("no property {id}")))
}

#[cfg(test)]
mod test;
