//! Team libraries, as in Figma: a file publishes its components, component
//! sets, styles, and variables, and other files use them.
//!
//! Publishing ([`crate::edit::Op::PublishLibrary`]) gives each asset a key
//! and a version (a hash of its content, [`hash`]) and records what was
//! published on the document node, so the next publish can list what is
//! new, changed, or removed ([`status`]). Assets whose names start with `_`
//! or `.` are kept private, as in Figma: they get keys (files using a
//! published component need the components inside it) but are not listed.
//!
//! A file using a library reads its published assets ([`published`]) from
//! a second engine, asks it for a package of the assets it wants with
//! everything they use ([`package()`]), and copies them onto its internal
//! canvas ([`crate::edit::History::import_library`]): library components
//! become components there that keep their library key, source, and
//! version, which instances then show. [`uses`] lists those copies, so a
//! newer published version shows as an update.

use crate::document::{Document, NodeIdx};
use crate::model::{Guid, NodeType, PropValue, Props, StyleType, VariableValue};
use serde::{Deserialize, Serialize};

pub mod hash;
mod package;

pub use package::package;

/// The `macro_data` key of the libraries a file uses (on its document
/// node): a [`LibraryRef`] list as JSON.
pub const LIBRARIES_KEY: &str = "libraries";
/// The `macro_data` key of what a library last published (on its document
/// node): a [`Manifest`] as JSON.
pub const PUBLISHED_KEY: &str = "library";

/// What kind of asset a node is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssetKind {
    Component,
    ComponentSet,
    Style,
    Variable,
    Collection,
}

/// A library a file uses.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LibraryRef {
    /// The library's document id.
    pub id: String,
    pub name: String,
}

/// One asset as a publish recorded it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ManifestAsset {
    pub key: String,
    pub name: String,
    pub kind: AssetKind,
}

/// What a library last published: its assets and what the publisher said
/// changed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub assets: Vec<ManifestAsset>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Whether an asset named `name` stays private when its library is
/// published (Figma's `_` and `.` prefixes).
pub fn is_private(name: &str) -> bool {
    name.starts_with('_') || name.starts_with('.')
}

/// Whether `p` is a copy of another library's asset (Figma's, or Macro's).
pub fn is_copy(p: &Props) -> bool {
    p.library_source().is_some()
        || (p.key.is_some()
            && p.library
                .as_ref()
                .is_none_or(|l| l.published_version.is_none() && l.publishable != Some(true)))
}

/// The kind of asset `p` is, if any (copies from libraries included).
pub fn asset_kind(doc: &Document, i: NodeIdx) -> Option<AssetKind> {
    let p = doc.props(i);
    if p.node_type() == NodeType::Symbol {
        return Some(AssetKind::Component);
    }
    if p.is_state_group == Some(true) {
        return Some(AssetKind::ComponentSet);
    }
    if p.style_type.is_some_and(|t| t != StyleType::Other) {
        return Some(AssetKind::Style);
    }
    if p.variable.is_some() {
        return Some(AssetKind::Variable);
    }
    if p.variable_modes.is_some() {
        return Some(AssetKind::Collection);
    }
    None
}

/// The component set a variant is in.
pub(crate) fn set_of(doc: &Document, i: NodeIdx) -> Option<NodeIdx> {
    doc.node(i)
        .parent
        .filter(|&s| doc.props(s).is_state_group == Some(true))
}

/// The file's own assets (not copies of other libraries'): components and
/// component sets on its pages, and its styles and variables. Variants
/// come after their set.
pub fn local_assets(doc: &Document) -> Vec<(NodeIdx, AssetKind)> {
    let mut out = Vec::new();
    for &page in &doc.pages {
        let mut stack: Vec<NodeIdx> = doc.node(page).children.iter().rev().copied().collect();
        while let Some(i) = stack.pop() {
            if doc.node(i).removed {
                continue;
            }
            let p = doc.props(i);
            match asset_kind(doc, i) {
                Some(kind @ (AssetKind::Component | AssetKind::ComponentSet)) if !is_copy(p) => {
                    out.push((i, kind));
                }
                _ => {}
            }
            // Components hold no assets; instances show other files' ones.
            if !matches!(p.node_type(), NodeType::Symbol | NodeType::Instance) {
                stack.extend(doc.node(i).children.iter().rev().copied());
            }
        }
    }
    for (i, n) in doc.nodes.iter().enumerate() {
        let i = i as NodeIdx;
        if n.removed || n.props.soft_deleted == Some(true) || is_copy(&n.props) {
            continue;
        }
        if let Some(kind @ (AssetKind::Style | AssetKind::Variable | AssetKind::Collection)) =
            asset_kind(doc, i)
            && doc.page_of(i).is_some()
        {
            out.push((i, kind));
        }
    }
    out
}

/// Whether the asset at `i` is published (not private).
pub(crate) fn is_published_name(doc: &Document, i: NodeIdx) -> bool {
    let name = match set_of(doc, i) {
        Some(set) => doc.props(set).name(),
        None => doc.props(i).name(),
    };
    !is_private(name)
}

/// The library's last publish, from its document node.
pub fn manifest(doc: &Document) -> Option<Manifest> {
    let text = doc.props(doc.root).macro_value(PUBLISHED_KEY)?;
    serde_json::from_str(text).ok()
}

/// The libraries a file uses, from its document node.
pub fn enabled(doc: &Document) -> Vec<LibraryRef> {
    doc.props(doc.root)
        .macro_value(LIBRARIES_KEY)
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default()
}

/// How an asset differs from what the library last published.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Change {
    New,
    Changed,
    Removed,
}

/// One entry of "Changes to publish".
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetChange {
    pub key: Option<String>,
    /// The node, when it still exists.
    pub id: Option<String>,
    pub name: String,
    pub kind: AssetKind,
    pub change: Change,
    pub description: Option<String>,
    /// For a variant, its component set.
    pub set: Option<String>,
}

/// A library's publishing state (the "Publish library" dialog).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    /// Published at least once.
    pub published: bool,
    /// What would be published now, private assets left out.
    pub assets: usize,
    pub changes: Vec<AssetChange>,
    /// The note of the last publish.
    pub note: Option<String>,
}

fn guid_str(p: &Props) -> String {
    p.guid.map(|g| g.to_string()).unwrap_or_default()
}

/// What publishing the library now would change.
pub fn status(doc: &Document) -> LibraryStatus {
    let manifest = manifest(doc);
    let mut versions = hash::Versions::default();
    let mut changes = Vec::new();
    let mut live_keys = Vec::new();
    let mut count = 0;
    for (i, kind) in local_assets(doc) {
        if !is_published_name(doc, i) {
            continue;
        }
        count += 1;
        let p = doc.props(i);
        if let Some(k) = &p.key {
            live_keys.push(k.to_string());
        }
        let published = p.library.as_ref().and_then(|l| l.published_version.clone());
        let change = match published {
            None => Some(Change::New),
            Some(v) if *v != *versions.of(doc, i) => Some(Change::Changed),
            Some(_) => None,
        };
        // A variant's changes show as its set's.
        if let Some(change) = change
            && !(kind == AssetKind::Component && set_of(doc, i).is_some())
        {
            changes.push(AssetChange {
                key: p.key.as_deref().map(str::to_owned),
                id: Some(guid_str(p)),
                name: p.name().to_owned(),
                kind,
                change,
                description: p.description.as_deref().map(str::to_owned),
                set: None,
            });
        }
    }
    if let Some(m) = &manifest {
        for a in &m.assets {
            if !live_keys.contains(&a.key) {
                changes.push(AssetChange {
                    key: Some(a.key.clone()),
                    id: None,
                    name: a.name.clone(),
                    kind: a.kind,
                    change: Change::Removed,
                    description: None,
                    set: None,
                });
            }
        }
    }
    LibraryStatus {
        published: manifest.is_some(),
        assets: count,
        changes,
        note: manifest.and_then(|m| m.note),
    }
}

/// A published asset, for the files using the library.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedAsset {
    pub key: String,
    pub id: String,
    pub name: String,
    pub kind: AssetKind,
    /// The published version.
    pub version: String,
    pub description: Option<String>,
    /// For a variant: its component set's name and key.
    pub set: Option<String>,
    pub set_key: Option<String>,
    /// The page a component is on.
    pub page: Option<usize>,
    pub width: f64,
    pub height: f64,
    /// For a style: what it styles, and its paints, type, or effects.
    pub style: Option<crate::inspect::StyleInfo>,
    /// For a variable: its collection, type, and value in the first mode.
    pub variable: Option<VariableAsset>,
}

/// A published variable.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableAsset {
    pub collection: String,
    pub resolved_type: &'static str,
    /// `RRGGBBAA` for a color.
    pub color: Option<String>,
}

/// The library as last published: the note and every published asset.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedLibrary {
    pub published: bool,
    pub note: Option<String>,
    pub assets: Vec<PublishedAsset>,
}

/// The library's published assets (private ones and those never published
/// left out).
pub fn published(doc: &Document) -> PublishedLibrary {
    let mut styles: std::collections::HashMap<String, crate::inspect::StyleInfo> =
        crate::inspect::local_styles(doc)
            .into_iter()
            .map(|s| (s.id.clone(), s))
            .collect();
    let mut assets = Vec::new();
    for (i, kind) in local_assets(doc) {
        let p = doc.props(i);
        let (Some(key), Some(version)) = (
            p.key.as_deref(),
            p.library
                .as_ref()
                .and_then(|l| l.published_version.as_deref()),
        ) else {
            continue;
        };
        if !is_published_name(doc, i) {
            continue;
        }
        let set = set_of(doc, i);
        let id = guid_str(p);
        assets.push(PublishedAsset {
            key: key.to_owned(),
            name: p.name().to_owned(),
            kind,
            version: version.to_owned(),
            description: p.description.as_deref().map(str::to_owned),
            set: set.map(|s| doc.props(s).name().to_owned()),
            set_key: set.and_then(|s| doc.props(s).key.as_deref().map(str::to_owned)),
            page: doc
                .page_of(i)
                .and_then(|pg| doc.pages.iter().position(|&x| x == pg)),
            width: p.size().x,
            height: p.size().y,
            style: if kind == AssetKind::Style {
                styles.remove(&id)
            } else {
                None
            },
            variable: p.variable.as_ref().map(|v| VariableAsset {
                collection: v
                    .set
                    .and_then(|s| doc.find(s))
                    .map(|s| doc.props(s).name().to_owned())
                    .unwrap_or_default(),
                resolved_type: v.resolved_type.name(),
                color: v.values.first().and_then(|(_, value)| match value {
                    VariableValue::Color(c) => Some(c.hex()),
                    _ => None,
                }),
            }),
            id,
        });
    }
    let manifest = manifest(doc);
    PublishedLibrary {
        published: manifest.is_some(),
        note: manifest.and_then(|m| m.note),
        assets,
    }
}

/// A copy of a library asset in a file using it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCopy {
    pub key: String,
    pub id: String,
    pub name: String,
    pub kind: AssetKind,
    /// The library it came from (a Macro document id, or Figma's key).
    pub library: Option<String>,
    /// The version it was copied at.
    pub version: Option<String>,
    /// For a variant: its component set's key.
    pub set_key: Option<String>,
}

/// The libraries a file uses and the copies of their assets it holds.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUse {
    pub enabled: Vec<LibraryRef>,
    pub copies: Vec<LibraryCopy>,
}

/// What a file uses from libraries.
pub fn uses(doc: &Document) -> LibraryUse {
    let mut copies = Vec::new();
    for (i, n) in doc.nodes.iter().enumerate() {
        let i = i as NodeIdx;
        let p = &n.props;
        if n.removed || !is_copy(p) {
            continue;
        }
        let (Some(key), Some(kind)) = (p.key.as_deref(), asset_kind(doc, i)) else {
            continue;
        };
        copies.push(LibraryCopy {
            key: key.to_owned(),
            id: guid_str(p),
            name: p.name().to_owned(),
            kind,
            library: p.library_source().map(str::to_owned),
            version: p
                .library
                .as_ref()
                .and_then(|l| l.version.as_deref())
                .map(str::to_owned),
            set_key: set_of(doc, i).and_then(|s| doc.props(s).key.as_deref().map(str::to_owned)),
        });
    }
    LibraryUse {
        enabled: enabled(doc),
        copies,
    }
}

/// Scenes of the canvases thumbnails were drawn from, kept until the
/// document changes (a library's assets share a few canvases).
#[derive(Default)]
pub struct Thumbnails {
    scenes: Vec<(NodeIdx, crate::scene::Scene)>,
}

impl Thumbnails {
    /// Forgets the scenes (after an edit).
    pub fn clear(&mut self) {
        self.scenes.clear();
    }

    /// A PNG of the asset (or any layer) `id`, on whatever canvas it is
    /// (library copies live on the internal one), fitted in `size` pixels.
    pub fn render(
        &mut self,
        doc: &Document,
        images: &mut crate::images::ImageStore,
        id: Guid,
        size: u32,
    ) -> Option<Vec<u8>> {
        let i = doc.find(id)?;
        let canvas = doc.page_of(i)?;
        let k = match self.scenes.iter().position(|(c, _)| *c == canvas) {
            Some(k) => k,
            None => {
                self.scenes
                    .push((canvas, crate::scene::Scene::build(doc, canvas)));
                self.scenes.len() - 1
            }
        };
        let scene = &self.scenes[k].1;
        let at = scene.find(doc, &id.to_string())?;
        let bounds = scene.node(at).bounds;
        let longest = bounds.w.max(bounds.h);
        if longest <= 0.0 {
            return None;
        }
        let scale = (f64::from(size) / longest).min(4.0);
        let pixmap = crate::render::render_node(
            doc,
            scene,
            images,
            at,
            scale,
            crate::render::RenderOptions::default(),
        )?;
        Some(crate::images::encode_png(&pixmap))
    }
}

/// A PNG of the asset (or any layer) `id` (see [`Thumbnails::render`]).
pub fn thumbnail(
    doc: &Document,
    images: &mut crate::images::ImageStore,
    id: Guid,
    size: u32,
) -> Option<Vec<u8>> {
    Thumbnails::default().render(doc, images, id, size)
}

/// The ids of the components, styles, and variables `p` uses (its
/// instance's component, swaps, shared styles, bound variables, a
/// variable's collection and aliases), overrides included.
pub(crate) fn dependencies(p: &Props, out: &mut Vec<Guid>) {
    let mut add = |g: Option<Guid>| {
        if let Some(g) = g
            && !out.contains(&g)
        {
            out.push(g);
        }
    };
    add(p.symbol.as_ref().and_then(|s| s.symbol_id));
    add(p.swapped_symbol);
    add(p.fill_style);
    add(p.stroke_style);
    add(p.effect_style);
    add(p.text_style_id);
    for paint in p.fills().iter().chain(p.strokes()) {
        add(paint.color_var);
    }
    for a in p.prop_assignments.iter().flat_map(|a| a.iter()) {
        if let PropValue::Symbol(g) = a.value {
            add(Some(g));
        }
    }
    for d in p.prop_defs.iter().flat_map(|d| d.iter()) {
        if let Some(PropValue::Symbol(g)) = d.initial {
            add(Some(g));
        }
    }
    if let Some(v) = &p.variable {
        add(v.set);
        for (_, value) in v.values.iter() {
            if let VariableValue::Alias(g) = value {
                add(Some(*g));
            }
        }
    }
    for &(set, _) in p.mode_by_set.iter().flat_map(|m| m.iter()) {
        add(Some(set));
    }
    if let Some(s) = &p.symbol {
        for o in s.overrides.iter() {
            dependencies(o, out);
        }
    }
}

#[cfg(test)]
mod test;
