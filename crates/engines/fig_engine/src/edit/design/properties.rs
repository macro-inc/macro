//! Component properties on main components, as Figma's "Create component
//! property" flows make them: definitions (on the component, or on the
//! component set for variants) and layers bound to them. A property's
//! default is what the component's bound layers show.

use super::Target;
use crate::document::NodeIdx;
use crate::edit::{Patch, PropertyInput, Txn, flags};
use crate::error::{FigError, Result};
use crate::model::{Guid, NodeType, PropDef, PropField, PropRef, PropValue};
use std::sync::Arc;

fn field_of(name: &str) -> Result<PropField> {
    Ok(match name {
        "VISIBLE" => PropField::Visible,
        "TEXT" | "TEXT_DATA" => PropField::Text,
        "INSTANCE_SWAP" | "OVERRIDDEN_SYMBOL_ID" => PropField::SwappedSymbol,
        _ => return Err(FigError::Unsupported(format!("no layer field {name}"))),
    })
}

/// The layer field a property kind drives.
fn field_for_kind(kind: &str) -> Option<PropField> {
    match kind {
        "BOOL" => Some(PropField::Visible),
        "TEXT" => Some(PropField::Text),
        "INSTANCE_SWAP" => Some(PropField::SwappedSymbol),
        _ => None,
    }
}

fn kind_matches(kind: &str, field: PropField) -> bool {
    field_for_kind(kind) == Some(field)
}

impl Txn<'_> {
    /// The layers of `owner` (a component or set) and its variants, not
    /// inside nested instances' components.
    fn layers_of(&self, owner: NodeIdx) -> Vec<NodeIdx> {
        let mut out = Vec::new();
        let mut stack = self.doc.node(owner).children.clone();
        while let Some(i) = stack.pop() {
            let node = self.doc.node(i);
            if node.removed {
                continue;
            }
            out.push(i);
            stack.extend(node.children.iter().copied());
        }
        out
    }

    fn defs_of(&self, owner: NodeIdx) -> Vec<PropDef> {
        self.doc
            .props(owner)
            .prop_defs
            .as_deref()
            .unwrap_or_default()
            .to_vec()
    }

    /// `name`, or `name 2`, `name 3`… when another property has it.
    fn unique_property_name(&self, owner: NodeIdx, name: &str, except: Option<Guid>) -> String {
        let defs = self.defs_of(owner);
        let taken = |n: &str| defs.iter().any(|d| d.name == n && Some(d.id) != except);
        if !taken(name) {
            return name.to_owned();
        }
        (2..)
            .map(|k| format!("{name} {k}"))
            .find(|n| !taken(n))
            .unwrap_or_default()
    }

    /// The owner of a main component, or of the component a layer is in.
    fn owner_for(&self, i: NodeIdx) -> Result<NodeIdx> {
        let component = self
            .component_of(i)
            .ok_or_else(|| FigError::Unsupported("the layer is not in a main component".into()))?;
        Ok(if self.doc.props(component).is_state_group == Some(true) {
            component
        } else {
            self.prop_owner(component)
        })
    }

    pub(super) fn add_component_property(
        &mut self,
        component: NodeIdx,
        name: &str,
        kind: &str,
        value: Option<&PropertyInput>,
        layer: Option<NodeIdx>,
    ) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(FigError::Unsupported("a property needs a name".into()));
        }
        let owner = self.owner_for(component)?;
        if kind == "VARIANT" {
            let value = match value {
                Some(PropertyInput::Text(t) | PropertyInput::Variant(t)) => t.clone(),
                _ => "Default".to_owned(),
            };
            return if self.doc.props(owner).is_state_group == Some(true) {
                self.add_variant_property(owner, name, &value)
            } else {
                self.make_set(owner, name, &value).map(|_| ())
            };
        }
        let field = field_for_kind(kind)
            .ok_or_else(|| FigError::Unsupported(format!("no property kind {kind}")))?;
        let initial = match (value, layer) {
            (Some(v), _) => self.input_value(v)?,
            (None, Some(l)) => self.layer_value(l, field)?,
            (None, None) => match field {
                PropField::Visible => PropValue::Bool(true),
                PropField::Text => PropValue::Text(name.into()),
                _ => {
                    return Err(FigError::Unsupported(
                        "an instance swap property needs a component".into(),
                    ));
                }
            },
        };
        let def = PropDef {
            id: self.doc.new_guid(),
            name: self.unique_property_name(owner, name, None),
            kind: kind.to_owned(),
            initial: Some(initial),
            preferred: Arc::from([]),
        };
        let id = def.id;
        let mut defs = self.defs_of(owner);
        defs.push(def);
        self.edit(owner, flags::COMPONENT).prop_defs = Some(defs.into());
        if let Some(l) = layer {
            self.bind(l, field, Some(id))?;
        }
        Ok(())
    }

    /// What layer `i` shows for `field`, as a property value.
    fn layer_value(&self, i: NodeIdx, field: PropField) -> Result<PropValue> {
        let p = self.doc.props(i);
        Ok(match field {
            PropField::Visible => PropValue::Bool(p.visible()),
            PropField::Text => PropValue::Text(
                p.text_content
                    .as_ref()
                    .map(|t| t.characters.clone())
                    .unwrap_or_else(|| "".into()),
            ),
            PropField::SwappedSymbol => {
                let c = self
                    .shown_component(p)
                    .ok_or_else(|| FigError::Unsupported("only instances can be swapped".into()))?;
                PropValue::Symbol(self.doc.props(c).guid.unwrap_or_default())
            }
            PropField::Other => PropValue::Other,
        })
    }

    /// Shows `value` on layer `i` (in a main component) for `field`.
    fn show_value(&mut self, i: NodeIdx, field: PropField, value: &PropValue) -> Result<()> {
        match (field, value) {
            (PropField::Visible, PropValue::Bool(v)) => {
                if self.doc.props(i).visible() != *v {
                    self.edit(i, flags::VISIBLE).visible = Some(*v);
                }
            }
            (PropField::Text, PropValue::Text(t)) => {
                if self.doc.props(i).node_type() == NodeType::Text {
                    let patch = Patch {
                        characters: Some(t.to_string()),
                        ..Patch::default()
                    };
                    self.set(i, &patch)?;
                }
            }
            (PropField::SwappedSymbol, PropValue::Symbol(g)) => {
                if let Some(c) = self.doc.find(*g) {
                    self.swap_target(Target::Doc(i), c)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) fn bind_property(
        &mut self,
        i: NodeIdx,
        field: &str,
        def: Option<Guid>,
    ) -> Result<()> {
        let field = field_of(field)?;
        self.bind(i, field, def)
    }

    fn bind(&mut self, i: NodeIdx, field: PropField, def: Option<Guid>) -> Result<()> {
        let owner = self.owner_for(i)?;
        let node_type = self.doc.props(i).node_type();
        match field {
            PropField::Text if node_type != NodeType::Text => {
                return Err(FigError::Unsupported(
                    "only text takes a text property".into(),
                ));
            }
            PropField::SwappedSymbol if node_type != NodeType::Instance => {
                return Err(FigError::Unsupported(
                    "only instances take an instance swap property".into(),
                ));
            }
            _ => {}
        }
        let found = match def {
            Some(d) => Some(
                self.defs_of(owner)
                    .into_iter()
                    .find(|x| x.id == d && kind_matches(&x.kind, field))
                    .ok_or_else(|| FigError::Unsupported("no such property here".into()))?,
            ),
            None => None,
        };
        let mut refs: Vec<PropRef> = self
            .doc
            .props(i)
            .prop_refs
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|r| r.field != field)
            .cloned()
            .collect();
        if let Some(d) = &found {
            refs.push(PropRef {
                def_id: d.id,
                field,
            });
        }
        self.edit(i, flags::COMPONENT).prop_refs = Some(refs.into());
        if let Some(value) = found.and_then(|d| d.initial) {
            self.show_value(i, field, &value)?;
        }
        Ok(())
    }

    pub(super) fn edit_component_property(
        &mut self,
        component: NodeIdx,
        def: Guid,
        name: Option<&str>,
        value: Option<&PropertyInput>,
    ) -> Result<()> {
        let owner = self.owner_for(component)?;
        let mut defs = self.defs_of(owner);
        let k = defs
            .iter()
            .position(|d| d.id == def)
            .ok_or_else(|| FigError::Unsupported("no such property".into()))?;
        if defs[k].kind == "VARIANT" {
            let from = defs[k].name.clone();
            if let Some(name) = name {
                self.rename_variant_property(owner, &from, name)?;
            }
            return Ok(());
        }
        if let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) {
            defs[k].name = self.unique_property_name(owner, name, Some(def));
        }
        let value = value.map(|v| self.input_value(v)).transpose()?;
        if let Some(v) = &value {
            defs[k].initial = Some(v.clone());
        }
        let field = field_for_kind(&defs[k].kind);
        self.edit(owner, flags::COMPONENT).prop_defs = Some(defs.into());
        // The component's bound layers show the new default.
        if let (Some(value), Some(field)) = (value, field) {
            for i in self.layers_of(owner) {
                let bound = self
                    .doc
                    .props(i)
                    .prop_refs
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .any(|r| r.def_id == def && r.field == field);
                if bound {
                    self.show_value(i, field, &value)?;
                }
            }
        }
        Ok(())
    }

    pub(super) fn delete_component_property(
        &mut self,
        component: NodeIdx,
        def: Guid,
    ) -> Result<()> {
        let owner = self.owner_for(component)?;
        let defs = self.defs_of(owner);
        let Some(d) = defs.iter().find(|d| d.id == def) else {
            return Ok(());
        };
        if d.kind == "VARIANT" {
            let name = d.name.clone();
            return self.remove_variant_property(owner, &name);
        }
        let kept: Vec<PropDef> = defs.into_iter().filter(|d| d.id != def).collect();
        self.edit(owner, flags::COMPONENT).prop_defs = Some(kept.into());
        for i in self.layers_of(owner) {
            let refs = self.doc.props(i).prop_refs.clone();
            if let Some(refs) = refs
                && refs.iter().any(|r| r.def_id == def)
            {
                let kept: Vec<PropRef> = refs.iter().filter(|r| r.def_id != def).cloned().collect();
                self.edit(i, flags::COMPONENT).prop_refs = Some(kept.into());
            }
        }
        Ok(())
    }
}
