//! A page's prototype, for presenting it and for the Prototype tab: its
//! flows, the frames that are screens, and every layer with interactions
//! (instance sublayers included, with their overrides applied).

use crate::document::Document;
use crate::model::{Action, Color, Interaction, NodeType, Rect, Vec2};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrototypeInfo {
    /// The page's start frame in files from before flows.
    pub start: Option<String>,
    /// Flow starting points, in Figma's order.
    pub flows: Vec<FlowInfo>,
    /// The screens: top-level frames (and frames directly in top-level
    /// sections), top-most last as on the page.
    pub frames: Vec<PrototypeFrame>,
    pub hotspots: Vec<Hotspot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowInfo {
    pub frame: String,
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrototypeFrame {
    pub id: String,
    pub name: String,
    pub bounds: Rect,
    pub overlay: Option<OverlayInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    pub position: String,
    pub close_on_click_outside: bool,
    /// `RRGGBBAA`.
    pub background: Option<String>,
}

/// A layer with interactions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotspot {
    pub id: String,
    pub name: String,
    /// The screen it is on.
    pub frame: String,
    /// Page coordinates.
    pub bounds: Rect,
    pub interactions: Vec<InteractionInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionInfo {
    pub id: Option<String>,
    pub trigger: String,
    pub timeout: Option<f32>,
    pub actions: Vec<ActionInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInfo {
    pub connection: String,
    pub navigation: String,
    pub destination: Option<String>,
    pub transition: String,
    pub duration: f32,
    pub easing: Option<String>,
    pub url: Option<String>,
    pub open_in_new_tab: Option<bool>,
    pub overlay_offset: Option<Vec2>,
}

fn hex(c: &Color) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("{:02X}{:02X}{:02X}{:02X}", b(c.r), b(c.g), b(c.b), b(c.a))
}

fn action_info(a: &Action) -> ActionInfo {
    ActionInfo {
        connection: a.connection.to_string(),
        navigation: a.navigation.to_string(),
        destination: a.destination.map(|g| g.to_string()),
        transition: a.transition.to_string(),
        duration: a.duration,
        easing: a.easing.as_deref().map(Into::into),
        url: a.url.as_deref().map(Into::into),
        open_in_new_tab: a.open_in_new_tab,
        overlay_offset: a.overlay_offset,
    }
}

pub fn interaction_info(i: &Interaction) -> InteractionInfo {
    InteractionInfo {
        id: i.id.map(|g| g.to_string()),
        trigger: i.trigger.to_string(),
        timeout: i.timeout,
        actions: i.actions.iter().map(action_info).collect(),
    }
}

/// The page's screens: frame-like top-level layers, and the frames directly
/// inside top-level sections.
pub fn screens(doc: &Document, scene: &Scene) -> Vec<SceneIdx> {
    let mut out = Vec::new();
    let visible = |i: SceneIdx| scene.props(doc, i).visible();
    for &c in &scene.node(scene.root()).children {
        if !visible(c) {
            continue;
        }
        let t = scene.props(doc, c).node_type();
        if t == NodeType::Section {
            out.extend(scene.node(c).children.iter().copied().filter(|&k| {
                visible(k)
                    && scene.props(doc, k).node_type().is_frame_like()
                    && scene.props(doc, k).node_type() != NodeType::Section
            }));
        } else if t.is_frame_like() {
            out.push(c);
        }
    }
    out
}

pub fn prototype(doc: &Document, scene: &Scene) -> PrototypeInfo {
    let page = scene.props(doc, scene.root());
    let screens = screens(doc, scene);
    let mut flows: Vec<(String, FlowInfo)> = screens
        .iter()
        .filter_map(|&i| {
            let f = scene.props(doc, i).flow_start.as_deref()?;
            Some((
                f.position.to_string(),
                FlowInfo {
                    frame: scene.id(doc, i),
                    name: f.name.to_string(),
                    description: f.description.to_string(),
                },
            ))
        })
        .collect();
    flows.sort_by(|a, b| a.0.cmp(&b.0));
    let frames = screens
        .iter()
        .map(|&i| {
            let p = scene.props(doc, i);
            PrototypeFrame {
                id: scene.id(doc, i),
                name: p.name().to_owned(),
                bounds: scene.frame_bounds(doc, i),
                overlay: p.overlay.as_deref().map(|o| OverlayInfo {
                    position: o.position.to_string(),
                    close_on_click_outside: o.close_on_click_outside,
                    background: o.background.as_ref().map(hex),
                }),
            }
        })
        .collect();
    let mut hotspots = Vec::new();
    for &screen in &screens {
        let screen_id = scene.id(doc, screen);
        let mut stack = vec![screen];
        while let Some(i) = stack.pop() {
            let p = scene.props(doc, i);
            if !p.visible() {
                continue;
            }
            let interactions: Vec<InteractionInfo> = p
                .interactions
                .as_deref()
                .unwrap_or_default()
                .iter()
                .filter(|i| !i.actions.is_empty())
                .map(interaction_info)
                .collect();
            if !interactions.is_empty() {
                hotspots.push(Hotspot {
                    id: scene.id(doc, i),
                    name: p.name().to_owned(),
                    frame: screen_id.clone(),
                    bounds: scene.frame_bounds(doc, i),
                    interactions,
                });
            }
            stack.extend(scene.node(i).children.iter().rev().copied());
        }
    }
    PrototypeInfo {
        start: page.prototype_start.map(|g| g.to_string()),
        flows: flows.into_iter().map(|(_, f)| f).collect(),
        frames,
        hotspots,
    }
}
