//! Copy and paste of shapes and slides, within a presentation and between
//! presentations.
//!
//! A [`ClipboardPayload`] is self-contained JSON: shape (or slide) markup
//! plus every part it references, directly or through other parts —
//! pictures, media, charts with their embedded workbooks and style parts,
//! SmartArt, embedded objects — as base64 with content types and
//! relationships, and external link targets. Pasting copies those parts under
//! fresh names (identical media is shared, found by content hash), adds
//! relationships, and rewrites `r:embed`, `r:id`, `r:link`, `r:pict`, and
//! every other relationship reference.
//!
//! What depends on the source deck's layouts is resolved while copying:
//! placeholders become ordinary shapes carrying the position, geometry, and
//! text formatting they inherited, group members get their slide-space
//! position, and custom table styles travel along. Theme references
//! (`schemeClr` colors, `+mj-lt` fonts, style matrix indices) are kept, so
//! pasted content takes the destination theme, as PowerPoint's default
//! paste ("Use Destination Theme") does; the payload records the source
//! theme's colors (`themeColors`) for reference.

use super::group::{self, Frame};
use super::relayout::{inherited_frames, placeholders};
use super::shapes::{tree_item, xfrm_element};
use super::slides::layout_of;
use super::xmlutil::find_shape;
use crate::error::{Error, Result};
use crate::model::presentation::{Presentation, SlideContext};
use crate::model::shape::{Inherit, placeholder_chain, placeholder_of};
use crate::opc::{Relationship, Relationships, TargetMode, rel_type};
use crate::xml::{NodeId, Ns, XmlDoc};
use bake::bake_placeholder;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// The `format` of every clipboard payload.
pub const CLIPBOARD_FORMAT: &str = "pptx-engine/clipboard";
/// The payload layout version this engine writes and reads.
const CLIPBOARD_VERSION: u32 = 1;
/// Content type of the table styles part.
const TABLE_STYLES_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml";
/// The table style PowerPoint makes the default of a new table styles part.
const DEFAULT_TABLE_STYLE: &str = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
/// Relationship types whose targets never travel: deck structure, and the
/// per-slide parts paste recreates or drops (notes, comments).
const NOT_CARRIED: &[&str] = &[
    "/slideLayout",
    "/slideMaster",
    "/notesMaster",
    "/handoutMaster",
    "/theme",
    "/presentation",
    "/notesSlide",
    "/comments",
    "/commentAuthors",
];
/// Elements that are nothing but a link, dropped with the link's target.
const LINK_ELEMENTS: &[&str] = &["hlinkClick", "hlinkMouseOver", "hlinkHover"];
/// Placeholder types that are not content (not compared when matching layouts).
const CHROME_PLACEHOLDERS: &[&str] = &["dt", "ftr", "sldNum", "hdr"];

/// Shapes or slides copied from a presentation (`copyShapes`, `copySlides`),
/// pasted with `pasteShapes` or `pasteSlides`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardPayload {
    /// Always [`CLIPBOARD_FORMAT`].
    pub format: String,
    /// Payload layout version (1).
    pub version: u32,
    /// Copied shapes, back to front: each a standalone XML fragment (a
    /// `p:sp`, `p:grpSp`, `p:pic`, `p:graphicFrame`, `p:cxnSp`, or
    /// `mc:AlternateContent`) declaring the namespaces it uses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<String>,
    /// The source slide relationships the shapes reference, by source id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rels: Vec<ClipRel>,
    /// Copied slides, in deck order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slides: Vec<ClipSlide>,
    /// Every part the shapes or slides reference, directly or through other parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<ClipPart>,
    /// Custom table styles the copied tables use (`a:tblStyle` fragments).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub table_styles: Vec<String>,
    /// The source theme's colors as `[slot, #RRGGBB]`; pasted content keeps
    /// its theme references and takes the destination theme.
    #[serde(default)]
    pub theme_colors: Vec<(String, String)>,
}

/// A relationship of copied content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRel {
    /// Relationship id in the source part (what the markup references).
    pub id: String,
    /// Relationship type URI.
    #[serde(rename = "type")]
    pub rel_type: String,
    /// External: the URL. Internal: the source part name, a key into
    /// [`ClipboardPayload::parts`] (or, for links between slides, the
    /// linked slide's source part).
    pub target: String,
    /// Whether the target is external.
    #[serde(default)]
    pub external: bool,
}

/// A part copied along with shapes or slides.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPart {
    /// Part name in the source package.
    pub name: String,
    /// Content type.
    pub content_type: String,
    /// Bytes as base64.
    pub data: String,
    /// The part's own relationships.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rels: Vec<ClipRel>,
}

/// A copied slide.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSlide {
    /// Source slide id.
    pub id: u32,
    /// Source part name (target of links from other copied slides).
    pub part: String,
    /// The slide part's XML.
    pub xml: String,
    /// Its relationships, except to its layout and notes.
    #[serde(default)]
    pub rels: Vec<ClipRel>,
    /// The layout it used.
    pub layout: ClipLayout,
    /// Frames its placeholders inherited from that layout, for placeholders
    /// the destination layout does not match.
    #[serde(default)]
    pub placeholders: Vec<ClipFrame>,
    /// Speaker notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<ClipNotes>,
}

/// The layout of a copied slide.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLayout {
    /// Source part name.
    pub part: String,
    /// Layout name (`p:cSld/@name`).
    pub name: String,
    /// Layout type (`title`, `obj`...).
    pub kind: String,
    /// Its content placeholder types, sorted (dates, footers, and slide numbers excluded).
    pub placeholders: Vec<String>,
}

/// The position a placeholder inherited, in points.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipFrame {
    /// Shape id.
    pub shape: u32,
    /// Left.
    pub x: f64,
    /// Top.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
    /// Clockwise rotation in degrees.
    #[serde(default)]
    pub rotation: f64,
    /// Mirrored horizontally.
    #[serde(default)]
    pub flip_h: bool,
    /// Mirrored vertically.
    #[serde(default)]
    pub flip_v: bool,
}

/// The speaker notes of a copied slide.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipNotes {
    /// The notes slide part's XML.
    pub xml: String,
    /// Its relationships, except to the notes master and the slide.
    #[serde(default)]
    pub rels: Vec<ClipRel>,
}

impl ClipFrame {
    fn frame(&self) -> Frame {
        Frame {
            x: self.x,
            y: self.y,
            w: self.w,
            h: self.h,
            rot: self.rotation,
            flip_h: self.flip_h,
            flip_v: self.flip_v,
        }
    }
}

fn not_carried(rel: &str) -> bool {
    NOT_CARRIED.iter().any(|t| rel.ends_with(t))
}

/// A link to another slide (a hyperlink jump), carried only between copied slides.
fn is_slide_link(rel: &str) -> bool {
    rel == rel_type::SLIDE
}

/// Relationship ids referenced from a subtree (`r:` attributes).
fn references(doc: &XmlDoc, root: NodeId, out: &mut Vec<String>) {
    let mut nodes = vec![root];
    nodes.extend(doc.descendants(root));
    for n in nodes {
        for a in doc.attrs(n) {
            if a.ns() == Ns::R && !a.value().is_empty() && !out.iter().any(|v| v == a.value()) {
                out.push(a.value().to_owned());
            }
        }
    }
}

/// Whether a subtree references relationships (it cannot move to another part).
fn has_references(doc: &XmlDoc, root: NodeId) -> bool {
    let mut refs = Vec::new();
    references(doc, root, &mut refs);
    !refs.is_empty()
}

/// Table style ids used in a subtree.
fn table_style_ids(doc: &XmlDoc, root: NodeId, out: &mut Vec<String>) {
    for n in doc.descendants(root) {
        if doc.local(n) == "tableStyleId" {
            let id = doc.text(n).trim().to_owned();
            if !id.is_empty() && !out.contains(&id) {
                out.push(id);
            }
        }
    }
}

fn theme_colors(ctx: &SlideContext) -> Vec<(String, String)> {
    let ch = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    crate::model::color::SCHEME_SLOTS
        .iter()
        .zip(ctx.theme.colors.colors.iter())
        .map(|(slot, c)| {
            (
                (*slot).to_owned(),
                format!("#{:02X}{:02X}{:02X}", ch(c.r), ch(c.g), ch(c.b)),
            )
        })
        .collect()
}

mod bake;
mod paste;

pub(super) use paste::{paste_shapes, paste_slides};

impl Presentation {
    fn new_payload(&self, ctx: &SlideContext) -> ClipboardPayload {
        ClipboardPayload {
            format: CLIPBOARD_FORMAT.to_owned(),
            version: CLIPBOARD_VERSION,
            theme_colors: theme_colors(ctx),
            ..ClipboardPayload::default()
        }
    }

    /// The payload form of relationship `r` of part `source`, copying its
    /// target (and everything that references) into `parts`; `None` for
    /// relationships that never travel or point nowhere.
    fn carry_rel(
        &mut self,
        rels: &Relationships,
        r: &Relationship,
        parts: &mut Vec<ClipPart>,
        seen: &mut HashSet<String>,
    ) -> Result<Option<ClipRel>> {
        let clip = |target: String, external: bool| ClipRel {
            id: r.id.clone(),
            rel_type: r.rel_type.clone(),
            target,
            external,
        };
        if r.mode == TargetMode::External {
            return Ok(Some(clip(r.target.clone(), true)));
        }
        if not_carried(&r.rel_type) {
            return Ok(None);
        }
        let target = rels.resolve(r);
        let Some(target) = self.pkg.canonical_name(&target).map(str::to_owned) else {
            return Ok(None);
        };
        if !is_slide_link(&r.rel_type) {
            self.carry_part(&target, parts, seen)?;
        }
        Ok(Some(clip(target, false)))
    }

    /// Adds part `name` and the parts it references to `parts`.
    fn carry_part(
        &mut self,
        name: &str,
        parts: &mut Vec<ClipPart>,
        seen: &mut HashSet<String>,
    ) -> Result<()> {
        if !seen.insert(name.to_owned()) {
            return Ok(());
        }
        let bytes = self.pkg.read(name)?.into_owned();
        let content_type = self
            .pkg
            .content_type(name)
            .unwrap_or("application/octet-stream")
            .to_owned();
        let rels = self.part_rels(name)?;
        let mut clip_rels = Vec::new();
        for r in rels.iter() {
            if let Some(c) = self.carry_rel(&rels, r, parts, seen)?
                && !is_slide_link(&c.rel_type)
            {
                clip_rels.push(c);
            }
        }
        parts.push(ClipPart {
            name: name.to_owned(),
            content_type,
            data: STANDARD.encode(&bytes),
            rels: clip_rels,
        });
        Ok(())
    }

    /// Definitions of the custom (not built-in) table styles among `ids`.
    fn custom_table_styles(&mut self, ids: &[String]) -> Result<Vec<String>> {
        let custom: Vec<&String> = ids
            .iter()
            .filter(|id| crate::model::table_style::builtin_style_xml(id).is_none())
            .collect();
        if custom.is_empty() {
            return Ok(Vec::new());
        }
        let main = self.main_part.clone();
        let rels = self.part_rels(&main)?;
        let Some(part) = rels
            .first_of_type(rel_type::TABLE_STYLES)
            .map(|r| rels.resolve(r))
            .filter(|p| self.pkg.has_part(p))
        else {
            return Ok(Vec::new());
        };
        let doc = self.xml(&part)?;
        Ok(doc
            .children(doc.root())
            .filter(|&s| {
                doc.local(s) == "tblStyle"
                    && doc
                        .attr(s, "styleId")
                        .is_some_and(|id| custom.iter().any(|c| c.as_str() == id))
            })
            .map(|s| String::from_utf8_lossy(&doc.fragment(s).to_bytes()).into_owned())
            .collect())
    }

    /// Copies shapes of the slide at `index` (by id; group members too) into
    /// a payload for [`EditOp::PasteShapes`](super::EditOp::PasteShapes),
    /// back to front. See the module docs for what travels along.
    pub fn copy_shapes(&mut self, index: usize, ids: &[u32]) -> Result<ClipboardPayload> {
        let entry = self
            .slides
            .get(index)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("slide {index}")))?;
        if ids.is_empty() {
            return Err(Error::InvalidEdit("no shapes to copy".into()));
        }
        let slide = self.part(&entry.part)?;
        let ctx = self.context_for(slide.clone(), index + 1)?;
        let mut scratch = (*slide.doc).clone();
        let mut chosen: Vec<NodeId> = Vec::new();
        for &id in ids {
            let node =
                find_shape(&scratch, id).ok_or_else(|| Error::NotFound(format!("shape {id}")))?;
            let item = tree_item(&scratch, node);
            if !chosen.contains(&item) {
                chosen.push(item);
            }
        }
        // A member of a copied group travels with it.
        let all = chosen.clone();
        chosen.retain(|&item| {
            !group::ancestors(&scratch, item)
                .iter()
                .any(|g| all.contains(g) || all.contains(&tree_item(&scratch, *g)))
        });
        let order: HashMap<NodeId, usize> = scratch
            .descendants(scratch.root())
            .into_iter()
            .enumerate()
            .map(|(i, n)| (n, i))
            .collect();
        chosen.sort_by_key(|n| order.get(n).copied().unwrap_or(usize::MAX));

        let mut payload = self.new_payload(&ctx);
        let mut rids = Vec::new();
        let mut styles = Vec::new();
        for item in chosen {
            let copy = scratch.deep_clone(item);
            // In the tree, the copy sees the namespace declarations in scope.
            scratch.insert_after(item, copy);
            let nested = !group::ancestors(&scratch, item).is_empty();
            let fill = group::inherited_group_fill(&scratch, item);
            let pairs: Vec<(NodeId, NodeId)> = group::branch_shapes(&scratch, item)
                .into_iter()
                .zip(group::branch_shapes(&scratch, copy))
                .collect();
            for (original, top) in pairs {
                if placeholder_of(&scratch, original).is_some() {
                    let chain = placeholder_chain(&ctx, &slide, original, Inherit::Slide);
                    bake_placeholder(&mut scratch, top, &chain, &ctx);
                }
                if nested {
                    if let Some(x) = xfrm_element(&scratch, top) {
                        if scratch.local(top) == "grpSp" {
                            group::pin_child_space(&mut scratch, x);
                        }
                        let frame = Frame::read(&scratch, x);
                        group::to_slide(&scratch, original, frame).write(&mut scratch, x, true);
                    }
                    group::inherit_group_fill(&mut scratch, top, fill);
                }
            }
            references(&scratch, copy, &mut rids);
            table_style_ids(&scratch, copy, &mut styles);
            payload
                .shapes
                .push(String::from_utf8_lossy(&scratch.fragment(copy).to_bytes()).into_owned());
        }
        let mut seen = HashSet::new();
        for rid in rids {
            let Some(r) = slide.rels.get(&rid).cloned() else {
                continue;
            };
            if let Some(c) = self.carry_rel(&slide.rels, &r, &mut payload.parts, &mut seen)? {
                payload.rels.push(c);
            }
        }
        payload.table_styles = self.custom_table_styles(&styles)?;
        Ok(payload)
    }

    /// Copies slides (by id, in deck order) with their notes into a payload
    /// for [`EditOp::PasteSlides`](super::EditOp::PasteSlides).
    pub fn copy_slides(&mut self, ids: &[u32]) -> Result<ClipboardPayload> {
        let mut indices = Vec::new();
        for &id in ids {
            let i = self
                .slides
                .iter()
                .position(|s| s.id == id)
                .ok_or_else(|| Error::NotFound(format!("slide {id}")))?;
            if !indices.contains(&i) {
                indices.push(i);
            }
        }
        indices.sort_unstable();
        let Some(&first) = indices.first() else {
            return Err(Error::InvalidEdit("no slides to copy".into()));
        };
        let ctx = self.slide_context(first)?;
        let mut payload = self.new_payload(&ctx);
        let mut seen = HashSet::new();
        let mut styles = Vec::new();
        for i in indices {
            let entry = self.slides[i].clone();
            let doc = self.xml(&entry.part)?;
            table_style_ids(&doc, doc.root(), &mut styles);
            let xml = String::from_utf8_lossy(&self.pkg.read(&entry.part)?).into_owned();
            let rels = self.part_rels(&entry.part)?;
            let mut clip_rels = Vec::new();
            for r in rels.iter() {
                if let Some(c) = self.carry_rel(&rels, r, &mut payload.parts, &mut seen)? {
                    clip_rels.push(c);
                }
            }
            let layout = self.clip_layout(&entry.part)?;
            let placeholders = inherited_frames(self, &entry.part)?
                .into_iter()
                .map(|(shape, f)| ClipFrame {
                    shape,
                    x: f.x,
                    y: f.y,
                    w: f.w,
                    h: f.h,
                    rotation: f.rot,
                    flip_h: f.flip_h,
                    flip_v: f.flip_v,
                })
                .collect();
            let notes = match rels
                .first_of_type(rel_type::NOTES_SLIDE)
                .map(|r| rels.resolve(r))
                .and_then(|n| self.pkg.canonical_name(&n).map(str::to_owned))
            {
                Some(notes) => {
                    let notes_rels = self.part_rels(&notes)?;
                    let mut clip_rels = Vec::new();
                    for r in notes_rels.iter() {
                        if let Some(c) =
                            self.carry_rel(&notes_rels, r, &mut payload.parts, &mut seen)?
                            && !is_slide_link(&c.rel_type)
                        {
                            clip_rels.push(c);
                        }
                    }
                    Some(ClipNotes {
                        xml: String::from_utf8_lossy(&self.pkg.read(&notes)?).into_owned(),
                        rels: clip_rels,
                    })
                }
                None => None,
            };
            payload.slides.push(ClipSlide {
                id: entry.id,
                part: entry.part.clone(),
                xml,
                rels: clip_rels,
                layout,
                placeholders,
                notes,
            });
        }
        payload.table_styles = self.custom_table_styles(&styles)?;
        Ok(payload)
    }

    /// The layout of a slide as a payload describes it.
    fn clip_layout(&mut self, slide_part: &str) -> Result<ClipLayout> {
        let Some(part) = layout_of(self, slide_part) else {
            return Ok(ClipLayout {
                part: String::new(),
                name: String::new(),
                kind: String::new(),
                placeholders: Vec::new(),
            });
        };
        let doc = self.xml(&part)?;
        Ok(ClipLayout {
            name: doc
                .child(doc.root(), Ns::P, "cSld")
                .and_then(|c| doc.attr(c, "name"))
                .unwrap_or("")
                .to_owned(),
            kind: doc.attr(doc.root(), "type").unwrap_or("cust").to_owned(),
            placeholders: content_types_of(&doc),
            part,
        })
    }
}

/// The sorted content placeholder types of a layout.
fn content_types_of(doc: &XmlDoc) -> Vec<String> {
    let mut kinds: Vec<String> = placeholders(doc)
        .into_iter()
        .map(|(_, p)| p.kind)
        .filter(|k| !CHROME_PLACEHOLDERS.contains(&k.as_str()))
        .collect();
    kinds.sort();
    kinds
}

#[cfg(test)]
mod test;
