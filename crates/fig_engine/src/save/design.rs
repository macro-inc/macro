//! Writing what design systems are made of: component property values,
//! definitions, and bindings; variants; and shared style references.
//!
//! Lists Figma keeps more in than the engine models (definitions' sort
//! positions, bindings to fields the engine does not drive, deleted
//! entries) are patched entry by entry, so those survive.

use super::Build;
use crate::edit::flags;
use crate::kiwi::{Msg, Value};
use crate::model::{Guid, PropAssignment, PropDef, PropField, PropRef, PropValue, Props};

/// The messages of a list field.
fn msgs(b: &Build, m: &Msg, field: &str) -> Vec<Msg> {
    match m.get(b.schema, field) {
        Some(Value::List(l)) => l
            .iter()
            .filter_map(|v| match v {
                Value::Msg(m) => Some((**m).clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn set_msgs(b: &Build, m: &mut Msg, field: &str, list: Vec<Msg>) {
    if list.is_empty() {
        m.remove(b.schema, field);
    } else {
        m.set(
            b.schema,
            field,
            Value::List(list.into_iter().map(|e| Value::Msg(Box::new(e))).collect()),
        );
    }
}

fn read_guid(b: &Build, m: &Msg, field: &str) -> Option<Guid> {
    let Some(Value::Msg(g)) = m.get(b.schema, field) else {
        return None;
    };
    let n = |f| match g.get(b.schema, f) {
        Some(Value::Uint(v)) => *v,
        _ => 0,
    };
    Some(Guid {
        session: n("sessionID"),
        local: n("localID"),
    })
}

fn read_str<'m>(b: &Build, m: &'m Msg, field: &str) -> Option<&'m str> {
    match m.get(b.schema, field) {
        Some(Value::Str(s)) => Some(s),
        _ => None,
    }
}

fn read_enum<'s>(b: &'s Build, m: &Msg, field: &str) -> Option<&'s str> {
    match m.get(b.schema, field) {
        Some(Value::Enum(def, v)) => b.schema.enum_name(*def, *v),
        _ => None,
    }
}

fn read_bool(b: &Build, m: &Msg, field: &str) -> Option<bool> {
    match m.get(b.schema, field) {
        Some(Value::Bool(v)) => Some(*v),
        _ => None,
    }
}

fn field_name(f: PropField) -> Option<&'static str> {
    match f {
        PropField::Visible => Some("VISIBLE"),
        PropField::Text => Some("TEXT_DATA"),
        PropField::SwappedSymbol => Some("OVERRIDDEN_SYMBOL_ID"),
        PropField::Other => None,
    }
}

impl Build<'_> {
    /// A text value: just the characters (Figma lays the lines out again).
    fn text_value(&self, def: u32, existing: Option<&Msg>, text: &str) -> Msg {
        let s = self.schema;
        let mut t = existing.cloned().unwrap_or_else(|| Msg::new(def));
        t.set(s, "characters", Value::Str(text.into()));
        for f in ["characterStyleIDs", "styleOverrideTable", "lines"] {
            t.remove(s, f);
        }
        t
    }

    /// Sets `value` in the `ComponentPropValue` field `field` of `m`,
    /// keeping that message's other fields.
    fn prop_value(&self, m: &mut Msg, field: &str, value: &PropValue) {
        let s = self.schema;
        let Some(vdef) = self.sub(m.def, field) else {
            return;
        };
        let mut v = match m.get(s, field) {
            Some(Value::Msg(v)) => (**v).clone(),
            _ => Msg::new(vdef),
        };
        match value {
            PropValue::Bool(on) => {
                v.remove(s, "textValue");
                v.remove(s, "guidValue");
                v.set(s, "boolValue", Value::Bool(*on));
            }
            PropValue::Text(text) => {
                v.remove(s, "boolValue");
                v.remove(s, "guidValue");
                if let Some(tdef) = self.sub(vdef, "textValue") {
                    let existing = match v.get(s, "textValue") {
                        Some(Value::Msg(t)) => Some((**t).clone()),
                        _ => None,
                    };
                    let t = self.text_value(tdef, existing.as_ref(), text);
                    v.set(s, "textValue", Value::Msg(Box::new(t)));
                }
            }
            PropValue::Symbol(g) => {
                v.remove(s, "boolValue");
                v.remove(s, "textValue");
                self.guid_field(&mut v, "guidValue", *g);
            }
            PropValue::Other => return,
        }
        m.set(s, field, Value::Msg(Box::new(v)));
    }

    /// Newer files carry each value a second time as variable data
    /// (`varValue`); it is written to match, or dropped when this schema
    /// cannot express it.
    fn var_value(&self, m: &mut Msg, value: &PropValue) {
        let s = self.schema;
        let Some(def) = self.sub(m.def, "varValue") else {
            return;
        };
        let built = (|| {
            let mut data = Msg::new(def);
            let any_def = self.sub(def, "value")?;
            let mut any = Msg::new(any_def);
            let kind = match value {
                PropValue::Bool(on) => {
                    any.set(s, "boolValue", Value::Bool(*on));
                    "BOOLEAN"
                }
                PropValue::Text(text) => {
                    let tdef = self.sub(any_def, "textDataValue")?;
                    let t = self.text_value(tdef, None, text);
                    any.set(s, "textDataValue", Value::Msg(Box::new(t)));
                    "TEXT_DATA"
                }
                PropValue::Symbol(g) => {
                    let sdef = self.sub(any_def, "symbolIdValue")?;
                    let mut sym = Msg::new(sdef);
                    self.guid_field(&mut sym, "guid", *g);
                    any.set(s, "symbolIdValue", Value::Msg(Box::new(sym)));
                    "SYMBOL_ID"
                }
                PropValue::Other => return None,
            };
            data.set(s, "value", Value::Msg(Box::new(any)));
            let dt = self.enum_of(def, "dataType", kind)?;
            let rt = self.enum_of(def, "resolvedDataType", kind)?;
            data.set(s, "dataType", dt);
            data.set(s, "resolvedDataType", rt);
            Some(data)
        })();
        match built {
            Some(data) => {
                m.set(s, "varValue", Value::Msg(Box::new(data)));
            }
            None => m.remove(s, "varValue"),
        }
    }

    /// Writes an instance's component property values: each one the file
    /// has is updated in place; values no longer assigned are dropped.
    pub(super) fn prop_assignments(&self, m: &mut Msg, list: &[PropAssignment]) {
        let Some(def) = self.sub(m.def, "componentPropAssignments") else {
            return;
        };
        let existing = msgs(self, m, "componentPropAssignments");
        let mut out = Vec::with_capacity(list.len());
        for a in list {
            let found = existing
                .iter()
                .find(|e| read_guid(self, e, "defID") == Some(a.def_id))
                .cloned();
            if matches!(a.value, PropValue::Other) {
                // A kind of value the engine does not model: as it was.
                out.extend(found);
                continue;
            }
            let mut e = found.unwrap_or_else(|| {
                let mut e = Msg::new(def);
                self.guid_field(&mut e, "defID", a.def_id);
                e
            });
            self.prop_value(&mut e, "value", &a.value);
            self.var_value(&mut e, &a.value);
            out.push(e);
        }
        set_msgs(self, m, "componentPropAssignments", out);
    }

    /// A component's (or set's) property definitions, by id: existing
    /// entries keep their other fields; removed ones are marked deleted.
    fn prop_defs(&self, m: &mut Msg, defs: &[PropDef]) {
        let s = self.schema;
        let Some(def) = self.sub(m.def, "componentPropDefs") else {
            return;
        };
        let existing = msgs(self, m, "componentPropDefs");
        let mut last_sort = existing
            .iter()
            .filter_map(|e| read_str(self, e, "sortPosition"))
            .max()
            .unwrap_or("")
            .to_owned();
        let mut out = Vec::with_capacity(existing.len().max(defs.len()));
        for d in defs {
            let mut e = match existing
                .iter()
                .find(|e| read_guid(self, e, "id") == Some(d.id))
            {
                Some(e) => e.clone(),
                None => {
                    let mut e = Msg::new(def);
                    self.guid_field(&mut e, "id", d.id);
                    let sort = crate::edit::between(&last_sort, None)
                        .unwrap_or_else(|| format!("{last_sort}O"));
                    e.set(s, "sortPosition", Value::Str(sort.as_str().into()));
                    last_sort = sort;
                    e
                }
            };
            e.set(s, "name", Value::Str(d.name.as_str().into()));
            self.set_enum(&mut e, "type", &d.kind);
            e.remove(s, "isDeleted");
            if let Some(initial) = d.initial.as_ref().filter(|v| **v != PropValue::Other) {
                self.prop_value(&mut e, "initialValue", initial);
                self.var_value(&mut e, initial);
            }
            self.preferred_values(&mut e, d);
            out.push(e);
        }
        // Definitions removed here, and deleted ones the file keeps.
        for mut e in existing {
            let id = read_guid(self, &e, "id");
            if defs.iter().any(|d| Some(d.id) == id) {
                continue;
            }
            e.set(s, "isDeleted", Value::Bool(true));
            out.push(e);
        }
        set_msgs(self, m, "componentPropDefs", out);
    }

    fn preferred_values(&self, e: &mut Msg, d: &PropDef) {
        let s = self.schema;
        let Some(pdef) = self.sub(e.def, "preferredValues") else {
            return;
        };
        let mut pv = match e.get(s, "preferredValues") {
            Some(Value::Msg(p)) => (**p).clone(),
            _ => Msg::new(pdef),
        };
        let current = msgs(self, &pv, "instanceSwapValues");
        let keys: Vec<&str> = current
            .iter()
            .filter_map(|v| read_str(self, v, "key"))
            .collect();
        if keys.len() == d.preferred.len()
            && keys.iter().zip(d.preferred.iter()).all(|(a, b)| *a == &**b)
        {
            return;
        }
        let Some(vdef) = self.sub(pdef, "instanceSwapValues") else {
            return;
        };
        let list = d
            .preferred
            .iter()
            .map(|k| {
                current
                    .iter()
                    .find(|v| read_str(self, v, "key") == Some(k))
                    .cloned()
                    .unwrap_or_else(|| {
                        let mut v = Msg::new(vdef);
                        self.set_enum(&mut v, "type", "COMPONENT");
                        v.set(s, "key", Value::Str(k.as_ref().into()));
                        v
                    })
            })
            .collect();
        set_msgs(self, &mut pv, "instanceSwapValues", list);
        e.set(s, "preferredValues", Value::Msg(Box::new(pv)));
    }

    /// A layer's bindings to its component's properties. Bindings of fields
    /// the engine does not drive, and deleted ones, stay as they were.
    fn prop_refs(&self, m: &mut Msg, refs: &[PropRef]) {
        let Some(def) = self.sub(m.def, "componentPropRefs") else {
            return;
        };
        let existing = msgs(self, m, "componentPropRefs");
        let modeled = |e: &Msg| {
            read_bool(self, e, "isDeleted") != Some(true)
                && matches!(
                    read_enum(self, e, "componentPropNodeField"),
                    Some("VISIBLE" | "TEXT_DATA" | "OVERRIDDEN_SYMBOL_ID")
                )
        };
        let mut out: Vec<Msg> = existing.iter().filter(|e| !modeled(e)).cloned().collect();
        for r in refs {
            let Some(field) = field_name(r.field) else {
                continue;
            };
            let e = existing
                .iter()
                .find(|e| {
                    modeled(e)
                        && read_guid(self, e, "defID") == Some(r.def_id)
                        && read_enum(self, e, "componentPropNodeField") == Some(field)
                })
                .cloned()
                .unwrap_or_else(|| {
                    let mut e = Msg::new(def);
                    self.guid_field(&mut e, "defID", r.def_id);
                    self.set_enum(&mut e, "componentPropNodeField", field);
                    e
                });
            out.push(e);
        }
        set_msgs(self, m, "componentPropRefs", out);
    }

    /// [`flags::COMPONENT`]: the component and variant fields `p` sets.
    pub(super) fn component_fields(&self, m: &mut Msg, p: &Props, edits: u32) {
        let s = self.schema;
        if let Some(defs) = p.prop_defs.as_deref() {
            self.prop_defs(m, defs);
        }
        if let Some(refs) = p.prop_refs.as_deref() {
            self.prop_refs(m, refs);
        }
        if let Some(specs) = p.variant_specs.as_deref()
            && let Some(def) = self.sub(m.def, "variantPropSpecs")
        {
            let list = specs
                .iter()
                .map(|v| {
                    let mut e = Msg::new(def);
                    self.guid_field(&mut e, "propDefId", v.def_id);
                    e.set(s, "value", Value::Str(v.value.as_ref().into()));
                    e
                })
                .collect();
            set_msgs(self, m, "variantPropSpecs", list);
        }
        if let Some(orders) = p.variant_orders.as_deref()
            && let Some(def) = self.sub(m.def, "stateGroupPropertyValueOrders")
        {
            let list = orders
                .iter()
                .map(|o| {
                    let mut e = Msg::new(def);
                    e.set(s, "property", Value::Str(o.property.as_ref().into()));
                    e.set(
                        s,
                        "values",
                        Value::List(
                            o.values
                                .iter()
                                .map(|v| Value::Str(v.as_ref().into()))
                                .collect(),
                        ),
                    );
                    e
                })
                .collect();
            set_msgs(self, m, "stateGroupPropertyValueOrders", list);
        }
        if let Some(v) = p.is_state_group {
            m.set(s, "isStateGroup", Value::Bool(v));
        }
        if let Some(v) = p.props_bubbled {
            m.set(s, "propsAreBubbled", Value::Bool(v));
        }
        match p.swapped_symbol {
            Some(g) => self.guid_field(m, "overriddenSymbolID", g),
            // An instance swapped to another component shows it directly.
            None if edits & flags::INSTANCE_OF != 0 => m.remove(s, "overriddenSymbolID"),
            None => {}
        }
    }

    /// [`flags::STYLES`]: the shared styles `p` uses, and a style node's
    /// own details. Overrides (`guid_path` set) only add references; a
    /// layer's own record drops the ones it no longer uses.
    pub(super) fn style_fields(&self, m: &mut Msg, p: &Props) {
        let s = self.schema;
        let own = p.guid_path.is_none();
        for (field, legacy, value) in [
            ("styleIdForFill", "inheritFillStyleID", p.fill_style),
            (
                "styleIdForStrokeFill",
                "inheritFillStyleIDForStroke",
                p.stroke_style,
            ),
            ("styleIdForEffect", "inheritEffectStyleID", p.effect_style),
            ("styleIdForText", "inheritTextStyleID", p.text_style_id),
        ] {
            match value {
                Some(g) => {
                    if let Some(def) = self.sub(m.def, field) {
                        let mut id = Msg::new(def);
                        self.guid_field(&mut id, "guid", g);
                        m.set(s, field, Value::Msg(Box::new(id)));
                        m.remove(s, legacy);
                    } else {
                        self.guid_field(m, legacy, g);
                    }
                }
                None if own => {
                    m.remove(s, field);
                    m.remove(s, legacy);
                }
                None => {}
            }
        }
        if let Some(t) = p.style_type {
            self.set_enum(m, "styleType", t.name());
        }
        if let Some(sort) = &p.sort_position {
            m.set(s, "sortPosition", Value::Str(sort.as_ref().into()));
        }
        if let Some(v) = p.soft_deleted {
            m.set(s, "isSoftDeleted", Value::Bool(v));
        }
        if let Some(v) = p.internal_only {
            m.set(s, "internalOnly", Value::Bool(v));
        }
    }
}
