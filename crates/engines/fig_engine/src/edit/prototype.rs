//! Editing prototypes: a layer's interactions and a frame's flow starting
//! point, as the Prototype tab sets them.
//!
//! An interaction or action the editor sends back with an existing id keeps
//! what the editor does not show (easing, overlay offsets, URLs' tabs), so
//! changing a transition does not lose the rest.

use super::{Txn, between, flags};
use crate::document::NodeIdx;
use crate::error::{FigError, Result};
use crate::model::{Action, FlowStart, Guid, Interaction, NodeType};
use serde::Deserialize;
use std::sync::Arc;

/// An interaction as the editor describes it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSpec {
    /// The id of the interaction this one replaces; new ones get an id.
    pub id: Option<String>,
    /// `ON_CLICK` (the default), `ON_HOVER`, `AFTER_TIMEOUT`…
    pub trigger: Option<String>,
    /// Seconds, for `AFTER_TIMEOUT`.
    pub timeout: Option<f32>,
    pub actions: Vec<ActionSpec>,
}

/// An action as the editor describes it; absent fields keep the existing
/// action's (at the same index), or Figma's defaults for a new one.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSpec {
    /// `INTERNAL_NODE`, `BACK`, `CLOSE`, `URL`, or `NONE`.
    pub connection: Option<String>,
    /// `NAVIGATE`, `OVERLAY`, `SWAP`, or `SCROLL_TO`.
    pub navigation: Option<String>,
    /// The frame (or layer, for `SCROLL_TO`) it goes to.
    pub destination: Option<String>,
    /// `INSTANT_TRANSITION`, `DISSOLVE`, `SMART_ANIMATE`, `MOVE_IN`… as
    /// Figma names them (`MOVE_FROM_RIGHT`, `PUSH_FROM_LEFT`…).
    pub transition: Option<String>,
    /// Seconds.
    pub duration: Option<f32>,
    pub easing: Option<String>,
    pub url: Option<String>,
}

const CONNECTIONS: &[&str] = &["NONE", "INTERNAL_NODE", "URL", "BACK", "CLOSE"];
const NAVIGATIONS: &[&str] = &["NAVIGATE", "OVERLAY", "SWAP", "SWAP_STATE", "SCROLL_TO"];

fn one_of(value: &str, allowed: &[&str], what: &str) -> Result<Arc<str>> {
    if allowed.contains(&value) {
        Ok(value.into())
    } else {
        Err(FigError::Unsupported(format!("unknown {what} {value}")))
    }
}

/// Figma's enum names: capitals, digits, and underscores.
fn enum_name(value: &str, what: &str) -> Result<Arc<str>> {
    if !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    {
        Ok(value.into())
    } else {
        Err(FigError::Unsupported(format!("unknown {what} {value}")))
    }
}

impl Txn<'_> {
    fn node_guid(&self, id: &str) -> Result<Guid> {
        let i = self.resolve(id)?;
        self.doc
            .props(i)
            .guid
            .ok_or_else(|| FigError::NoSuchNode(id.into()))
    }

    fn action_from(&self, base: Option<&Action>, spec: &ActionSpec) -> Result<Action> {
        let mut a = match (base, &spec.destination) {
            (Some(a), _) => a.clone(),
            (None, Some(d)) => Action::navigate(self.node_guid(d)?),
            (None, None) => Action {
                destination: None,
                ..Action::navigate(Guid::default())
            },
        };
        if let Some(c) = &spec.connection {
            a.connection = one_of(c, CONNECTIONS, "connection")?;
        }
        if let Some(n) = &spec.navigation {
            a.navigation = one_of(n, NAVIGATIONS, "navigation")?;
        }
        if let Some(d) = &spec.destination {
            a.destination = Some(self.node_guid(d)?);
        }
        if let Some(t) = &spec.transition {
            a.transition = enum_name(t, "transition")?;
        }
        if let Some(d) = spec.duration {
            a.duration = d.clamp(0.0, 10.0);
        }
        if let Some(e) = &spec.easing {
            a.easing = Some(enum_name(e, "easing")?);
        }
        if let Some(u) = &spec.url {
            a.url = Some(u.as_str().into());
        }
        match a.connection.as_ref() {
            "INTERNAL_NODE" if a.destination.is_none() => {
                return Err(FigError::Unsupported(
                    "a connection needs a destination".into(),
                ));
            }
            "INTERNAL_NODE" => {}
            // Only internal connections go somewhere.
            _ => a.destination = None,
        }
        Ok(a)
    }

    /// Replaces the interactions of `i`.
    pub(super) fn set_interactions(&mut self, i: NodeIdx, specs: &[InteractionSpec]) -> Result<()> {
        let existing = self.doc.props(i).interactions.clone().unwrap_or_default();
        let mut out = Vec::with_capacity(specs.len());
        for spec in specs {
            let base = spec
                .id
                .as_deref()
                .and_then(Guid::parse)
                .and_then(|g| existing.iter().find(|e| e.id == Some(g)));
            let mut actions = Vec::with_capacity(spec.actions.len());
            for (k, a) in spec.actions.iter().enumerate() {
                actions.push(self.action_from(base.and_then(|b| b.actions.get(k)), a)?);
            }
            let id = match base.and_then(|b| b.id) {
                Some(id) => id,
                None => self.doc.new_guid(),
            };
            out.push(Interaction {
                id: Some(id),
                trigger: match &spec.trigger {
                    Some(t) => enum_name(t, "trigger")?,
                    None => base.map_or_else(|| "ON_CLICK".into(), |b| b.trigger.clone()),
                },
                timeout: spec.timeout.or(base.and_then(|b| b.timeout)),
                actions: actions.into(),
            });
        }
        self.edit(i, flags::PROTOTYPE).interactions = Some(out.into());
        Ok(())
    }

    /// Makes the top-level frame `i` a flow starting point named `name`
    /// (after the page's other flows), renames it, or (`None`) removes it.
    pub(super) fn set_flow_start(&mut self, i: NodeIdx, name: Option<&str>) -> Result<()> {
        let parent = self.doc.node(i).parent;
        if parent.is_none_or(|p| self.doc.props(p).node_type() != NodeType::Canvas) {
            return Err(FigError::Unsupported(
                "flows start at top-level frames".into(),
            ));
        }
        let Some(name) = name else {
            self.edit(i, flags::PROTOTYPE).flow_start = None;
            return Ok(());
        };
        let start = match self.doc.props(i).flow_start.as_deref() {
            Some(f) => FlowStart {
                name: name.into(),
                ..f.clone()
            },
            None => {
                let last = parent
                    .map(|p| self.doc.node(p).children.clone())
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|&c| self.doc.props(c).flow_start.as_ref())
                    .map(|f| f.position.clone())
                    .max();
                FlowStart {
                    name: name.into(),
                    description: "".into(),
                    position: between(last.as_deref().unwrap_or(""), None)
                        .unwrap_or_else(|| "!".into())
                        .into(),
                }
            }
        };
        self.edit(i, flags::PROTOTYPE).flow_start = Some(Arc::new(start));
        Ok(())
    }
}

#[cfg(test)]
mod test;
