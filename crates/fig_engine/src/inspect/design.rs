//! What the design panel shows of a file's design system: an instance's
//! component, variants, and property values; a main component's (or
//! component set's) properties and variant properties; a component layer's
//! bindings to properties; the shared styles a layer uses; and the file's
//! local styles.

use super::{EffectInfo, PaintInfo, effect_info, paint_info};
use crate::document::{Document, NodeIdx};
use crate::edit::{guid_of, parse_variant_name};
use crate::model::{
    Guid, NodeType, PropDef, PropField, PropValue, Props, StyleType, TextStyle, Vec2,
};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;
use std::collections::HashMap;

/// A component (or style) the panel names.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeRef {
    pub id: String,
    pub name: String,
}

/// A property value: one of the three set, by the property's kind.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValueInfo {
    pub bool: Option<bool>,
    pub text: Option<String>,
    pub component: Option<NodeRef>,
}

/// A variant property of an instance: its value and the values the
/// instance's component set offers.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantChoice {
    pub name: String,
    pub value: String,
    pub options: Vec<String>,
}

/// A boolean, text, or instance swap property of an instance.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceProperty {
    /// The definition's id, which edits name the property by.
    pub id: String,
    pub name: String,
    pub kind: String,
    pub value: ValueInfo,
    /// The instance sets its own value.
    pub changed: bool,
    /// Instance swap properties: the components offered first.
    pub preferred: Vec<NodeRef>,
}

/// An instance's properties (and an exposed nested instance's).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceProperties {
    /// The instance's layer id.
    pub id: String,
    pub name: String,
    pub variants: Vec<VariantChoice>,
    pub properties: Vec<InstanceProperty>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    /// The component it shows (a variant, for component sets).
    pub main: Option<NodeRef>,
    /// The component set it belongs to, when a variant.
    pub set: Option<NodeRef>,
    /// The page the main component is on (absent when it is not on a page,
    /// as for components from libraries).
    pub main_page: Option<usize>,
    #[serde(flatten)]
    pub own: InstanceProperties,
    /// Nested instances whose properties show here.
    pub nested: Vec<InstanceProperties>,
    /// The instance has overrides or property values to reset.
    pub changed: bool,
}

/// A property definition on a main component or component set.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDef {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub default: ValueInfo,
    /// Layers bound to it.
    pub bound: usize,
}

/// A component set's variant property.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantProperty {
    pub id: String,
    pub name: String,
    pub values: Vec<String>,
    /// The selected variant's value.
    pub value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPanel {
    /// Where the properties are defined: the component set for variants.
    pub owner: NodeRef,
    pub is_set: bool,
    pub is_variant: bool,
    pub variant_properties: Vec<VariantProperty>,
    pub properties: Vec<PropertyDef>,
    pub variants: Vec<NodeRef>,
}

/// A field of a main component's layer and the property it is bound to.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// `VISIBLE`, `TEXT`, or `INSTANCE_SWAP`.
    pub field: &'static str,
    /// The property kind that can drive it.
    pub kind: &'static str,
    pub property: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerBindings {
    pub owner: NodeRef,
    pub fields: Vec<Binding>,
    pub properties: Vec<PropertyDef>,
    /// For nested instances: whether their properties show on instances.
    pub exposed: Option<bool>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppliedStyles {
    pub fill: Option<NodeRef>,
    pub stroke: Option<NodeRef>,
    pub text: Option<NodeRef>,
    pub effect: Option<NodeRef>,
}

/// The design system side of a layer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignInfo {
    pub styles: AppliedStyles,
    pub instance: Option<InstanceInfo>,
    pub component: Option<ComponentPanel>,
    pub layer: Option<LayerBindings>,
    /// Frames (outside instances): the variable modes they can pick.
    pub modes: Vec<super::variables::ModeChoice>,
    /// The color variables the layer's paints are bound to.
    pub variables: super::variables::BoundVariables,
}

/// A shared style, for the local styles list and style pickers.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub style_type: StyleType,
    pub description: Option<String>,
    /// Imported from a library (not editable here).
    pub remote: bool,
    pub paints: Vec<PaintInfo>,
    pub effects: Vec<EffectInfo>,
    pub text: Option<TextStyle>,
}

fn node_ref(doc: &Document, i: NodeIdx) -> NodeRef {
    let p = doc.props(i);
    NodeRef {
        id: p.guid.map(|g| g.to_string()).unwrap_or_default(),
        name: p.name().to_owned(),
    }
}

fn find(doc: &Document, g: Guid) -> Option<NodeIdx> {
    doc.find(guid_of(doc, g)).filter(|&i| !doc.node(i).removed)
}

fn set_of(doc: &Document, component: NodeIdx) -> Option<NodeIdx> {
    let p = doc.node(component).parent?;
    (doc.props(p).is_state_group == Some(true)).then_some(p)
}

fn owner_of(doc: &Document, component: NodeIdx) -> NodeIdx {
    set_of(doc, component).unwrap_or(component)
}

fn value_info(doc: &Document, v: Option<&PropValue>) -> ValueInfo {
    match v {
        Some(PropValue::Bool(b)) => ValueInfo {
            bool: Some(*b),
            ..ValueInfo::default()
        },
        Some(PropValue::Text(t)) => ValueInfo {
            text: Some(t.to_string()),
            ..ValueInfo::default()
        },
        Some(PropValue::Symbol(g)) => ValueInfo {
            component: Some(match find(doc, *g) {
                Some(c) => node_ref(doc, c),
                None => NodeRef {
                    id: g.to_string(),
                    name: "Missing component".into(),
                },
            }),
            ..ValueInfo::default()
        },
        _ => ValueInfo::default(),
    }
}

/// The live variants of a set.
fn variants(doc: &Document, set: NodeIdx) -> Vec<NodeIdx> {
    doc.node(set)
        .children
        .iter()
        .copied()
        .filter(|&c| !doc.node(c).removed && doc.props(c).node_type() == NodeType::Symbol)
        .collect()
}

/// A set's variant properties and their values, in the set's order.
fn variant_values(doc: &Document, set: NodeIdx) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = doc
        .props(set)
        .variant_orders
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|o| {
            (
                o.property.to_string(),
                o.values.iter().map(|v| v.to_string()).collect(),
            )
        })
        .collect();
    for v in variants(doc, set) {
        for (k, value) in parse_variant_name(doc.props(v).name()).unwrap_or_default() {
            let k_at = match out.iter().position(|(n, _)| *n == k) {
                Some(at) => at,
                None => {
                    out.push((k, Vec::new()));
                    out.len() - 1
                }
            };
            if !out[k_at].1.contains(&value) {
                out[k_at].1.push(value);
            }
        }
    }
    // Values no variant has any more are not offered.
    let named: Vec<Vec<(String, String)>> = variants(doc, set)
        .into_iter()
        .map(|v| parse_variant_name(doc.props(v).name()).unwrap_or_default())
        .collect();
    for (k, values) in &mut out {
        values.retain(|v| {
            named
                .iter()
                .any(|p| p.iter().any(|(pk, pv)| pk == k && pv == v))
        });
    }
    out.retain(|(_, values)| !values.is_empty());
    out
}

struct Keys(HashMap<String, NodeIdx>);

impl Keys {
    fn new(doc: &Document) -> Keys {
        Keys(
            doc.nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| !n.removed && n.props.node_type() == NodeType::Symbol)
                .filter_map(|(i, n)| Some((n.props.key.as_deref()?.to_owned(), i as NodeIdx)))
                .collect(),
        )
    }
}

fn instance_properties(
    doc: &Document,
    scene: &Scene,
    i: SceneIdx,
    keys: &mut Option<Keys>,
) -> (InstanceProperties, Option<NodeIdx>) {
    let props = scene.props(doc, i);
    let component = props
        .swapped_symbol
        .or_else(|| props.symbol.as_ref().and_then(|s| s.symbol_id))
        .and_then(|g| find(doc, g));
    let mut out = InstanceProperties {
        id: scene.id(doc, i),
        name: props.name().to_owned(),
        variants: Vec::new(),
        properties: Vec::new(),
    };
    let Some(component) = component else {
        return (out, None);
    };
    if let Some(set) = set_of(doc, component) {
        let own = parse_variant_name(doc.props(component).name()).unwrap_or_default();
        out.variants = variant_values(doc, set)
            .into_iter()
            .map(|(name, options)| VariantChoice {
                value: own
                    .iter()
                    .find(|(k, _)| *k == name)
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default(),
                name,
                options,
            })
            .collect();
    }
    let owner = owner_of(doc, component);
    let assigned = props.prop_assignments.as_deref().unwrap_or_default();
    for d in doc.props(owner).prop_defs.as_deref().unwrap_or_default() {
        if !matches!(d.kind.as_str(), "BOOL" | "TEXT" | "INSTANCE_SWAP") {
            continue;
        }
        let own = assigned.iter().find(|a| a.def_id == d.id).map(|a| &a.value);
        let preferred = if d.preferred.is_empty() {
            Vec::new()
        } else {
            let keys = keys.get_or_insert_with(|| Keys::new(doc));
            d.preferred
                .iter()
                .filter_map(|k| keys.0.get(k.as_ref()))
                .map(|&c| node_ref(doc, c))
                .collect()
        };
        out.properties.push(InstanceProperty {
            id: d.id.to_string(),
            name: d.name.clone(),
            kind: d.kind.clone(),
            value: value_info(doc, own.or(d.initial.as_ref())),
            changed: own.is_some_and(|v| Some(v) != d.initial.as_ref()),
            preferred,
        });
    }
    (out, Some(component))
}

fn instance_info(doc: &Document, scene: &Scene, i: SceneIdx) -> InstanceInfo {
    let mut keys = None;
    let (own, component) = instance_properties(doc, scene, i, &mut keys);
    let depth = scene.node(i).path.as_ref().map_or(0, |(_, p)| p.len());
    // Exposed nested instances: layers of this instance's own component.
    let mut nested = Vec::new();
    let mut stack: Vec<SceneIdx> = scene.node(i).children.clone();
    while let Some(c) = stack.pop() {
        let node = scene.node(c);
        let Some((_, path)) = &node.path else {
            continue;
        };
        if path.len() != depth + 1 {
            continue;
        }
        let p = scene.props(doc, c);
        if p.node_type() == NodeType::Instance {
            if doc.props(node.src).props_bubbled == Some(true) {
                nested.push(instance_properties(doc, scene, c, &mut keys).0);
            }
        } else {
            stack.extend(node.children.iter().copied());
        }
    }
    nested.reverse();
    let props = scene.props(doc, i);
    let changed = props
        .prop_assignments
        .as_ref()
        .is_some_and(|a| !a.is_empty())
        || match &scene.node(i).path {
            None => props
                .symbol
                .as_ref()
                .is_some_and(|s| !s.overrides.is_empty()),
            Some(_) => props.swapped_symbol.is_some(),
        };
    let page_index = |c: NodeIdx| {
        let page = doc.page_of(c)?;
        doc.pages.iter().position(|&p| p == page)
    };
    InstanceInfo {
        main: component.map(|c| node_ref(doc, c)),
        set: component
            .and_then(|c| set_of(doc, c))
            .map(|s| node_ref(doc, s)),
        main_page: component.and_then(page_index),
        own,
        nested,
        changed,
    }
}

/// How many layers of `owner` are bound to each property.
fn bound_counts(doc: &Document, owner: NodeIdx) -> HashMap<Guid, usize> {
    let mut counts = HashMap::new();
    let mut stack = doc.node(owner).children.clone();
    while let Some(i) = stack.pop() {
        let node = doc.node(i);
        if node.removed {
            continue;
        }
        for r in node.props.prop_refs.as_deref().unwrap_or_default() {
            *counts.entry(r.def_id).or_insert(0) += 1;
        }
        stack.extend(node.children.iter().copied());
    }
    counts
}

fn property_defs(doc: &Document, owner: NodeIdx) -> Vec<PropertyDef> {
    let counts = bound_counts(doc, owner);
    doc.props(owner)
        .prop_defs
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|d| matches!(d.kind.as_str(), "BOOL" | "TEXT" | "INSTANCE_SWAP"))
        .map(|d: &PropDef| PropertyDef {
            id: d.id.to_string(),
            name: d.name.clone(),
            kind: d.kind.clone(),
            default: value_info(doc, d.initial.as_ref()),
            bound: counts.get(&d.id).copied().unwrap_or(0),
        })
        .collect()
}

fn component_panel(doc: &Document, i: NodeIdx) -> ComponentPanel {
    let is_set = doc.props(i).is_state_group == Some(true);
    let set = if is_set { Some(i) } else { set_of(doc, i) };
    let owner = set.unwrap_or(i);
    let own = (!is_set)
        .then(|| parse_variant_name(doc.props(i).name()))
        .flatten()
        .unwrap_or_default();
    let defs = doc.props(owner).prop_defs.as_deref().unwrap_or_default();
    let variant_properties = set
        .map(|s| {
            variant_values(doc, s)
                .into_iter()
                .map(|(name, values)| VariantProperty {
                    id: defs
                        .iter()
                        .find(|d| d.kind == "VARIANT" && d.name == name)
                        .map(|d| d.id.to_string())
                        .unwrap_or_default(),
                    value: own.iter().find(|(k, _)| *k == name).map(|(_, v)| v.clone()),
                    name,
                    values,
                })
                .collect()
        })
        .unwrap_or_default();
    ComponentPanel {
        owner: node_ref(doc, owner),
        is_set,
        is_variant: !is_set && set.is_some(),
        variant_properties,
        properties: property_defs(doc, owner),
        variants: set
            .map(|s| {
                variants(doc, s)
                    .into_iter()
                    .map(|v| node_ref(doc, v))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The main component (or set) a document layer is in, below it.
fn containing_component(doc: &Document, i: NodeIdx) -> Option<NodeIdx> {
    let mut at = doc.node(i).parent?;
    loop {
        let p = doc.props(at);
        if p.node_type() == NodeType::Symbol {
            return Some(at);
        }
        if matches!(p.node_type(), NodeType::Canvas | NodeType::Document) {
            return None;
        }
        at = doc.node(at).parent?;
    }
}

fn layer_bindings(doc: &Document, i: NodeIdx) -> Option<LayerBindings> {
    let component = containing_component(doc, i)?;
    let owner = owner_of(doc, component);
    let p = doc.props(i);
    let refs = p.prop_refs.as_deref().unwrap_or_default();
    let bound = |f: PropField| {
        refs.iter()
            .find(|r| r.field == f)
            .map(|r| r.def_id.to_string())
    };
    let mut fields = vec![Binding {
        field: "VISIBLE",
        kind: "BOOL",
        property: bound(PropField::Visible),
    }];
    match p.node_type() {
        NodeType::Text => fields.push(Binding {
            field: "TEXT",
            kind: "TEXT",
            property: bound(PropField::Text),
        }),
        NodeType::Instance => fields.push(Binding {
            field: "INSTANCE_SWAP",
            kind: "INSTANCE_SWAP",
            property: bound(PropField::SwappedSymbol),
        }),
        _ => {}
    }
    Some(LayerBindings {
        owner: node_ref(doc, owner),
        fields,
        properties: property_defs(doc, owner),
        exposed: (p.node_type() == NodeType::Instance).then(|| p.props_bubbled == Some(true)),
    })
}

fn applied_styles(doc: &Document, p: &Props) -> AppliedStyles {
    let style = |g: Option<Guid>| {
        let i = find(doc, g?)?;
        doc.props(i).style_type?;
        Some(node_ref(doc, i))
    };
    AppliedStyles {
        fill: style(p.fill_style),
        stroke: style(p.stroke_style),
        text: style(p.text_style_id),
        effect: style(p.effect_style),
    }
}

/// The design system side of scene node `i`.
pub fn design_info(doc: &Document, scene: &Scene, i: SceneIdx) -> DesignInfo {
    let props = scene.props(doc, i);
    let in_instance = scene.node(i).path.is_some();
    let src = scene.node(i).src;
    DesignInfo {
        styles: applied_styles(doc, props),
        instance: (props.node_type() == NodeType::Instance).then(|| instance_info(doc, scene, i)),
        component: (!in_instance
            && (props.node_type() == NodeType::Symbol || props.is_state_group == Some(true)))
        .then(|| component_panel(doc, src)),
        layer: (!in_instance && props.node_type() != NodeType::Symbol)
            .then(|| layer_bindings(doc, src))
            .flatten(),
        modes: if !in_instance && props.node_type().is_frame_like() {
            super::variables::mode_choices(doc, props)
        } else {
            Vec::new()
        },
        variables: super::variables::bound_variables(doc, props),
    }
}

/// The file's shared styles (deleted ones left out): local ones in their
/// order, then those from libraries by name.
pub fn local_styles(doc: &Document) -> Vec<StyleInfo> {
    let mut list: Vec<(bool, &str, &str, StyleInfo)> = doc
        .nodes
        .iter()
        .filter(|n| !n.removed && n.props.soft_deleted != Some(true))
        .filter_map(|n| {
            let p = &n.props;
            let style_type = p.style_type?;
            let remote = crate::library::is_copy(p);
            let size = Vec2::new(1.0, 1.0);
            Some((
                remote,
                p.sort_position.as_deref().unwrap_or(""),
                p.name(),
                StyleInfo {
                    id: p.guid.map(|g| g.to_string()).unwrap_or_default(),
                    name: p.name().to_owned(),
                    style_type,
                    description: p.description.as_deref().map(str::to_owned),
                    remote,
                    paints: match style_type {
                        StyleType::Fill => p.fills().iter().map(|f| paint_info(f, size)).collect(),
                        _ => Vec::new(),
                    },
                    effects: match style_type {
                        StyleType::Effect => p.effects().iter().map(effect_info).collect(),
                        _ => Vec::new(),
                    },
                    text: (style_type == StyleType::Text)
                        .then(|| p.text_style.as_deref().cloned().unwrap_or_default()),
                },
            ))
        })
        .collect();
    list.sort_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| {
            if a.0 {
                a.2.cmp(b.2)
            } else {
                a.1.cmp(b.1).then(a.2.cmp(b.2))
            }
        })
    });
    list.into_iter().map(|(.., s)| s).collect()
}

#[cfg(test)]
mod test;
