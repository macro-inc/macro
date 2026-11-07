//! Laying out text the editor changed.
//!
//! Text in a `.fig` file comes with Figma's own glyph layout, which the
//! renderer draws as is. When an edit changes a text layer's characters,
//! styles, or size, the engine lays it out again here with the layer's own
//! fonts when they are registered ([`register_font`]; variable fonts are set
//! to the style's weight, slant, and width), or the bundled Inter (Figma's
//! default) in their place: greedy word wrap, explicit line breaks,
//! alignment, line height, letter spacing, case, and pair kerning, with
//! every character in its own style (Figma's `characterStyleIDs` and
//! `styleOverrideTable`). Glyph outlines are stored as blobs in em units,
//! y up, exactly as Figma stores them, so drawing and saving need nothing
//! new.

mod caret;
mod font;
mod layout;
mod woff;

use crate::document::{Document, NodeIdx};
use crate::error::Result;
use crate::model::{NodeType, Paint, Props, StyleRun, TextContent, TextStyle};
use layout::AutoResize;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Arc;

pub use caret::{CaretLine, TextGeometry, geometry};
pub use font::{
    DEFAULT_FAMILY, FaceSource, Font, FontGlyph, FontStatus, RegisteredFace, StyleRequest,
    face_source, family_and_style, font_status, parse_style, postscript_face, register_font,
    registered, style_name,
};

/// Whether text in `family` can be laid out with that family's own font
/// (otherwise Inter stands in).
pub fn has_font(family: &str) -> bool {
    font_status(family, "Regular") != FontStatus::Missing
}

/// A text change: any of the characters and the style. Without a `range`
/// style fields apply to every character, as in Figma's design panel, so
/// they replace per-character overrides of the same property; with one,
/// only the characters in it change.
#[derive(Clone, Debug, Default)]
pub struct Change<'a> {
    pub characters: Option<&'a str>,
    pub font_family: Option<&'a str>,
    pub font_style: Option<&'a str>,
    pub font_size: Option<f32>,
    /// `(value, "PIXELS" | "PERCENT" | "RAW")`, as stored in files.
    pub line_height: Option<(f32, &'a str)>,
    pub letter_spacing: Option<(f32, &'a str)>,
    pub paragraph_spacing: Option<f32>,
    pub align_horizontal: Option<&'a str>,
    pub align_vertical: Option<&'a str>,
    pub auto_resize: Option<&'a str>,
    pub decoration: Option<&'a str>,
    pub case: Option<&'a str>,
    /// Characters (UTF-16 units, `start..end`) the style fields apply to.
    pub range: Option<(u32, u32)>,
    /// Paints for the characters in `range`.
    pub fills: Option<Arc<[Paint]>>,
}

/// Re-lays out text layer `i` after a [`Change`]. Per-character styles
/// follow the characters they were on: typed characters take the style of
/// the character before them, as in Figma.
pub fn edit(doc: &mut Document, i: NodeIdx, change: &Change) -> Result<()> {
    let mut props = doc.props(i).clone();
    edit_props(doc, &mut props, change)?;
    let node = &mut doc.nodes[i as usize];
    node.props.text_content = props.text_content;
    node.props.text_style = props.text_style;
    node.props.text_layout = props.text_layout;
    node.props.size = props.size;
    Ok(())
}

/// The paints of the character at `unit` (its style's, else the layer's).
pub fn fills_at(props: &Props, unit: u32) -> Arc<[Paint]> {
    let run = props.text_content.as_deref().and_then(|c| {
        let id = c.style_ids.get(unit as usize).copied().unwrap_or(0);
        (id != 0)
            .then(|| c.styles.iter().find(|r| r.id == id))
            .flatten()
    });
    run.and_then(|r| r.fills.clone())
        .unwrap_or_else(|| Arc::from(props.fills()))
}

/// [`edit`] on a node's properties (a text layer in an instance, say);
/// sets its text fields and size. Glyph outlines go in `doc`'s blobs.
pub fn edit_props(doc: &mut Document, props: &mut Props, change: &Change) -> Result<()> {
    let mut style = props.text_style.as_deref().cloned().unwrap_or_default();
    let mut content = props.text_content.as_deref().cloned().unwrap_or_default();
    if style.font_family.is_none() {
        style.font_family = Some(DEFAULT_FAMILY.into());
        style.font_style = Some("Regular".into());
    }
    if let Some(chars) = change.characters {
        content.style_ids = remap_styles(&content.characters, &content.style_ids, chars).into();
        content.characters = chars.into();
    }
    let len = content.characters.encode_utf16().count() as u32;
    match change.range {
        Some((start, end)) if start < end.min(len) => {
            style_range(
                &mut content,
                &style,
                props.fills(),
                (start, end.min(len)),
                change,
            );
        }
        Some(_) => {}
        None => set_style(&mut content, &mut style, change),
    }
    let set = |slot: &mut Option<String>, v: Option<&str>| {
        if let Some(v) = v {
            *slot = Some(v.into());
        }
    };
    set(&mut style.align_horizontal, change.align_horizontal);
    set(&mut style.align_vertical, change.align_vertical);
    set(&mut style.auto_resize, change.auto_resize);
    if let Some(p) = change.paragraph_spacing {
        style.paragraph_spacing = Some(p.max(0.0));
    }
    let auto = match style.auto_resize.as_deref() {
        Some("HEIGHT") => AutoResize::Height,
        Some("NONE") | Some("TRUNCATE") => AutoResize::None,
        Some("WIDTH_AND_HEIGHT") => AutoResize::WidthAndHeight,
        // New text grows in both directions until given a width.
        _ if props.text_layout.is_none() => AutoResize::WidthAndHeight,
        _ => AutoResize::None,
    };
    if style.auto_resize.is_none() && auto == AutoResize::WidthAndHeight {
        style.auto_resize = Some("WIDTH_AND_HEIGHT".into());
    }
    let size = props.size();
    let (layout, box_size) = layout::layout(doc, &content, &style, size, auto);
    props.text_content = Some(Arc::new(content));
    props.text_style = Some(Arc::new(style));
    props.text_layout = Some(Arc::new(layout));
    props.size = Some(box_size);
    Ok(())
}

/// Applies the style fields of `change` to the whole layer: the node's
/// style takes them, and character overrides of the same properties go.
fn set_style(content: &mut TextContent, style: &mut TextStyle, change: &Change) {
    let mut runs: Vec<StyleRun> = content.styles.to_vec();
    if let Some(fs) = change.font_size {
        style.font_size = Some(fs.max(1.0));
        runs.iter_mut().for_each(|r| r.font_size = None);
    }
    if let Some(f) = change.font_family {
        style.font_family = Some(f.into());
        runs.iter_mut().for_each(|r| r.font_family = None);
    }
    if let Some(s) = change.font_style {
        style.font_style = Some(s.into());
        runs.iter_mut().for_each(|r| r.font_style = None);
    }
    if change.font_family.is_some() || change.font_style.is_some() {
        // A run's style name is meaningless in another family, and vice versa.
        for r in &mut runs {
            if r.font_family.is_none() || r.font_style.is_none() {
                r.font_family = None;
                r.font_style = None;
            }
        }
    }
    if let Some(d) = change.decoration {
        style.decoration = (d != "NONE").then(|| d.into());
        runs.iter_mut().for_each(|r| r.decoration = None);
    }
    if let Some(c) = change.case {
        style.case = (c != "ORIGINAL").then(|| c.into());
        runs.iter_mut().for_each(|r| r.case = None);
    }
    if let Some((v, u)) = change.line_height {
        style.line_height = Some((v, u.into()));
        runs.iter_mut().for_each(|r| r.line_height = None);
    }
    if let Some((v, u)) = change.letter_spacing {
        style.letter_spacing = Some((v, u.into()));
        runs.iter_mut().for_each(|r| r.letter_spacing = None);
    }
    if change.fills.is_some() {
        runs.iter_mut().for_each(|r| r.fills = None);
    }
    content.styles = runs.into();
    normalize(content);
}

/// Applies the style fields of `change` to the characters in `range`,
/// giving them style runs (shared with other characters styled alike).
fn style_range(
    content: &mut TextContent,
    style: &TextStyle,
    fills: &[Paint],
    (start, end): (u32, u32),
    change: &Change,
) {
    let len = content.characters.encode_utf16().count();
    let mut ids: Vec<u32> = content.style_ids.to_vec();
    ids.resize(len.max(ids.len()), 0);
    let mut runs: Vec<StyleRun> = content.styles.to_vec();
    let mut next_id = runs.iter().map(|r| r.id).max().unwrap_or(0) + 1;
    // The run each old id becomes, so characters styled alike stay alike.
    let mut mapped: BTreeMap<u32, u32> = BTreeMap::new();
    // Runs used only inside the range change in place, keeping their ids.
    let (s, e) = (start as usize, end as usize);
    let outside: std::collections::BTreeSet<u32> =
        ids[..s].iter().chain(&ids[e..]).copied().collect();
    for id in &mut ids[s..e] {
        if let Some(&to) = mapped.get(id) {
            *id = to;
            continue;
        }
        let mut run = runs
            .iter()
            .find(|r| r.id == *id && *id != 0)
            .cloned()
            .unwrap_or_default();
        apply(&mut run, style, fills, change);
        let to = if run.is_plain() {
            0
        } else if let Some(same) = runs.iter().find(|r| {
            r.id != 0
                && StyleRun {
                    id: r.id,
                    ..run.clone()
                } == **r
        }) {
            same.id
        } else if *id != 0
            && !outside.contains(id)
            && let Some(slot) = runs.iter_mut().find(|r| r.id == *id)
        {
            run.id = *id;
            *slot = run;
            *id
        } else {
            run.id = next_id;
            next_id += 1;
            runs.push(run.clone());
            run.id
        };
        mapped.insert(*id, to);
        *id = to;
    }
    content.style_ids = ids.into();
    content.styles = runs.into();
    normalize(content);
}

/// Sets `change`'s style fields on a run, dropping values the layer
/// already has (so they follow it).
fn apply(run: &mut StyleRun, style: &TextStyle, fills: &[Paint], change: &Change) {
    let base_family = style.font_family.as_deref().unwrap_or(DEFAULT_FAMILY);
    let base_style = style.font_style.as_deref().unwrap_or("Regular");
    if let Some(f) = change.font_family {
        run.font_family = Some(f.into());
        if change.font_style.is_none() && run.font_style.is_none() {
            run.font_style = Some(base_style.into());
        }
    }
    if let Some(s) = change.font_style {
        run.font_style = Some(s.into());
        if run.font_family.is_none() {
            run.font_family = Some(base_family.into());
        }
    }
    if run.font_family.as_deref() == Some(base_family)
        && run.font_style.as_deref() == Some(base_style)
    {
        run.font_family = None;
        run.font_style = None;
    }
    if let Some(fs) = change.font_size {
        let fs = fs.max(1.0);
        run.font_size = (Some(fs) != style.font_size).then_some(fs);
    }
    if let Some(d) = change.decoration {
        let base = style.decoration.as_deref().unwrap_or("NONE");
        run.decoration = (d != base).then(|| d.into());
    }
    if let Some(c) = change.case {
        let base = style.case.as_deref().unwrap_or("ORIGINAL");
        run.case = (c != base).then(|| c.into());
    }
    let measure = |(v, u): (f32, &str), base: &Option<(f32, String)>| {
        (base.as_ref() != Some(&(v, u.to_string()))).then(|| (v, Arc::from(u)))
    };
    if let Some(lh) = change.line_height {
        run.line_height = measure(lh, &style.line_height);
    }
    if let Some(ls) = change.letter_spacing {
        run.letter_spacing = measure(ls, &style.letter_spacing);
    }
    if let Some(f) = &change.fills {
        run.fills = (**f != *fills).then(|| f.clone());
    }
}

/// Drops style runs no character uses, plain runs, and trailing base
/// styles.
fn normalize(content: &mut TextContent) {
    let plain: Vec<u32> = content
        .styles
        .iter()
        .filter(|r| r.is_plain())
        .map(|r| r.id)
        .collect();
    let mut ids: Vec<u32> = content
        .style_ids
        .iter()
        .map(|id| if plain.contains(id) { 0 } else { *id })
        .collect();
    while ids.last() == Some(&0) {
        ids.pop();
    }
    let runs: Vec<StyleRun> = content
        .styles
        .iter()
        .filter(|r| !r.is_plain() && ids.contains(&r.id))
        .cloned()
        .collect();
    if runs.len() != content.styles.len() || ids.len() != content.style_ids.len() {
        content.styles = runs.into();
        content.style_ids = ids.into();
    }
}

/// Style ids for `new` given `old` text and its ids (UTF-16 units): the
/// unchanged start and end keep theirs; what was typed between takes the
/// style before it.
fn remap_styles(old: &str, ids: &[u32], new: &str) -> Vec<u32> {
    if ids.is_empty() {
        return Vec::new();
    }
    let a: Vec<u16> = old.encode_utf16().collect();
    let b: Vec<u16> = new.encode_utf16().collect();
    let id = |k: usize| ids.get(k).copied().unwrap_or(0);
    let prefix = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let max_suffix = a.len().min(b.len()) - prefix;
    let suffix = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take(max_suffix)
        .take_while(|(x, y)| x == y)
        .count();
    let typed = if prefix > 0 { id(prefix - 1) } else { id(0) };
    let mut out: Vec<u32> = (0..prefix).map(id).collect();
    out.extend(std::iter::repeat_n(typed, b.len() - prefix - suffix));
    out.extend((a.len() - suffix..a.len()).map(id));
    while out.last() == Some(&0) {
        out.pop();
    }
    out
}

/// A family and style the document's text uses.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontUse {
    pub family: String,
    pub style: String,
    /// Text layers using it.
    pub layers: u32,
    pub status: FontStatus,
}

/// The fonts text in the document uses (layer styles and character
/// styles, instance overrides included), most used first, with whether
/// each can be laid out in its own font.
pub fn document_fonts(doc: &Document) -> Vec<FontUse> {
    let mut uses: BTreeMap<(String, String), u32> = BTreeMap::new();
    let mut note = |props: &Props| {
        let mut seen: Vec<(String, String)> = Vec::new();
        let base = props.text_style.as_deref();
        let family = base
            .and_then(|s| s.font_family.clone())
            .unwrap_or_else(|| DEFAULT_FAMILY.into());
        let style = base
            .and_then(|s| s.font_style.clone())
            .unwrap_or_else(|| "Regular".into());
        if props.text_style.is_some() || props.node_type() == NodeType::Text {
            seen.push((family.clone(), style.clone()));
        }
        for run in props.text_content.iter().flat_map(|c| c.styles.iter()) {
            if run.font_family.is_some() || run.font_style.is_some() {
                seen.push((
                    run.font_family
                        .as_deref()
                        .map_or(family.clone(), str::to_string),
                    run.font_style
                        .as_deref()
                        .map_or(style.clone(), str::to_string),
                ));
            }
        }
        seen.sort();
        seen.dedup();
        for key in seen {
            *uses.entry(key).or_default() += 1;
        }
    };
    for node in &doc.nodes {
        if node.removed {
            continue;
        }
        if node.props.node_type() == NodeType::Text {
            note(&node.props);
        }
        if let Some(symbol) = node.props.symbol.as_deref() {
            for o in symbol.overrides.iter() {
                if o.text_style.is_some() || o.text_content.is_some() {
                    let p = Props {
                        text_style: o.text_style.clone(),
                        text_content: o.text_content.clone(),
                        ..Props::default()
                    };
                    note(&p);
                }
            }
        }
    }
    let mut out: Vec<FontUse> = uses
        .into_iter()
        .map(|((family, style), layers)| FontUse {
            status: font_status(&family, &style),
            family,
            style,
            layers,
        })
        .collect();
    out.sort_by(|a, b| b.layers.cmp(&a.layers).then(a.family.cmp(&b.family)));
    out
}

#[cfg(test)]
mod test;
