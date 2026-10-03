//! The presentation document: package, parsed-part caches, and the slide list.

use super::color::ColorMap;
use super::theme::Theme;
use crate::error::{Error, Result};
use crate::opc::{Package, Relationships, rel_type};
use crate::xml::{Ns, XmlDoc};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

/// A parsed part: name, XML, and relationships.
#[derive(Clone, Debug)]
pub struct PartRef {
    /// Part name.
    pub name: String,
    /// Parsed XML.
    pub doc: Arc<XmlDoc>,
    /// The part's relationships.
    pub rels: Arc<Relationships>,
}

impl PartRef {
    /// Resolves an internal relationship id to a part name.
    pub fn target(&self, rid: &str) -> Option<String> {
        self.rels.target_part(rid)
    }
}

/// One entry of the slide list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlideEntry {
    /// Stable slide id (`p:sldId/@id`).
    pub id: u32,
    /// Relationship id from the presentation part.
    pub rid: String,
    /// Slide part name.
    pub part: String,
}

/// Everything needed to resolve inheritance for one slide.
#[derive(Clone, Debug)]
pub struct SlideContext {
    /// The slide (or layout/master when rendering those directly).
    pub slide: PartRef,
    /// Its layout.
    pub layout: Option<PartRef>,
    /// Its master.
    pub master: Option<PartRef>,
    /// The presentation part (default text style).
    pub presentation: PartRef,
    /// Effective theme.
    pub theme: Arc<Theme>,
    /// Effective color map.
    pub color_map: ColorMap,
    /// 1-based slide number (for slide-number fields).
    pub number: usize,
    /// Slide size in EMU.
    pub size: (i64, i64),
}

/// A presentation opened for rendering and editing.
#[derive(Clone)]
pub struct Presentation {
    pub(crate) pkg: Package,
    pub(crate) main_part: String,
    pub(crate) xml: HashMap<String, Arc<XmlDoc>>,
    pub(crate) rels: HashMap<String, Arc<Relationships>>,
    themes: HashMap<String, Arc<Theme>>,
    pub(crate) slides: Vec<SlideEntry>,
    /// Slide size in EMU.
    pub(crate) size: (i64, i64),
    /// Decoded pictures by part name (`None` = undecodable).
    pub(crate) images: HashMap<String, Option<Arc<crate::render::scene::Raster>>>,
    /// Parsed metafiles by part name (`None` = unparseable).
    pub(crate) metafiles: HashMap<String, Option<Arc<crate::render::metafile::Metafile>>>,
    /// Parts whose cached XML was edited and must be written back to the package.
    pub(crate) dirty_xml: BTreeSet<String>,
    /// Parts whose cached relationships were edited.
    pub(crate) dirty_rels: BTreeSet<String>,
}

/// Default slide size (16:9, 13.333 × 7.5 in).
pub const DEFAULT_SLIDE_SIZE: (i64, i64) = (12_192_000, 6_858_000);

impl Presentation {
    /// Opens a `.pptx` file.
    pub fn open(bytes: Vec<u8>) -> Result<Self> {
        let pkg = Package::open(bytes)?;
        let main_part = pkg.main_part()?;
        let mut p = Self {
            pkg,
            main_part,
            xml: HashMap::new(),
            rels: HashMap::new(),
            themes: HashMap::new(),
            slides: Vec::new(),
            size: DEFAULT_SLIDE_SIZE,
            images: HashMap::new(),
            metafiles: HashMap::new(),
            dirty_xml: BTreeSet::new(),
            dirty_rels: BTreeSet::new(),
        };
        p.reload_structure()?;
        Ok(p)
    }

    /// Re-reads the slide list and slide size from the presentation part.
    pub(crate) fn reload_structure(&mut self) -> Result<()> {
        let main = self.part(&self.main_part.clone())?;
        let doc = &main.doc;
        let root = doc.root();
        if let Some(sz) = doc.child(root, Ns::P, "sldSz") {
            let cx = doc.attr_i64(sz, "cx").unwrap_or(DEFAULT_SLIDE_SIZE.0);
            let cy = doc.attr_i64(sz, "cy").unwrap_or(DEFAULT_SLIDE_SIZE.1);
            if cx > 0 && cy > 0 {
                self.size = (cx, cy);
            }
        }
        self.slides.clear();
        if let Some(list) = doc.child(root, Ns::P, "sldIdLst") {
            for s in doc.children_named(list, Ns::P, "sldId") {
                let (Some(id), Some(rid)) = (doc.attr_i64(s, "id"), doc.attr_ns(s, Ns::R, "id")) else { continue };
                let Some(part) = main.target(rid) else { continue };
                if !self.pkg.has_part(&part) {
                    continue;
                }
                let part = self.pkg.canonical_name(&part).unwrap_or(&part).to_owned();
                self.slides.push(SlideEntry { id: id as u32, rid: rid.to_owned(), part });
            }
        }
        Ok(())
    }

    /// The underlying package.
    pub fn package(&self) -> &Package {
        &self.pkg
    }

    /// Name of the main presentation part.
    pub fn main_part_name(&self) -> &str {
        &self.main_part
    }

    /// Slide size in EMU.
    pub fn slide_size(&self) -> (i64, i64) {
        self.size
    }

    /// The slide list.
    pub fn slides(&self) -> &[SlideEntry] {
        &self.slides
    }

    /// Parsed XML of a part (cached).
    pub fn xml(&mut self, part: &str) -> Result<Arc<XmlDoc>> {
        let name = self.pkg.canonical_name(part).map(str::to_owned).unwrap_or_else(|| part.to_owned());
        if let Some(doc) = self.xml.get(&name) {
            return Ok(Arc::clone(doc));
        }
        let bytes = self.pkg.read(&name)?;
        let doc = Arc::new(XmlDoc::parse(&bytes, &name)?);
        self.xml.insert(name, Arc::clone(&doc));
        Ok(doc)
    }

    /// Relationships of a part (cached).
    pub fn part_rels(&mut self, part: &str) -> Result<Arc<Relationships>> {
        if let Some(r) = self.rels.get(part) {
            return Ok(Arc::clone(r));
        }
        let r = Arc::new(self.pkg.rels(part)?);
        self.rels.insert(part.to_owned(), Arc::clone(&r));
        Ok(r)
    }

    /// A part with its XML and relationships.
    pub fn part(&mut self, name: &str) -> Result<PartRef> {
        let canonical = self.pkg.canonical_name(name).map(str::to_owned).unwrap_or_else(|| name.to_owned());
        Ok(PartRef { doc: self.xml(&canonical)?, rels: self.part_rels(&canonical)?, name: canonical })
    }

    /// Reads raw bytes of a part.
    pub fn read_bytes(&self, part: &str) -> Result<Vec<u8>> {
        Ok(self.pkg.read(part)?.into_owned())
    }

    /// The theme of a master (or the presentation's first theme).
    pub fn theme_for(&mut self, master: Option<&PartRef>) -> Arc<Theme> {
        let theme_part = master
            .and_then(|m| m.rels.first_of_type(rel_type::THEME).map(|r| m.rels.resolve(r)))
            .or_else(|| {
                let main = self.main_part.clone();
                self.part_rels(&main).ok().and_then(|r| r.first_of_type(rel_type::THEME).map(|t| r.resolve(t)))
            });
        let Some(theme_part) = theme_part else { return Arc::new(Theme::default()) };
        if let Some(t) = self.themes.get(&theme_part) {
            return Arc::clone(t);
        }
        let theme = match self.xml(&theme_part) {
            Ok(doc) => Arc::new(Theme::parse(doc)),
            Err(_) => Arc::new(Theme::default()),
        };
        self.themes.insert(theme_part, Arc::clone(&theme));
        theme
    }

    /// The layout and master of a slide part.
    pub fn layout_and_master(&mut self, slide: &PartRef) -> (Option<PartRef>, Option<PartRef>) {
        let layout = slide
            .rels
            .first_of_type(rel_type::SLIDE_LAYOUT)
            .map(|r| slide.rels.resolve(r))
            .and_then(|n| self.part(&n).ok());
        let master_of = |p: &PartRef| p.rels.first_of_type(rel_type::SLIDE_MASTER).map(|r| p.rels.resolve(r));
        let master = layout
            .as_ref()
            .and_then(master_of)
            .or_else(|| master_of(slide))
            .and_then(|n| self.part(&n).ok());
        (layout, master)
    }

    /// Builds the inheritance context of slide `index` (0-based).
    pub fn slide_context(&mut self, index: usize) -> Result<SlideContext> {
        let entry = self
            .slides
            .get(index)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("slide {index}")))?;
        let slide = self.part(&entry.part)?;
        self.context_for(slide, index + 1)
    }

    /// Builds an inheritance context for any slide-like part (slide, layout, master, notes).
    pub fn context_for(&mut self, slide: PartRef, number: usize) -> Result<SlideContext> {
        let is_master = slide.doc.is(slide.doc.root(), Ns::P, "sldMaster");
        let is_layout = slide.doc.is(slide.doc.root(), Ns::P, "sldLayout");
        let (layout, master) = if is_master {
            (None, None)
        } else if is_layout {
            let master = slide
                .rels
                .first_of_type(rel_type::SLIDE_MASTER)
                .map(|r| slide.rels.resolve(r))
                .and_then(|n| self.part(&n).ok());
            (None, master)
        } else {
            self.layout_and_master(&slide)
        };
        let theme_source = if is_master { Some(&slide) } else { master.as_ref() };
        let theme = self.theme_for(theme_source);
        let color_map = effective_color_map(&slide, layout.as_ref(), master.as_ref(), is_master);
        let main = self.main_part.clone();
        let presentation = self.part(&main)?;
        Ok(SlideContext { slide, layout, master, presentation, theme, color_map, number, size: self.size })
    }

    /// Mutable XML of a part, marking it for write-back.
    ///
    /// Copy-on-write: snapshots that share the document keep the old version.
    pub(crate) fn xml_mut(&mut self, part: &str) -> Result<&mut XmlDoc> {
        let name = self.pkg.canonical_name(part).map(str::to_owned).unwrap_or_else(|| part.to_owned());
        self.xml(&name)?;
        self.dirty_xml.insert(name.clone());
        let doc = self.xml.get_mut(&name).ok_or_else(|| Error::MissingPart(name.clone()))?;
        Ok(Arc::make_mut(doc))
    }

    /// Mutable relationships of a part, marking them for write-back.
    pub(crate) fn rels_mut(&mut self, part: &str) -> Result<&mut Relationships> {
        let name = self.pkg.canonical_name(part).map(str::to_owned).unwrap_or_else(|| part.to_owned());
        self.part_rels(&name)?;
        self.dirty_rels.insert(name.clone());
        let rels = self.rels.get_mut(&name).ok_or_else(|| Error::MissingPart(name.clone()))?;
        Ok(Arc::make_mut(rels))
    }

    /// Installs relationships for a (possibly new) part, marking them for write-back.
    pub(crate) fn put_rels(&mut self, rels: Relationships) {
        let name = rels.source().to_owned();
        self.dirty_rels.insert(name.clone());
        self.rels.insert(name, Arc::new(rels));
    }

    /// Forgets every cached view of a removed part.
    pub(crate) fn forget(&mut self, part: &str) {
        self.xml.remove(part);
        self.rels.remove(part);
        self.themes.remove(part);
        self.images.remove(part);
        self.metafiles.remove(part);
        self.dirty_xml.remove(part);
        self.dirty_rels.remove(part);
    }

    /// Writes edited XML and relationships back into the package.
    pub(crate) fn flush(&mut self) {
        for name in std::mem::take(&mut self.dirty_xml) {
            if let Some(doc) = self.xml.get(&name) {
                self.pkg.write(&name, doc.to_bytes(), None);
            }
        }
        for name in std::mem::take(&mut self.dirty_rels) {
            if let Some(rels) = self.rels.get(&name) {
                let rels = Arc::clone(rels);
                if rels.iter().next().is_none() && name != "/" {
                    // An empty relationships part is legal but noisy; drop it.
                    self.pkg.delete(&crate::opc::rels_part_name(&name));
                } else {
                    self.pkg.write_rels(&rels);
                }
            }
        }
    }

    /// Serializes the presentation, writing back every edit.
    pub fn save(&mut self) -> Result<Vec<u8>> {
        self.flush();
        self.pkg.save()
    }
}

fn effective_color_map(slide: &PartRef, layout: Option<&PartRef>, master: Option<&PartRef>, is_master: bool) -> ColorMap {
    let override_of = |p: &PartRef| -> Option<ColorMap> {
        let doc = &p.doc;
        let ovr = doc.child(doc.root(), Ns::P, "clrMapOvr")?;
        let o = doc.child(ovr, Ns::A, "overrideClrMapping")?;
        Some(ColorMap::parse(doc, o))
    };
    if is_master {
        return slide
            .doc
            .child(slide.doc.root(), Ns::P, "clrMap")
            .map(|n| ColorMap::parse(&slide.doc, n))
            .unwrap_or_default();
    }
    if let Some(m) = override_of(slide) {
        return m;
    }
    if let Some(m) = layout.and_then(override_of) {
        return m;
    }
    master
        .and_then(|m| m.doc.child(m.doc.root(), Ns::P, "clrMap").map(|n| ColorMap::parse(&m.doc, n)))
        .unwrap_or_default()
}
