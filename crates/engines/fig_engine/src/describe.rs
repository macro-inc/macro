//! A design summarized for readers that cannot look at it: AI agents and
//! search. [`outline`] lists pages with their top-level frames (sections
//! with the frames in them), each frame's text and the components it uses,
//! and the file's components, styles, and variables. [`text_by_page`] is
//! the searchable text of every page.
//!
//! Both read the expanded scene, so text shown by instances (overrides and
//! text properties included) counts. Hidden layers are left out.

use crate::document::Document;
use crate::inspect;
use crate::model::{NodeType, Props, Vec2};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;
use std::collections::HashSet;

/// Default for [`OutlineOptions::max_chars`].
pub const DEFAULT_MAX_CHARS: usize = 100_000;

/// The most characters one text layer contributes to an outline.
pub const MAX_TEXT_LAYER_CHARS: usize = 2_000;

/// What [`outline`] covers.
#[derive(Clone, Debug)]
pub struct OutlineOptions {
    /// 1-based page numbers to describe; `None` for every page.
    pub pages: Option<Vec<usize>>,
    /// Roughly how many characters of names and text the outline holds;
    /// past it entries are left out and [`DesignOutline::truncated`] is set.
    pub max_chars: usize,
}

impl Default for OutlineOptions {
    fn default() -> Self {
        Self {
            pages: None,
            max_chars: DEFAULT_MAX_CHARS,
        }
    }
}

/// A design's pages, frames, text, and design system.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignOutline {
    /// The file name Figma saved, when the file has one.
    pub file_name: Option<String>,
    /// Pages in the file (described or not).
    pub page_count: usize,
    pub pages: Vec<PageOutline>,
    /// Main components and component sets on the described pages.
    pub components: Vec<ComponentOutline>,
    /// Shared styles (fill, text, effect, grid).
    pub styles: Vec<StyleOutline>,
    /// Variable collections.
    pub variables: Vec<VariableCollectionOutline>,
    /// Something was left out to stay within [`OutlineOptions::max_chars`].
    pub truncated: bool,
}

/// A page and its top-level layers.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOutline {
    /// 1-based position in the pages list.
    pub number: usize,
    /// Node id, as Figma writes it (`0:1`).
    pub id: String,
    pub name: String,
    /// Visible top-level layers, back to front.
    pub frames: Vec<FrameOutline>,
}

/// A top-level layer (or a frame directly in a top-level section).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameOutline {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    /// Page position and size.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Text in the layer, top to bottom then left to right; layers with the
    /// same text are listed once.
    pub texts: Vec<TextLayer>,
    /// Components its instances show, by how often.
    pub components: Vec<ComponentUse>,
    /// For sections: the frames in them.
    pub frames: Vec<FrameOutline>,
}

/// A text layer's content.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    /// The first layer with this text (`I…` ids are inside instances).
    pub id: String,
    pub name: String,
    pub characters: String,
    /// How many layers in the frame show this text.
    pub count: usize,
}

/// A component instances in a frame show.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUse {
    /// `Set / Variant` for variants.
    pub name: String,
    pub count: usize,
}

/// A main component or component set.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentOutline {
    pub id: String,
    pub name: String,
    /// The page it is on.
    pub page: String,
    pub is_set: bool,
    pub width: f64,
    pub height: f64,
    pub description: Option<String>,
    /// Boolean, text, and instance swap properties.
    pub properties: Vec<PropertyOutline>,
    /// For sets: variant properties and their values.
    pub variant_properties: Vec<VariantPropertyOutline>,
    /// For sets: the variants' names.
    pub variants: Vec<String>,
}

/// A component property and its default.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyOutline {
    pub name: String,
    /// `BOOL`, `TEXT`, or `INSTANCE_SWAP`.
    pub kind: String,
    pub default: Option<String>,
}

/// A component set's variant property.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantPropertyOutline {
    pub name: String,
    pub values: Vec<String>,
}

/// A shared style.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleOutline {
    pub name: String,
    /// `FILL`, `TEXT`, `EFFECT`, or `GRID`.
    #[serde(rename = "type")]
    pub style_type: &'static str,
    pub description: Option<String>,
    /// From a library.
    pub remote: bool,
}

/// A variable collection.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableCollectionOutline {
    pub name: String,
    pub modes: Vec<String>,
    pub variables: Vec<VariableOutline>,
    /// From a library.
    pub remote: bool,
}

/// A variable.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableOutline {
    pub name: String,
    /// `COLOR`, `FLOAT`, `STRING`, or `BOOLEAN`.
    #[serde(rename = "type")]
    pub kind: &'static str,
}

/// A page's searchable text.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    /// The page's node id, stable across saves.
    pub id: String,
    pub name: String,
    /// The page name, its frame names, and its text, one per line, each
    /// distinct line once.
    pub text: String,
}

/// Characters left for an outline.
struct Budget {
    left: usize,
    truncated: bool,
}

impl Budget {
    /// Spends `n` characters; false (and truncated) when they do not fit.
    fn take(&mut self, n: usize) -> bool {
        if n > self.left {
            self.left = 0;
            self.truncated = true;
            return false;
        }
        self.left -= n;
        true
    }
}

/// Describes the design (see the module comment).
pub fn outline(doc: &Document, options: &OutlineOptions) -> DesignOutline {
    let mut budget = Budget {
        left: options.max_chars,
        truncated: false,
    };
    let mut pages = Vec::new();
    let mut components = Vec::new();
    for (index, &page) in doc.pages.iter().enumerate() {
        let number = index + 1;
        if options
            .pages
            .as_ref()
            .is_some_and(|wanted| !wanted.contains(&number))
        {
            continue;
        }
        let scene = Scene::build(doc, page);
        let props = doc.props(page);
        budget.take(props.name().len());
        let mut frames = Vec::new();
        for &child in &scene.node(scene.root()).children {
            if budget.left == 0 {
                budget.truncated = true;
                break;
            }
            if let Some(frame) = frame_outline(doc, &scene, child, true, &mut budget) {
                frames.push(frame);
            }
        }
        pages.push(PageOutline {
            number,
            id: guid_string(props),
            name: props.name().to_owned(),
            frames,
        });
        page_components(doc, &scene, &mut components, &mut budget);
    }
    let styles = inspect::local_styles(doc)
        .into_iter()
        .filter(|s| budget.take(s.name.len()))
        .map(|s| StyleOutline {
            name: s.name,
            style_type: s.style_type.name(),
            description: s.description,
            remote: s.remote,
        })
        .collect();
    let mut variables = Vec::new();
    for c in inspect::variables(doc) {
        if !budget.take(c.name.len()) {
            break;
        }
        variables.push(VariableCollectionOutline {
            name: c.name,
            modes: c.modes.into_iter().map(|m| m.name).collect(),
            variables: c
                .variables
                .into_iter()
                .filter(|v| budget.take(v.name.len()))
                .map(|v| VariableOutline {
                    name: v.name,
                    kind: v.kind,
                })
                .collect(),
            remote: c.remote,
        });
    }
    DesignOutline {
        file_name: doc.file_name.clone(),
        page_count: doc.pages.len(),
        pages,
        components,
        styles,
        variables,
        truncated: budget.truncated,
    }
}

/// Every page's searchable text, in page order.
pub fn text_by_page(doc: &Document) -> Vec<PageText> {
    doc.pages
        .iter()
        .map(|&page| {
            let scene = Scene::build(doc, page);
            let props = doc.props(page);
            let mut seen = HashSet::new();
            let mut lines = Vec::new();
            let mut push = |line: &str| {
                let line = line.trim();
                if !line.is_empty() && seen.insert(line.to_owned()) {
                    lines.push(line.to_owned());
                }
            };
            push(props.name());
            let mut stack: Vec<(SceneIdx, usize)> = scene
                .node(scene.root())
                .children
                .iter()
                .rev()
                .map(|&c| (c, 0))
                .collect();
            while let Some((i, depth)) = stack.pop() {
                let p = scene.props(doc, i);
                if !p.visible() {
                    continue;
                }
                let named_frame = depth == 0
                    || (depth == 1
                        && p.node_type().is_frame_like()
                        && scene
                            .node(i)
                            .parent
                            .is_some_and(|parent| is_section(scene.props(doc, parent))));
                if named_frame {
                    push(p.name());
                }
                if let Some(text) = text_of(p) {
                    push(text);
                }
                let node = scene.node(i);
                let below: Vec<SceneIdx> = node.below().collect();
                stack.extend(below.into_iter().rev().map(|c| (c, depth + 1)));
            }
            PageText {
                id: guid_string(props),
                name: props.name().to_owned(),
                text: lines.join("\n"),
            }
        })
        .collect()
}

fn guid_string(props: &Props) -> String {
    props.guid.map(|g| g.to_string()).unwrap_or_default()
}

fn is_section(props: &Props) -> bool {
    props.node_type() == NodeType::Section
}

/// The characters of a text layer (or a FigJam object's generated text).
fn text_of(props: &Props) -> Option<&str> {
    props
        .text_content
        .as_ref()
        .map(|t| t.characters.as_ref())
        .filter(|t| !t.trim().is_empty())
}

/// The component an instance shows, as `Set / Variant` for variants.
fn main_component_name(doc: &Document, props: &Props) -> Option<String> {
    let id = props
        .swapped_symbol
        .or_else(|| props.symbol.as_ref().and_then(|s| s.symbol_id))?;
    let symbol = doc.find(id)?;
    let name = doc.props(symbol).name();
    Some(match doc.node(symbol).parent.map(|p| doc.props(p)) {
        Some(set) if set.is_state_group == Some(true) => format!("{} / {name}", set.name()),
        _ => name.to_owned(),
    })
}

/// What a frame's subtree collects.
#[derive(Default)]
struct Collected {
    /// `(y, x, layer)` for sorting into reading order.
    texts: Vec<(f64, f64, TextLayer)>,
    components: Vec<ComponentUse>,
    frames: Vec<FrameOutline>,
}

fn frame_outline(
    doc: &Document,
    scene: &Scene,
    i: SceneIdx,
    top_level: bool,
    budget: &mut Budget,
) -> Option<FrameOutline> {
    let props = scene.props(doc, i);
    if !props.visible() || !budget.take(props.name().len()) {
        return None;
    }
    let node = scene.node(i);
    let origin = node.world.apply(Vec2::default());
    let size = props.size();
    let mut collected = Collected::default();
    let sections_frames = top_level && is_section(props);
    collect(
        doc,
        scene,
        i,
        sections_frames,
        false,
        budget,
        &mut collected,
    );
    collected
        .texts
        .sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let texts = collected.texts.into_iter().map(|(_, _, t)| t).collect();
    collected
        .components
        .sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    Some(FrameOutline {
        id: scene.id(doc, i),
        name: props.name().to_owned(),
        node_type: props.node_type(),
        x: origin.x,
        y: origin.y,
        width: size.x,
        height: size.y,
        texts,
        components: collected.components,
        frames: collected.frames,
    })
}

/// Walks the layers below `i` (`i` included): text, and components of the
/// outermost instances. With `split_frames`, frame-like children become
/// frames of their own (a section's frames).
fn collect(
    doc: &Document,
    scene: &Scene,
    i: SceneIdx,
    split_frames: bool,
    in_instance: bool,
    budget: &mut Budget,
    out: &mut Collected,
) {
    let props = scene.props(doc, i);
    let mut in_instance = in_instance;
    if props.node_type() == NodeType::Instance && !in_instance {
        in_instance = true;
        if let Some(name) = main_component_name(doc, props) {
            match out.components.iter_mut().find(|c| c.name == name) {
                Some(used) => used.count += 1,
                None => {
                    if budget.take(name.len()) {
                        out.components.push(ComponentUse { name, count: 1 });
                    }
                }
            }
        }
    }
    if let Some(text) = text_of(props) {
        let known = out.texts.iter_mut().find(|t| t.2.characters == text);
        if let Some(known) = known {
            known.2.count += 1;
        } else {
            let characters = clip(text, MAX_TEXT_LAYER_CHARS, budget);
            if budget.take(characters.len() + props.name().len()) {
                let at = scene.node(i).world.apply(Vec2::default());
                out.texts.push((
                    at.y.round(),
                    at.x.round(),
                    TextLayer {
                        id: scene.id(doc, i),
                        name: props.name().to_owned(),
                        characters,
                        count: 1,
                    },
                ));
            }
        }
    }
    for c in scene.node(i).below() {
        let child = scene.props(doc, c);
        if !child.visible() || budget.left == 0 {
            continue;
        }
        if split_frames && child.node_type().is_frame_like() {
            if let Some(frame) = frame_outline(doc, scene, c, false, budget) {
                out.frames.push(frame);
            }
            continue;
        }
        collect(doc, scene, c, false, in_instance, budget, out);
    }
}

/// `text` cut to `max` characters (marking the outline truncated).
fn clip(text: &str, max: usize, budget: &mut Budget) -> String {
    match text.char_indices().nth(max) {
        Some((end, _)) => {
            budget.truncated = true;
            format!("{}…", &text[..end])
        }
        None => text.to_owned(),
    }
}

/// The main components and component sets on a page (not inside instances).
fn page_components(
    doc: &Document,
    scene: &Scene,
    out: &mut Vec<ComponentOutline>,
    budget: &mut Budget,
) {
    let page = doc.props(scene.page).name().to_owned();
    let mut stack: Vec<SceneIdx> = scene
        .node(scene.root())
        .children
        .iter()
        .rev()
        .copied()
        .collect();
    while let Some(i) = stack.pop() {
        let node = scene.node(i);
        if node.path.is_some() {
            continue;
        }
        let props = scene.props(doc, i);
        let is_set = props.is_state_group == Some(true);
        let is_component = props.node_type() == NodeType::Symbol;
        if is_set || is_component {
            if !budget.take(props.name().len()) {
                return;
            }
            out.push(component_outline(doc, scene, i, &page, is_set));
            // A set's variants are listed with it; components hold no
            // components of their own.
            continue;
        }
        if props.node_type() != NodeType::Instance {
            stack.extend(node.children.iter().rev().copied());
        }
    }
}

fn component_outline(
    doc: &Document,
    scene: &Scene,
    i: SceneIdx,
    page: &str,
    is_set: bool,
) -> ComponentOutline {
    let props = scene.props(doc, i);
    let panel = inspect::design_info(doc, scene, i).component;
    let (properties, variant_properties, variants) = match panel {
        Some(panel) => (
            panel
                .properties
                .into_iter()
                .map(|p| PropertyOutline {
                    default: p
                        .default
                        .text
                        .or(p.default.bool.map(|b| b.to_string()))
                        .or(p.default.component.map(|c| c.name)),
                    name: p.name,
                    kind: p.kind,
                })
                .collect(),
            panel
                .variant_properties
                .into_iter()
                .map(|v| VariantPropertyOutline {
                    name: v.name,
                    values: v.values,
                })
                .collect(),
            panel.variants.into_iter().map(|v| v.name).collect(),
        ),
        None => (Vec::new(), Vec::new(), Vec::new()),
    };
    let size = props.size();
    ComponentOutline {
        id: scene.id(doc, i),
        name: props.name().to_owned(),
        page: page.to_owned(),
        is_set,
        width: size.x,
        height: size.y,
        description: props
            .description
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .map(str::to_owned),
        properties,
        variant_properties,
        variants,
    }
}

#[cfg(test)]
mod test;
