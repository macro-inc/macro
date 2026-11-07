//! Pasting clipboard payloads: parts are copied under fresh names (identical
//! media shared), relationships added, references and shape ids rewritten,
//! and pasted slides bound to this deck's layouts.

use super::{
    CLIPBOARD_FORMAT, CLIPBOARD_VERSION, ClipLayout, ClipNotes, ClipPart, ClipRel,
    ClipboardPayload, DEFAULT_TABLE_STYLE, LINK_ELEMENTS, TABLE_STYLES_TYPE, content_types_of,
    is_slide_link, not_carried,
};
use crate::edit::group::{self, Frame};
use crate::edit::notes::ensure_notes_master;
use crate::edit::parts::sibling_name;
use crate::edit::relayout::rebind_placeholders;
use crate::edit::shapes::{TREE_ITEMS, append_to_tree, xfrm_element};
use crate::edit::slides::{LayoutInfo, drop_creation_id, layouts, register_slide};
use crate::edit::xmlutil::max_shape_id;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{alternate_content_choice, c_nv_pr, sp_tree};
use crate::opc::{
    IdSource, Relationship, Relationships, TargetMode, content_type, rel_type, relative_target,
};
use crate::xml::{NodeId, Ns, XmlDoc};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Reads and checks a payload.
fn parse_payload(json: &str) -> Result<ClipboardPayload> {
    let payload: ClipboardPayload = serde_json::from_str(json)
        .map_err(|e| Error::InvalidEdit(format!("the clipboard payload is not valid: {e}")))?;
    if payload.format != CLIPBOARD_FORMAT {
        return Err(Error::InvalidEdit(
            "the clipboard does not hold presentation content".into(),
        ));
    }
    if payload.version != CLIPBOARD_VERSION {
        return Err(Error::InvalidEdit(format!(
            "clipboard payload version {} is not supported",
            payload.version
        )));
    }
    Ok(payload)
}

/// Picture, video, and audio parts, which pasting shares when identical.
fn is_media(part: &ClipPart) -> bool {
    part.name.starts_with("/ppt/media/")
        || ["image/", "video/", "audio/"]
            .iter()
            .any(|p| part.content_type.starts_with(p))
}

/// 64-bit FNV-1a, to find identical media quickly.
fn content_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// A media part of the destination with exactly these bytes.
fn identical_media(pres: &Presentation, bytes: &[u8]) -> Option<String> {
    let hash = content_hash(bytes);
    pres.pkg
        .part_names()
        .filter(|n| n.starts_with("/ppt/media/"))
        .filter(|n| pres.pkg.part_size(n) == Some(bytes.len() as u64))
        .find(|n| {
            pres.pkg
                .read(n)
                .is_ok_and(|b| content_hash(&b) == hash && *b == *bytes)
        })
        .map(str::to_owned)
}

/// Rejects part names a payload must not create.
fn check_part(part: &ClipPart) -> Result<()> {
    let name = part.name.as_str();
    let ok_name = name.starts_with("/ppt/")
        && !name.contains("..")
        && !name.contains('\\')
        && !name.contains("/_rels/")
        && !name.ends_with(".rels")
        && !name.ends_with('/')
        && !name.chars().any(char::is_control);
    let ct = part.content_type.as_str();
    let ok_type = !ct.is_empty()
        && ct.contains('/')
        && ct
            .chars()
            .all(|c| c.is_ascii_graphic() && !matches!(c, '<' | '>' | '"' | '&' | '\''));
    if ok_name && ok_type {
        Ok(())
    } else {
        Err(Error::InvalidEdit(format!(
            "the clipboard part `{name}` is not valid"
        )))
    }
}

/// Copies payload parts into a presentation, each once.
struct Paster<'a> {
    payload: &'a ClipboardPayload,
    /// Source part name → destination part name.
    copied: HashMap<String, String>,
}

impl<'a> Paster<'a> {
    fn new(payload: &'a ClipboardPayload) -> Self {
        Self {
            payload,
            copied: HashMap::new(),
        }
    }

    /// The destination part for payload part `source`, created on first use.
    fn part(&mut self, pres: &mut Presentation, source: &str) -> Result<String> {
        if let Some(done) = self.copied.get(source) {
            return Ok(done.clone());
        }
        let part = self
            .payload
            .parts
            .iter()
            .find(|p| p.name == source)
            .ok_or_else(|| {
                Error::InvalidEdit(format!("the clipboard is missing the part `{source}`"))
            })?;
        check_part(part)?;
        let bytes = STANDARD
            .decode(part.data.as_bytes())
            .map_err(|e| Error::InvalidEdit(format!("clipboard part `{source}`: {e}")))?;
        let media = is_media(part);
        if media && let Some(existing) = identical_media(pres, &bytes) {
            self.copied.insert(source.to_owned(), existing.clone());
            return Ok(existing);
        }
        let dest = sibling_name(pres, source);
        self.copied.insert(source.to_owned(), dest.clone());
        pres.pkg.write(&dest, bytes, None);
        if pres.pkg.content_type(&dest) != Some(part.content_type.as_str()) {
            let ext = dest
                .rsplit_once('.')
                .map(|(_, e)| e.to_ascii_lowercase())
                .filter(|e| !e.contains('/'));
            match ext {
                Some(ext) if media && pres.pkg.content_types().default_for(&ext).is_none() => {
                    pres.pkg
                        .content_types_mut()
                        .ensure_default(&ext, &part.content_type);
                }
                _ => pres
                    .pkg
                    .content_types_mut()
                    .set_override(&dest, &part.content_type),
            }
        }
        let mut rels = Relationships::empty(&dest);
        for r in &part.rels {
            if r.external {
                rels.push(Relationship {
                    id: r.id.clone(),
                    rel_type: r.rel_type.clone(),
                    target: r.target.clone(),
                    mode: TargetMode::External,
                });
            } else if !is_slide_link(&r.rel_type) && !not_carried(&r.rel_type) {
                let target = self.part(pres, &r.target)?;
                rels.push(Relationship {
                    id: r.id.clone(),
                    rel_type: r.rel_type.clone(),
                    target: relative_target(&dest, &target),
                    mode: TargetMode::Internal,
                });
            }
        }
        if rels.iter().next().is_some() {
            pres.put_rels(rels);
        }
        Ok(dest)
    }

    /// Relationships of a new part from payload relationships: carried
    /// targets are copied, links to `slides` (source → destination part)
    /// retargeted; returns the ids whose targets did not come along.
    fn relate(
        &mut self,
        pres: &mut Presentation,
        rels: &mut Relationships,
        source: &[ClipRel],
        slides: &HashMap<String, String>,
    ) -> Result<HashSet<String>> {
        let mut lost = HashSet::new();
        let from = rels.source().to_owned();
        for r in source {
            let target = if r.external {
                Some((r.target.clone(), TargetMode::External))
            } else if is_slide_link(&r.rel_type) {
                slides
                    .get(&r.target)
                    .map(|t| (relative_target(&from, t), TargetMode::Internal))
            } else if not_carried(&r.rel_type) {
                None
            } else {
                let t = self.part(pres, &r.target)?;
                Some((relative_target(&from, &t), TargetMode::Internal))
            };
            match target {
                Some((target, mode)) => rels.push(Relationship {
                    id: r.id.clone(),
                    rel_type: r.rel_type.clone(),
                    target,
                    mode,
                }),
                None => {
                    lost.insert(r.id.clone());
                }
            }
        }
        Ok(lost)
    }
}

/// Rewrites the relationship references of a subtree: `map` gives the new id,
/// or `None` for a reference whose target did not come along (a link element
/// is then dropped, other references are removed).
fn retarget(doc: &mut XmlDoc, root: NodeId, map: impl Fn(&str) -> Option<String>) {
    let mut nodes = vec![root];
    nodes.extend(doc.descendants(root));
    let mut doomed = Vec::new();
    for n in nodes {
        let refs: Vec<(String, String)> = doc
            .attrs(n)
            .filter(|a| a.ns() == Ns::R && !a.value().is_empty())
            .map(|a| (a.local().to_owned(), a.value().to_owned()))
            .collect();
        for (local, value) in refs {
            match map(&value) {
                Some(new) => doc.set_attr_ns(n, Ns::R, &local, &new),
                None if LINK_ELEMENTS.contains(&doc.local(n)) => doomed.push(n),
                None => doc.remove_attr_ns(n, Ns::R, &local),
            }
        }
    }
    for n in doomed {
        doc.detach(n);
    }
}

/// Fresh shape ids for pasted shapes, never reusing one on the slide.
struct IdAlloc {
    used: HashSet<i64>,
    next: u32,
    random: Option<Arc<IdSource>>,
}

impl IdAlloc {
    fn new(doc: &XmlDoc, random: Option<Arc<IdSource>>) -> Self {
        Self {
            used: doc
                .descendants(doc.root())
                .into_iter()
                .filter(|&n| doc.local(n) == "cNvPr")
                .filter_map(|n| doc.attr_i64(n, "id"))
                .collect(),
            next: max_shape_id(doc) + 1,
            random,
        }
    }

    fn take(&mut self) -> u32 {
        if let Some(random) = &self.random {
            loop {
                let id = random.next_in(1 << 20..1 << 30) as u32;
                if self.used.insert(i64::from(id)) {
                    return id;
                }
            }
        }
        while self.used.contains(&i64::from(self.next)) {
            self.next += 1;
        }
        let id = self.next;
        self.used.insert(i64::from(id));
        self.next += 1;
        id
    }
}

/// Gives every shape of a pasted subtree a fresh id, keeping connections
/// between pasted shapes and dropping connections to shapes left behind.
fn renumber(doc: &mut XmlDoc, root: NodeId, ids: &mut IdAlloc) {
    let mut nodes = vec![root];
    nodes.extend(doc.descendants(root));
    let mut map: HashMap<i64, u32> = HashMap::new();
    for &n in &nodes {
        if doc.local(n) != "cNvPr" {
            continue;
        }
        let old = doc.attr_i64(n, "id").unwrap_or(0);
        let new = *map.entry(old).or_insert_with(|| ids.take());
        doc.set_attr(n, "id", &new.to_string());
        // Creation ids identify the original shape; copies get none.
        doc.remove_children_named(n, Ns::A, "extLst");
    }
    for &n in &nodes {
        if !matches!(doc.local(n), "stCxn" | "endCxn") {
            continue;
        }
        match doc.attr_i64(n, "id").and_then(|old| map.get(&old)) {
            Some(&new) => doc.set_attr(n, "id", &new.to_string()),
            None => doc.detach(n),
        }
    }
}

/// The id of the shape a pasted z-order slot shows.
fn shown_id(doc: &XmlDoc, item: NodeId) -> Option<u32> {
    let shape = if doc.local(item) == "AlternateContent" {
        alternate_content_choice(doc, item).and_then(|b| doc.first_child(b))?
    } else {
        item
    };
    c_nv_pr(doc, shape)
        .and_then(|c| doc.attr_i64(c, "id"))
        .and_then(|id| u32::try_from(id).ok())
}

/// A relationship from `part`, reusing an identical one.
fn relate_once(
    pres: &mut Presentation,
    part: &str,
    rel: &str,
    target: &str,
    mode: TargetMode,
) -> Result<String> {
    let rels = pres.rels_mut(part)?;
    let existing = rels
        .iter()
        .find(|r| {
            r.rel_type == rel
                && r.mode == mode
                && match mode {
                    TargetMode::Internal => rels.resolve(r) == target,
                    TargetMode::External => r.target == target,
                }
        })
        .map(|r| r.id.clone());
    Ok(match existing {
        Some(id) => id,
        None if mode == TargetMode::Internal => rels.add_internal(rel, target),
        None => rels.add(rel, target, mode),
    })
}

/// Adds a custom table style to the deck's table styles unless it has one with that id.
fn ensure_table_style(pres: &mut Presentation, xml: &str) -> Result<()> {
    let style = XmlDoc::parse(xml.as_bytes(), "clipboard table style")?;
    let Some(id) = style
        .is(style.root(), Ns::A, "tblStyle")
        .then(|| style.attr(style.root(), "styleId"))
        .flatten()
        .map(str::to_owned)
    else {
        return Err(Error::InvalidEdit(
            "the clipboard holds an invalid table style".into(),
        ));
    };
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    let existing = rels
        .first_of_type(rel_type::TABLE_STYLES)
        .map(|r| rels.resolve(r))
        .filter(|p| pres.pkg.has_part(p));
    let part = match existing {
        Some(p) => p,
        None => {
            let p = pres.pkg.unique_part_name("/ppt/tableStyles", ".xml");
            let xml = format!(
                "{}<a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{DEFAULT_TABLE_STYLE}\"/>",
                crate::xml::STANDARD_DECLARATION
            );
            pres.pkg
                .write(&p, xml.into_bytes(), Some(TABLE_STYLES_TYPE));
            pres.rels_mut(&main)?
                .add_internal(rel_type::TABLE_STYLES, &p);
            p
        }
    };
    let doc = pres.xml(&part)?;
    if doc
        .children(doc.root())
        .any(|s| doc.attr(s, "styleId") == Some(id.as_str()))
    {
        return Ok(());
    }
    let doc = pres.xml_mut(&part)?;
    let node = doc.import_verbatim(&style, style.root());
    let root = doc.root();
    let ext = doc.children(root).find(|&c| doc.local(c) == "extLst");
    match ext {
        Some(ext) => doc.insert_before(ext, node),
        None => doc.append_child(root, node),
    }
    doc.drop_redundant_ns_decls(node);
    Ok(())
}

/// Pastes the shapes of a payload on top of a slide; returns their ids.
pub(in crate::edit) fn paste_shapes(
    pres: &mut Presentation,
    part: &str,
    payload: &str,
    dx: f32,
    dy: f32,
) -> Result<Vec<u32>> {
    if !dx.is_finite() || !dy.is_finite() {
        return Err(Error::InvalidEdit("numbers must be finite".into()));
    }
    let payload = parse_payload(payload)?;
    if payload.shapes.is_empty() {
        return Err(Error::InvalidEdit("the clipboard holds no shapes".into()));
    }
    let mut paster = Paster::new(&payload);
    let mut ids_of: HashMap<String, String> = HashMap::new();
    for r in &payload.rels {
        let new = if r.external {
            Some(relate_once(
                pres,
                part,
                &r.rel_type,
                &r.target,
                TargetMode::External,
            )?)
        } else if is_slide_link(&r.rel_type) || not_carried(&r.rel_type) {
            None
        } else {
            let target = paster.part(pres, &r.target)?;
            Some(relate_once(
                pres,
                part,
                &r.rel_type,
                &target,
                TargetMode::Internal,
            )?)
        };
        if let Some(new) = new {
            ids_of.insert(r.id.clone(), new);
        }
    }
    for style in &payload.table_styles {
        ensure_table_style(pres, style)?;
    }
    let random = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(part)?;
    let tree = sp_tree(doc).ok_or_else(|| Error::InvalidEdit("slide has no shape tree".into()))?;
    let mut alloc = IdAlloc::new(doc, random);
    let mut created = Vec::new();
    for fragment in &payload.shapes {
        let shape = XmlDoc::parse(fragment.as_bytes(), "clipboard shape")?;
        let root = shape.root();
        if !matches!(shape.ns(root), Ns::P | Ns::MC) || !TREE_ITEMS.contains(&shape.local(root)) {
            return Err(Error::InvalidEdit(
                "the clipboard holds something other than shapes".into(),
            ));
        }
        let node = doc.import_verbatim(&shape, root);
        append_to_tree(doc, tree, node);
        doc.drop_redundant_ns_decls(node);
        retarget(doc, node, |id| ids_of.get(id).cloned());
        renumber(doc, node, &mut alloc);
        if dx != 0.0 || dy != 0.0 {
            for top in group::branch_shapes(doc, node) {
                let Some(off) = xfrm_element(doc, top).and_then(|x| doc.child(x, Ns::A, "off"))
                else {
                    continue;
                };
                let shift =
                    |v: Option<i64>, d: f32| v.unwrap_or(0) + crate::units::pt_to_emu(f64::from(d));
                let x = shift(doc.attr_i64(off, "x"), dx);
                let y = shift(doc.attr_i64(off, "y"), dy);
                doc.set_attr(off, "x", &x.to_string());
                doc.set_attr(off, "y", &y.to_string());
            }
        }
        created.extend(shown_id(doc, node));
    }
    Ok(created)
}

/// The destination layout for a copied slide's layout (see `PasteSlides`).
fn match_layout(
    all: &[LayoutInfo],
    kinds: &HashMap<String, Vec<String>>,
    source: &ClipLayout,
) -> Option<String> {
    let name = source.name.trim();
    all.iter()
        .find(|l| l.part == source.part && l.name == source.name)
        .or_else(|| {
            all.iter()
                .find(|l| !name.is_empty() && l.name.eq_ignore_ascii_case(name))
        })
        .or_else(|| {
            all.iter()
                .find(|l| kinds.get(&l.part) == Some(&source.placeholders))
        })
        .or_else(|| {
            all.iter()
                .find(|l| l.name.eq_ignore_ascii_case("Title and Content"))
        })
        .or_else(|| all.iter().find(|l| l.kind == "obj"))
        .or_else(|| all.first())
        .map(|l| l.part.clone())
}

/// Pastes the slides of a payload after slide `after` (or at the end);
/// returns their new ids.
pub(in crate::edit) fn paste_slides(
    pres: &mut Presentation,
    after: Option<u32>,
    payload: &str,
) -> Result<Vec<u32>> {
    let payload = parse_payload(payload)?;
    if payload.slides.is_empty() {
        return Err(Error::InvalidEdit("the clipboard holds no slides".into()));
    }
    if let Some(a) = after {
        pres.slide_part(a)?;
    }
    let all = layouts(pres)?;
    if all.is_empty() {
        return Err(Error::InvalidEdit(
            "the presentation has no slide layouts".into(),
        ));
    }
    let mut kinds = HashMap::new();
    for l in &all {
        let doc = pres.xml(&l.part)?;
        kinds.insert(l.part.clone(), content_types_of(&doc));
    }
    for style in &payload.table_styles {
        ensure_table_style(pres, style)?;
    }
    // Name every slide first, so links between pasted slides can be kept.
    let mut names: HashMap<String, String> = HashMap::new();
    let mut parts = Vec::new();
    for s in &payload.slides {
        let name = pres.pkg.unique_part_name("/ppt/slides/slide", ".xml");
        pres.pkg.write(&name, Vec::new(), Some(content_type::SLIDE));
        names.insert(s.part.clone(), name.clone());
        parts.push(name);
    }
    let mut paster = Paster::new(&payload);
    let mut after = after;
    let mut created = Vec::new();
    for (s, part) in payload.slides.iter().zip(parts) {
        let mut doc = XmlDoc::parse(s.xml.as_bytes(), "clipboard slide")?;
        if !doc.is(doc.root(), Ns::P, "sld") {
            return Err(Error::InvalidEdit(
                "the clipboard holds something other than slides".into(),
            ));
        }
        let layout = match_layout(&all, &kinds, &s.layout)
            .ok_or_else(|| Error::InvalidEdit("the presentation has no slide layouts".into()))?;
        let mut rels = Relationships::empty(&part);
        let lost = paster.relate(pres, &mut rels, &s.rels, &names)?;
        rels.add_internal(rel_type::SLIDE_LAYOUT, &layout);
        if let Some(notes) = &s.notes {
            let notes_part = paste_notes(pres, &mut paster, notes, &part)?;
            rels.add_internal(rel_type::NOTES_SLIDE, &notes_part);
        }
        let root = doc.root();
        retarget(&mut doc, root, |id| {
            (!lost.contains(id)).then(|| id.to_owned())
        });
        drop_creation_id(&mut doc);
        pres.pkg
            .write(&part, doc.to_bytes(), Some(content_type::SLIDE));
        pres.put_rels(rels);
        let id = register_slide(pres, &part, after)?;
        after = Some(id);
        let inherited: HashMap<u32, Frame> = s
            .placeholders
            .iter()
            .map(|f| (f.shape, f.frame()))
            .collect();
        rebind_placeholders(pres, &part, &layout, &inherited, false)?;
        created.push(id);
    }
    Ok(created)
}

/// Creates the notes slide of a pasted slide; returns its part name.
fn paste_notes(
    pres: &mut Presentation,
    paster: &mut Paster<'_>,
    notes: &ClipNotes,
    slide_part: &str,
) -> Result<String> {
    let mut doc = XmlDoc::parse(notes.xml.as_bytes(), "clipboard notes")?;
    if !doc.is(doc.root(), Ns::P, "notes") {
        return Err(Error::InvalidEdit(
            "the clipboard holds invalid speaker notes".into(),
        ));
    }
    let master = ensure_notes_master(pres)?;
    let part = pres
        .pkg
        .unique_part_name("/ppt/notesSlides/notesSlide", ".xml");
    let mut rels = Relationships::empty(&part);
    let lost = paster.relate(pres, &mut rels, &notes.rels, &HashMap::new())?;
    rels.add_internal(rel_type::NOTES_MASTER, &master);
    rels.add_internal(rel_type::SLIDE, slide_part);
    let root = doc.root();
    retarget(&mut doc, root, |id| {
        (!lost.contains(id)).then(|| id.to_owned())
    });
    pres.pkg
        .write(&part, doc.to_bytes(), Some(content_type::NOTES_SLIDE));
    pres.put_rels(rels);
    Ok(part)
}
