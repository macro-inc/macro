//! Variants: component sets ("Combine as variants"), adding variants and
//! variant properties, and changing their names and values.
//!
//! A variant's name (`Size=Large, State=Hover`) says its values, as in
//! Figma. Edits here change names, then [`Txn::sync_variants`] brings the
//! set's property definitions and value orders and the variants' specs in
//! line with them.

use crate::document::NodeIdx;
use crate::edit::{Txn, flags};
use crate::error::{FigError, Result};
use crate::model::{Color, NodeType, Paint, PropDef, StrokeAlign, VariantOrder, VariantSpec, Vec2};
use std::sync::Arc;

/// Space between a component set's edge and its variants.
const SET_PADDING: f64 = 20.0;
/// Figma's component set outline: dashed, in its component purple.
const SET_STROKE: Color = Color {
    r: 0x97 as f32 / 255.0,
    g: 0x47 as f32 / 255.0,
    b: 1.0,
    a: 1.0,
};

/// A variant's values from its name (`Size=Large, State=Hover`), or `None`
/// when the name does not have that form.
pub(crate) fn parse_variant_name(name: &str) -> Option<Vec<(String, String)>> {
    let mut out = Vec::new();
    for part in name.split(',') {
        let (k, v) = part.split_once('=')?;
        let (k, v) = (k.trim(), v.trim());
        if k.is_empty() {
            return None;
        }
        out.push((k.to_owned(), v.to_owned()));
    }
    (!out.is_empty()).then_some(out)
}

/// The name of a variant with these values.
pub(crate) fn variant_name(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn set_value(pairs: &mut Vec<(String, String)>, property: &str, value: &str) {
    match pairs.iter_mut().find(|(k, _)| k == property) {
        Some(p) => p.1 = value.to_owned(),
        None => pairs.push((property.to_owned(), value.to_owned())),
    }
}

/// Values for components combined into a set: their names' own values
/// when every name has them; otherwise the parts of their slash-separated
/// names after the shared ones (`Button/Primary` → `Property 1=Primary`).
/// Returns the set's name too.
fn combined_values(names: &[String]) -> (String, Vec<Vec<(String, String)>>) {
    let parsed: Option<Vec<_>> = names.iter().map(|n| parse_variant_name(n)).collect();
    let segments: Vec<Vec<&str>> = names
        .iter()
        .map(|n| n.split('/').map(str::trim).collect())
        .collect();
    let shared = (0..)
        .take_while(|&k| {
            let first = segments[0].get(k);
            first.is_some()
                && segments
                    .iter()
                    .all(|s| s.get(k) == first && s.len() > k + 1)
        })
        .count();
    let set_name = if names.len() == 1 && parsed.is_none() {
        names[0].clone()
    } else if shared > 0 {
        segments[0][..shared].join("/")
    } else {
        segments[0][0].to_owned()
    };
    if let Some(parsed) = parsed {
        return (set_name, parsed);
    }
    let values = segments
        .iter()
        .map(|s| {
            let rest: &[&str] = if s.len() > shared { &s[shared..] } else { s };
            rest.iter()
                .enumerate()
                .map(|(k, v)| (format!("Property {}", k + 1), (*v).to_owned()))
                .collect()
        })
        .collect();
    (set_name, values)
}

impl Txn<'_> {
    /// The live variants of a component set, in order.
    pub(super) fn variants_of(&self, set: NodeIdx) -> Vec<NodeIdx> {
        self.doc
            .node(set)
            .children
            .iter()
            .copied()
            .filter(|&c| {
                !self.doc.node(c).removed && self.doc.props(c).node_type() == NodeType::Symbol
            })
            .collect()
    }

    fn set_of(&self, variant: NodeIdx) -> Option<NodeIdx> {
        let p = self.doc.node(variant).parent?;
        (self.doc.props(p).is_state_group == Some(true)).then_some(p)
    }

    /// The variant in `component`'s set whose `property` is `value` and
    /// whose other values match `component`'s best.
    pub(super) fn variant_for(
        &self,
        component: NodeIdx,
        property: &str,
        value: &str,
    ) -> Option<NodeIdx> {
        let set = self.set_of(component)?;
        let mut want = parse_variant_name(self.doc.props(component).name()).unwrap_or_default();
        set_value(&mut want, property, value);
        self.variants_of(set)
            .into_iter()
            .filter_map(|v| {
                let pairs = parse_variant_name(self.doc.props(v).name())?;
                if !pairs.iter().any(|(k, x)| k == property && x == value) {
                    return None;
                }
                let score = want
                    .iter()
                    .filter(|(k, x)| pairs.iter().any(|(pk, px)| pk == k && px == x))
                    .count();
                Some((score, v))
            })
            // The best score; among equals the first variant.
            .fold(None, |best: Option<(usize, NodeIdx)>, (s, v)| match best {
                Some((bs, _)) if bs >= s => best,
                _ => Some((s, v)),
            })
            .map(|(_, v)| v)
    }

    /// "Combine as variants". Returns the new component set.
    pub(super) fn combine_as_variants(&mut self, ids: &[NodeIdx]) -> Result<Option<NodeIdx>> {
        let parent = ids.first().and_then(|&i| self.doc.node(i).parent);
        let components: Vec<NodeIdx> = ids
            .iter()
            .copied()
            .filter(|&i| {
                self.doc.props(i).node_type() == NodeType::Symbol
                    && self.doc.node(i).parent == parent
                    && self.set_of(i).is_none()
            })
            .collect();
        if components.is_empty() {
            return Err(FigError::Unsupported(
                "only components can be combined as variants".into(),
            ));
        }
        let names: Vec<String> = components
            .iter()
            .map(|&c| self.doc.props(c).name().to_owned())
            .collect();
        let (set_name, values) = combined_values(&names);
        let Some(set) = self.group(&components, true)? else {
            return Ok(None);
        };
        // Pad the set around its variants.
        self.translate(set, -SET_PADDING, -SET_PADDING);
        for &c in &components {
            self.translate(c, SET_PADDING, SET_PADDING);
        }
        let size = self.doc.props(set).size();
        let p = self.edit(
            set,
            flags::SIZE
                | flags::NAME
                | flags::STROKES
                | flags::STROKE_WEIGHT
                | flags::STROKE_ALIGN
                | flags::RADIUS
                | flags::COMPONENT,
        );
        p.size = Some(Vec2::new(
            size.x + 2.0 * SET_PADDING,
            size.y + 2.0 * SET_PADDING,
        ));
        p.name = Some(set_name.into());
        p.is_state_group = Some(true);
        p.strokes = Some(Arc::from([Paint::solid(SET_STROKE)]));
        p.stroke_weight = Some(1.0);
        p.stroke_align = Some(StrokeAlign::Inside);
        p.dash_pattern = Some(Arc::from([10.0, 5.0]));
        p.corner_radius = Some(5.0);
        // The components' own properties move to the set.
        let mut defs: Vec<PropDef> = Vec::new();
        for (&c, pairs) in components.iter().zip(&values) {
            let own = self.doc.props(c).prop_defs.clone();
            let p = self.edit(c, flags::NAME | flags::COMPONENT);
            p.name = Some(variant_name(pairs).into());
            if let Some(own) = own {
                p.prop_defs = Some(Arc::from([]));
                for d in own.iter() {
                    if !defs.iter().any(|e| e.id == d.id) {
                        defs.push(d.clone());
                    }
                }
            }
        }
        self.edit(set, flags::COMPONENT).prop_defs = Some(defs.into());
        self.sync_variants(set);
        Ok(Some(set))
    }

    /// Adds a variant to `set`: a copy of `from` (or the last variant)
    /// below the others, with a value of its first property no variant has.
    pub(super) fn add_variant(&mut self, set: NodeIdx, from: Option<NodeIdx>) -> Result<NodeIdx> {
        let variants = self.variants_of(set);
        let from = from
            .filter(|f| variants.contains(f))
            .or_else(|| variants.last().copied())
            .ok_or_else(|| FigError::Unsupported("the component set has no variants".into()))?;
        let lowest = variants
            .iter()
            .map(|&v| self.frame_bounds(v))
            .fold(f64::MIN, |acc, b| acc.max(b.y + b.h));
        let source = self.frame_bounds(from);
        let copy = self.copy_tree(from, set, self.doc.node(set).children.len());
        self.translate(copy, 0.0, lowest + SET_PADDING - source.y);
        let mut pairs = parse_variant_name(self.doc.props(from).name())
            .unwrap_or_else(|| vec![("Property 1".to_owned(), "Default".to_owned())]);
        let taken: Vec<String> = variants
            .iter()
            .map(|&v| self.doc.props(v).name().to_owned())
            .collect();
        let mut n = variants.len() + 1;
        loop {
            pairs[0].1 = format!("Variant{n}");
            if !taken.contains(&variant_name(&pairs)) {
                break;
            }
            n += 1;
        }
        let p = self.edit(copy, flags::NAME);
        p.name = Some(variant_name(&pairs).into());
        p.key = None;
        self.sync_variants(set);
        self.fit_set(set);
        let guid = self.doc.props(copy).guid.unwrap_or_default();
        self.created.push(guid.to_string());
        Ok(copy)
    }

    /// Grows a component set to hold its variants with its padding.
    fn fit_set(&mut self, set: NodeIdx) {
        let inv = self.doc.world(set).invert().unwrap_or_default();
        let mut far = self.doc.props(set).size();
        for v in self.variants_of(set) {
            let b = self.frame_bounds(v);
            let corner = inv.apply(Vec2::new(b.x + b.w, b.y + b.h));
            far.x = far.x.max(corner.x + SET_PADDING);
            far.y = far.y.max(corner.y + SET_PADDING);
        }
        if far != self.doc.props(set).size() {
            self.edit(set, flags::SIZE).size = Some(far);
        }
    }

    /// Renames each variant of `set` by `f` on its values.
    fn rename_variants(&mut self, set: NodeIdx, f: impl Fn(&mut Vec<(String, String)>)) {
        for v in self.variants_of(set) {
            let mut pairs = parse_variant_name(self.doc.props(v).name()).unwrap_or_default();
            f(&mut pairs);
            let name = variant_name(&pairs);
            if name != self.doc.props(v).name() {
                self.edit(v, flags::NAME).name = Some(name.into());
            }
        }
    }

    pub(super) fn add_variant_property(
        &mut self,
        set: NodeIdx,
        name: &str,
        value: &str,
    ) -> Result<()> {
        let set = self.as_set(set)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(FigError::Unsupported("a property needs a name".into()));
        }
        self.rename_variants(set, |pairs| {
            if !pairs.iter().any(|(k, _)| k == name) {
                pairs.push((name.to_owned(), value.trim().to_owned()));
            }
        });
        self.sync_variants(set);
        Ok(())
    }

    pub(super) fn rename_variant_property(
        &mut self,
        set: NodeIdx,
        from: &str,
        to: &str,
    ) -> Result<()> {
        let set = self.as_set(set)?;
        let to = to.trim();
        if to.is_empty() || to == from {
            return Ok(());
        }
        self.rename_variants(set, |pairs| {
            for (k, _) in pairs.iter_mut() {
                if k == from {
                    *k = to.to_owned();
                }
            }
        });
        // The definition keeps its id; its value order follows.
        let props = self.doc.props(set).clone();
        if let Some(defs) = props.prop_defs.as_deref() {
            let defs: Vec<PropDef> = defs
                .iter()
                .map(|d| {
                    let mut d = d.clone();
                    if d.kind == "VARIANT" && d.name == from {
                        d.name = to.to_owned();
                    }
                    d
                })
                .collect();
            self.edit(set, flags::COMPONENT).prop_defs = Some(defs.into());
        }
        if let Some(orders) = props.variant_orders.as_deref() {
            let orders: Vec<VariantOrder> = orders
                .iter()
                .map(|o| VariantOrder {
                    property: if o.property.as_ref() == from {
                        to.into()
                    } else {
                        o.property.clone()
                    },
                    values: o.values.clone(),
                })
                .collect();
            self.edit(set, flags::COMPONENT).variant_orders = Some(orders.into());
        }
        self.sync_variants(set);
        Ok(())
    }

    pub(super) fn remove_variant_property(&mut self, set: NodeIdx, name: &str) -> Result<()> {
        let set = self.as_set(set)?;
        self.rename_variants(set, |pairs| pairs.retain(|(k, _)| k != name));
        self.sync_variants(set);
        Ok(())
    }

    pub(super) fn set_variant_value(
        &mut self,
        variant: NodeIdx,
        property: &str,
        value: &str,
    ) -> Result<()> {
        let set = self
            .set_of(variant)
            .ok_or_else(|| FigError::Unsupported("the component is not a variant".into()))?;
        let mut pairs = parse_variant_name(self.doc.props(variant).name()).unwrap_or_default();
        set_value(&mut pairs, property, value.trim());
        self.edit(variant, flags::NAME).name = Some(variant_name(&pairs).into());
        self.sync_variants(set);
        Ok(())
    }

    /// The component set `i` is, or the one a variant `i` is in.
    fn as_set(&self, i: NodeIdx) -> Result<NodeIdx> {
        if self.doc.props(i).is_state_group == Some(true) {
            return Ok(i);
        }
        self.set_of(i)
            .ok_or_else(|| FigError::Unsupported("not a component set".into()))
    }

    /// Brings `set`'s variant property definitions and value orders, and
    /// its variants' specs, in line with the variants' names.
    pub(super) fn sync_variants(&mut self, set: NodeIdx) {
        let variants = self.variants_of(set);
        let named: Vec<(NodeIdx, Vec<(String, String)>)> = variants
            .iter()
            .map(|&v| {
                (
                    v,
                    parse_variant_name(self.doc.props(v).name()).unwrap_or_default(),
                )
            })
            .collect();
        let props = self.doc.props(set).clone();
        let old_defs: Vec<PropDef> = props.prop_defs.as_deref().unwrap_or_default().to_vec();
        let old_orders: Vec<VariantOrder> =
            props.variant_orders.as_deref().unwrap_or_default().to_vec();
        // Properties: in their current order, then new ones as named.
        let mut names: Vec<String> = Vec::new();
        for o in &old_orders {
            if named
                .iter()
                .any(|(_, p)| p.iter().any(|(k, _)| k == o.property.as_ref()))
            {
                names.push(o.property.to_string());
            }
        }
        for (_, pairs) in &named {
            for (k, _) in pairs {
                if !names.contains(k) {
                    names.push(k.clone());
                }
            }
        }
        let mut defs: Vec<PropDef> = old_defs
            .iter()
            .filter(|d| d.kind != "VARIANT")
            .cloned()
            .collect();
        let mut variant_defs = Vec::with_capacity(names.len());
        for name in &names {
            let def = match old_defs
                .iter()
                .find(|d| d.kind == "VARIANT" && &d.name == name)
            {
                Some(d) => d.clone(),
                None => PropDef {
                    id: self.doc.new_guid(),
                    name: name.clone(),
                    kind: "VARIANT".into(),
                    initial: None,
                    preferred: Arc::from([]),
                },
            };
            variant_defs.push(def);
        }
        // Variant properties come first, as Figma lists them.
        defs.splice(0..0, variant_defs.iter().cloned());
        let orders: Vec<VariantOrder> = names
            .iter()
            .map(|name| {
                let mut values: Vec<Arc<str>> = old_orders
                    .iter()
                    .find(|o| o.property.as_ref() == name)
                    .map(|o| o.values.to_vec())
                    .unwrap_or_default();
                let present: Vec<&str> = named
                    .iter()
                    .filter_map(|(_, p)| p.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str()))
                    .collect();
                values.retain(|v| present.contains(&v.as_ref()));
                for v in present {
                    if !values.iter().any(|x| x.as_ref() == v) {
                        values.push(v.into());
                    }
                }
                VariantOrder {
                    property: name.as_str().into(),
                    values: values.into(),
                }
            })
            .collect();
        if old_defs != defs {
            self.edit(set, flags::COMPONENT).prop_defs = Some(defs.into());
        }
        if old_orders != orders || props.variant_orders.is_none() {
            self.edit(set, flags::COMPONENT).variant_orders = Some(orders.into());
        }
        for (v, pairs) in named {
            let specs: Vec<VariantSpec> = pairs
                .iter()
                .filter_map(|(k, value)| {
                    let def = variant_defs.iter().find(|d| &d.name == k)?;
                    Some(VariantSpec {
                        def_id: def.id,
                        value: value.as_str().into(),
                    })
                })
                .collect();
            if self.doc.props(v).variant_specs.as_deref() != Some(specs.as_slice()) {
                self.edit(v, flags::COMPONENT).variant_specs = Some(specs.into());
            }
        }
    }

    /// Creates a component with one variant property: `component`
    /// becomes the only variant of a new set.
    pub(super) fn make_set(
        &mut self,
        component: NodeIdx,
        property: &str,
        value: &str,
    ) -> Result<NodeIdx> {
        let set = self
            .combine_as_variants(&[component])?
            .ok_or_else(|| FigError::Unsupported("the component has no size".into()))?;
        let name = variant_name(&[(property.to_owned(), value.to_owned())]);
        self.edit(component, flags::NAME).name = Some(name.into());
        self.sync_variants(set);
        Ok(set)
    }
}
