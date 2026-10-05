//! The file's variables for the design panel: collections with their modes
//! and variables (values per mode), the modes a frame picks, and the
//! variables a layer's paints are bound to.

use crate::document::{Document, NodeIdx};
use crate::model::{Guid, Paint, Props, VariableValue};
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Named {
    pub id: String,
    pub name: String,
}

/// A variable's value in one mode.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VariableValueInfo {
    /// `RRGGBB` and alpha, for colors.
    pub color: Option<String>,
    pub alpha: Option<f32>,
    pub number: Option<f32>,
    pub text: Option<String>,
    pub bool: Option<bool>,
    /// The variable this value is taken from.
    pub alias: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableInfo {
    pub id: String,
    pub name: String,
    /// `COLOR`, `FLOAT`, `STRING`, or `BOOLEAN`.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// One per mode of the collection, in its order.
    pub values: Vec<VariableValueInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub id: String,
    pub name: String,
    pub modes: Vec<Named>,
    pub variables: Vec<VariableInfo>,
    /// From a library.
    pub remote: bool,
}

/// A variable collection with several modes, and the one a frame picks.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeChoice {
    pub collection: Named,
    pub modes: Vec<Named>,
    /// Absent: the frame inherits its parent's.
    pub mode: Option<String>,
}

/// The variables a layer's paints are bound to, by paint.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoundVariables {
    pub fills: Vec<Option<Named>>,
    pub strokes: Vec<Option<Named>>,
}

fn named(doc: &Document, i: NodeIdx) -> Named {
    let p = doc.props(i);
    Named {
        id: p.guid.map(|g| g.to_string()).unwrap_or_default(),
        name: p.name().to_owned(),
    }
}

fn live(doc: &Document, i: NodeIdx) -> bool {
    !doc.node(i).removed && doc.props(i).soft_deleted != Some(true)
}

fn value_info(doc: &Document, v: Option<&VariableValue>) -> VariableValueInfo {
    match v {
        Some(VariableValue::Color(c)) => VariableValueInfo {
            color: Some(c.hex()),
            alpha: Some(c.a),
            ..VariableValueInfo::default()
        },
        Some(VariableValue::Float(f)) => VariableValueInfo {
            number: Some(*f),
            ..VariableValueInfo::default()
        },
        Some(VariableValue::Text(t)) => VariableValueInfo {
            text: Some(t.to_string()),
            ..VariableValueInfo::default()
        },
        Some(VariableValue::Bool(b)) => VariableValueInfo {
            bool: Some(*b),
            ..VariableValueInfo::default()
        },
        Some(VariableValue::Alias(g)) => VariableValueInfo {
            alias: doc
                .find(*g)
                .map(|i| doc.props(i).name().to_owned())
                .or_else(|| Some("Library variable".into())),
            ..VariableValueInfo::default()
        },
        _ => VariableValueInfo::default(),
    }
}

/// The file's variable collections (local ones first) and variables.
pub fn variables(doc: &Document) -> Vec<CollectionInfo> {
    let mut sets: Vec<(NodeIdx, CollectionInfo)> = Vec::new();
    for (i, n) in doc.nodes.iter().enumerate() {
        let i = i as NodeIdx;
        if let Some(modes) = &n.props.variable_modes
            && live(doc, i)
        {
            sets.push((
                i,
                CollectionInfo {
                    id: n.props.guid.map(|g| g.to_string()).unwrap_or_default(),
                    name: n.props.name().to_owned(),
                    modes: modes
                        .iter()
                        .map(|m| Named {
                            id: m.id.to_string(),
                            name: m.name.to_string(),
                        })
                        .collect(),
                    variables: Vec::new(),
                    remote: n.props.key.is_some(),
                },
            ));
        }
    }
    for (i, n) in doc.nodes.iter().enumerate() {
        let Some(v) = &n.props.variable else { continue };
        if !live(doc, i as NodeIdx) {
            continue;
        }
        let Some((set, info)) = sets
            .iter_mut()
            .find(|(s, _)| Some(doc.props(*s).guid) == Some(v.set))
        else {
            continue;
        };
        let modes = doc.props(*set).variable_modes.clone().unwrap_or_default();
        info.variables.push(VariableInfo {
            id: n.props.guid.map(|g| g.to_string()).unwrap_or_default(),
            name: n.props.name().to_owned(),
            kind: v.resolved_type.name(),
            values: modes
                .iter()
                .map(|m| {
                    value_info(
                        doc,
                        v.values.iter().find(|(id, _)| *id == m.id).map(|(_, x)| x),
                    )
                })
                .collect(),
        });
    }
    let mut out: Vec<CollectionInfo> = sets.into_iter().map(|(_, c)| c).collect();
    out.sort_by_key(|c| c.remote);
    out
}

/// The collections with several modes a frame (`p`, document node `i`)
/// can pick from.
pub fn mode_choices(doc: &Document, p: &Props) -> Vec<ModeChoice> {
    let picked = p.mode_by_set.as_deref().unwrap_or_default();
    doc.nodes
        .iter()
        .enumerate()
        .filter(|(i, n)| {
            live(doc, *i as NodeIdx) && n.props.variable_modes.as_ref().is_some_and(|m| m.len() > 1)
        })
        .map(|(i, n)| {
            let set = n.props.guid.unwrap_or_default();
            ModeChoice {
                collection: named(doc, i as NodeIdx),
                modes: n
                    .props
                    .variable_modes
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(|m| Named {
                        id: m.id.to_string(),
                        name: m.name.to_string(),
                    })
                    .collect(),
                mode: picked
                    .iter()
                    .find(|(c, _)| *c == set)
                    .map(|(_, m)| m.to_string()),
            }
        })
        .collect()
}

/// The variables `p`'s paints are bound to.
pub fn bound_variables(doc: &Document, p: &Props) -> BoundVariables {
    let names = |paints: &[Paint]| {
        paints
            .iter()
            .map(|x| {
                let g: Guid = x.color_var?;
                Some(match doc.find(g) {
                    Some(i) => named(doc, i),
                    None => Named {
                        id: g.to_string(),
                        name: "Library variable".into(),
                    },
                })
            })
            .collect()
    };
    BoundVariables {
        fills: names(p.fills()),
        strokes: names(p.strokes()),
    }
}
