//! An open Word document: its package, parsed parts and stories.

use crate::error::{Error, Result};
use crate::model::block::{BlockId, IdGen, Story};
use crate::model::numbering::Numbering;
use crate::model::parse::StoryReader;
use crate::model::props::ThemeInfo;
use crate::model::section::Section;
use crate::model::settings::Settings;
use crate::model::styles::Styles;
use crate::model::write::Writer;
use crate::xml::{Decl, XmlTree};
use pptx_engine::opc::{Package, Relationships};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

/// The main document part when the package does not say otherwise.
pub const DEFAULT_MAIN_PART: &str = "/word/document.xml";

/// Relationship types by their last path segment (transitional and strict
/// URIs share it).
pub mod rel {
    /// Styles.
    pub const STYLES: &str = "styles";
    /// Numbering.
    pub const NUMBERING: &str = "numbering";
    /// Settings.
    pub const SETTINGS: &str = "settings";
    /// Theme.
    pub const THEME: &str = "theme";
    /// Footnotes.
    pub const FOOTNOTES: &str = "footnotes";
    /// Endnotes.
    pub const ENDNOTES: &str = "endnotes";
    /// Comments.
    pub const COMMENTS: &str = "comments";
    /// Header.
    pub const HEADER: &str = "header";
    /// Footer.
    pub const FOOTER: &str = "footer";
    /// Image.
    pub const IMAGE: &str = "image";
    /// Hyperlink.
    pub const HYPERLINK: &str = "hyperlink";
    /// The office document (package relationship).
    pub const OFFICE_DOCUMENT: &str = "officeDocument";
}

/// The last segment of a relationship type URI.
pub fn rel_kind(rel_type: &str) -> &str {
    rel_type.rsplit('/').next().unwrap_or(rel_type)
}

/// `document.xml` around the body's blocks.
#[derive(Clone, Debug, Default)]
pub struct Shell {
    /// Everything up to and including the `w:body` start tag.
    pub head: String,
    /// The body's final section properties, verbatim.
    pub final_sect_pr: Option<String>,
    /// Everything from the `w:body` end tag on.
    pub tail: String,
}

impl Shell {
    /// Placeholder the collaborative shell carries in place of the blocks.
    pub const BLOCKS: &'static str = "<!--docx-blocks-->";

    /// The shell as one string with the blocks placeholder.
    pub fn to_template(&self) -> String {
        format!(
            "{}{}{}{}",
            self.head,
            Self::BLOCKS,
            self.final_sect_pr.as_deref().unwrap_or(""),
            self.tail
        )
    }

    /// Splits a template produced by [`Shell::to_template`].
    pub fn from_template(template: &str) -> Option<Self> {
        let (head, rest) = template.split_once(Self::BLOCKS)?;
        let body_close = find_body_close(rest)?;
        let sect = rest[..body_close].trim();
        Some(Self {
            head: head.to_owned(),
            final_sect_pr: (!sect.is_empty()).then(|| sect.to_owned()),
            tail: rest[body_close..].to_owned(),
        })
    }
}

/// Byte offset of the `</…body>` end tag in `rest`.
fn find_body_close(rest: &str) -> Option<usize> {
    let mut search = 0;
    while let Some(i) = rest[search..].find("</") {
        let at = search + i;
        let name_end = rest[at + 2..].find('>').map(|e| at + 2 + e)?;
        let name = &rest[at + 2..name_end];
        if name == "body" || name.ends_with(":body") {
            return Some(at);
        }
        search = at + 2;
    }
    None
}

/// A story kept in its own part (header, footer) or note.
#[derive(Clone, Debug)]
pub struct PartStory {
    /// The blocks.
    pub story: Story,
    /// Namespace declarations of the part's root (for reading snippets).
    pub decls: Arc<Vec<Decl>>,
    /// The part's XML before its blocks (through the root start tag).
    pub(crate) head: String,
    /// The part's XML after its blocks (from the root end tag).
    pub(crate) tail: String,
    /// The prefix the part binds to WordprocessingML.
    pub(crate) w: String,
    /// The part's bytes the story was read from (or last written as).
    pub(crate) identity: Option<(bool, usize)>,
}

/// The story edits apply to.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "part", rename_all = "camelCase")]
pub enum StoryTarget {
    /// The body.
    #[default]
    Body,
    /// A header or footer part, by part name.
    Part(String),
    /// A footnote or endnote.
    Note {
        /// An endnote (else a footnote).
        endnote: bool,
        /// The note's id.
        id: i64,
    },
}

/// An element's markup around its children: through the start tag, and
/// from the end tag on (a self-closing element is opened and closed).
fn split_element(tree: &XmlTree, node: crate::xml::NodeId) -> (String, String) {
    let span = tree.span(node);
    let src = tree.source();
    let tag = tree.start_tag(node);
    if tag.ends_with("/>") {
        let open = format!("{}>", tag.trim_end_matches("/>").trim_end());
        (
            format!("{}{open}", &src[..span.start]),
            format!("</{}>{}", tree.qname(node), &src[span.end..]),
        )
    } else {
        let close_start = span.end - (tree.qname(node).len() + 3);
        (
            src[..span.start + tag.len()].to_owned(),
            src[close_start..].to_owned(),
        )
    }
}

/// A footnote or endnote.
#[derive(Clone, Debug)]
pub struct Note {
    /// `w:type` (`separator`, `continuationSeparator`...), empty for normal notes.
    pub kind: String,
    /// The note's content.
    pub story: Story,
    /// The note element's start tag.
    pub(crate) open: String,
    /// Its end tag.
    pub(crate) close: String,
}

impl Note {
    /// Whether people write in it (not a separator or notice).
    pub fn is_text(&self) -> bool {
        self.kind.is_empty() || self.kind == "normal"
    }
}

/// A child of a notes part, in order.
#[derive(Clone, Debug)]
pub(crate) enum NoteSlot {
    /// A note, by id.
    Note(i64),
    /// Anything else, as written.
    Other(String),
}

/// The notes of one notes part.
#[derive(Clone, Debug, Default)]
pub struct Notes {
    /// The part name.
    pub part: Option<String>,
    /// Notes by id.
    pub by_id: BTreeMap<i64, Note>,
    /// Root declarations of the part.
    pub decls: Arc<Vec<Decl>>,
    /// The part's markup through the root's start tag, and from its end tag.
    pub(crate) head: String,
    pub(crate) tail: String,
    /// The root's children in order.
    pub(crate) slots: Vec<NoteSlot>,
    /// The part's WordprocessingML prefix.
    pub(crate) w: String,
    /// The part's bytes the notes were read from (or last written as).
    pub(crate) identity: Option<(bool, usize)>,
    /// Notes edited since the last snapshot (see `Document::snapshot`).
    pub(crate) edited: BTreeSet<i64>,
    /// The part was rewritten some other way since the last snapshot.
    pub(crate) rewritten: bool,
}

impl Notes {
    /// One note's XML as it now is.
    pub(crate) fn note_xml(&self, id: i64) -> Option<String> {
        let n = self.by_id.get(&id)?;
        let writer = Writer { w: &self.w };
        Some(format!("{}{}{}", n.open, writer.story(&n.story), n.close))
    }

    /// The part's XML as its notes now are.
    pub(crate) fn xml(&self) -> String {
        let writer = Writer { w: &self.w };
        let mut out = self.head.clone();
        for slot in &self.slots {
            match slot {
                NoteSlot::Note(id) => {
                    if let Some(n) = self.by_id.get(id) {
                        out.push_str(&n.open);
                        out.push_str(&writer.story(&n.story));
                        out.push_str(&n.close);
                    }
                }
                NoteSlot::Other(xml) => out.push_str(xml),
            }
        }
        out.push_str(&self.tail);
        out
    }
}

/// Parsed parts shared by layout.
#[derive(Clone, Debug, Default)]
pub struct Parts {
    /// Theme colors and fonts.
    pub theme: Arc<ThemeInfo>,
    /// The parsed theme (DrawingML), for drawings and charts.
    pub theme_full: Option<Arc<pptx_engine::model::theme::Theme>>,
    /// Styles.
    pub styles: Arc<Styles>,
    /// Numbering.
    pub numbering: Arc<Numbering>,
    /// Settings.
    pub settings: Arc<Settings>,
}

/// An open Word document.
#[derive(Clone)]
pub struct Document {
    pub(crate) pkg: Package,
    pub(crate) main: String,
    pub(crate) shell: Shell,
    pub(crate) body: Story,
    pub(crate) ids: Arc<std::sync::Mutex<IdGen>>,
    pub(crate) decls: Arc<Vec<Decl>>,
    pub(crate) w: String,
    pub(crate) parts: Parts,
    pub(crate) main_rels: Arc<Relationships>,
    /// Headers and footers by part name.
    pub(crate) stories: HashMap<String, PartStory>,
    pub(crate) footnotes: Notes,
    pub(crate) endnotes: Notes,
    /// The body changed since opening (document.xml must be rewritten).
    pub(crate) body_dirty: bool,
    /// Changes whenever the shared parts (styles, numbering, settings,
    /// theme) are reloaded; layout caches key on it.
    pub(crate) generation: u64,
}

impl std::fmt::Debug for Document {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Document")
            .field("main", &self.main)
            .field("blocks", &self.body.len())
            .finish()
    }
}

/// Reads a part as an XML tree.
fn read_tree(pkg: &Package, name: &str) -> Result<XmlTree> {
    let bytes = pkg.read(name)?;
    XmlTree::parse(&bytes, name)
}

/// The prefix bound to the WordprocessingML namespace (`w` in practice).
fn w_prefix(decls: &[Decl]) -> String {
    decls
        .iter()
        .find(|d| {
            d.uri == "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                || d.uri == "http://purl.oclc.org/ooxml/wordprocessingml/main"
        })
        .map_or_else(|| "w".to_owned(), |d| d.prefix.clone())
}

impl Document {
    /// Opens a `.docx` (or `.dotx`, `.docm`) file.
    pub fn open(bytes: Vec<u8>) -> Result<Self> {
        Self::open_with_ids(bytes, IdGen::sequential())
    }

    /// Opens a file, numbering blocks with `ids`.
    pub fn open_with_ids(bytes: Vec<u8>, mut ids: IdGen) -> Result<Self> {
        let pkg = Package::open(bytes)?;
        let main = Self::find_main(&pkg)?;
        let tree = read_tree(&pkg, &main)?;
        let root = tree.root();
        if !tree.is_w(root, "document") {
            return Err(Error::NotWord(format!(
                "{main} is <{}>, not a WordprocessingML document",
                tree.qname(root)
            )));
        }
        let body = tree
            .w_child(root, "body")
            .ok_or_else(|| Error::NotWord("the document has no body".into()))?;
        let (head, tail) = split_element(&tree, body);
        let read = StoryReader::new(&tree, &mut ids).read(body);
        let decls = Arc::new(tree.root_decls().to_vec());
        let w = w_prefix(&decls);
        let main_rels = Arc::new(pkg.rels(&main)?);
        let mut doc = Document {
            pkg,
            main,
            shell: Shell {
                head,
                final_sect_pr: read.final_sect_pr,
                tail,
            },
            body: read.story,
            ids: Arc::new(std::sync::Mutex::new(ids)),
            decls,
            w,
            parts: Parts::default(),
            main_rels,
            stories: HashMap::new(),
            footnotes: Notes::default(),
            endnotes: Notes::default(),
            body_dirty: false,
            generation: 0,
        };
        doc.load_parts()?;
        Ok(doc)
    }

    fn find_main(pkg: &Package) -> Result<String> {
        if let Ok(rels) = pkg.rels("/") {
            for r in rels.iter() {
                if rel_kind(&r.rel_type) == rel::OFFICE_DOCUMENT {
                    return Ok(rels.resolve(r));
                }
            }
        }
        if pkg.has_part(DEFAULT_MAIN_PART) {
            return Ok(DEFAULT_MAIN_PART.to_owned());
        }
        Err(Error::NotWord("no main document part".into()))
    }

    /// The part a relationship of the main part points to.
    fn related(&self, kind: &str) -> Option<String> {
        self.main_rels
            .iter()
            .find(|r| {
                rel_kind(&r.rel_type) == kind && r.mode == pptx_engine::opc::TargetMode::Internal
            })
            .map(|r| self.main_rels.resolve(r))
            .filter(|p| self.pkg.has_part(p))
    }

    /// (Re)parses styles, numbering, settings, theme, headers, footers and notes.
    pub(crate) fn load_parts(&mut self) -> Result<()> {
        let mut theme = ThemeInfo::default();
        let mut theme_full = None;
        if let Some(name) = self.related(rel::THEME)
            && let Ok(bytes) = self.pkg.read(&name)
            && let Ok(doc) = pptx_engine::xml::XmlDoc::parse(&bytes, &name)
        {
            let parsed = pptx_engine::model::theme::Theme::parse(Arc::new(doc));
            theme.colors = parsed.colors.clone();
            theme.major = parsed.major.clone();
            theme.minor = parsed.minor.clone();
            theme_full = Some(Arc::new(parsed));
        }
        let styles = match self.related(rel::STYLES) {
            Some(name) => Styles::parse(&read_tree(&self.pkg, &name)?, &theme),
            None => Styles::default(),
        };
        let numbering = match self.related(rel::NUMBERING) {
            Some(name) => Numbering::parse(&read_tree(&self.pkg, &name)?, &theme),
            None => Numbering::default(),
        };
        let settings = match self.related(rel::SETTINGS) {
            Some(name) => Settings::parse(&read_tree(&self.pkg, &name)?),
            None => Settings::default(),
        };
        self.generation = crate::model::block::next_version();
        self.parts = Parts {
            theme: Arc::new(theme),
            theme_full,
            styles: Arc::new(styles),
            numbering: Arc::new(numbering),
            settings: Arc::new(settings),
        };
        self.load_stories()
    }

    /// Parses headers, footers and notes. Their blocks get ids prefixed
    /// with the part (or note), so they never collide with the body's and
    /// stay the same when the part is read again.
    pub(crate) fn load_stories(&mut self) -> Result<()> {
        // A story whose part did not change since it was read stays as it
        // is (with the blocks an editor may be positioned in).
        let mut previous = std::mem::take(&mut self.stories);
        let parts: Vec<String> = self
            .main_rels
            .iter()
            .filter(|r| matches!(rel_kind(&r.rel_type), rel::HEADER | rel::FOOTER))
            .map(|r| self.main_rels.resolve(r))
            .collect();
        for name in parts {
            if self.stories.contains_key(&name) {
                continue;
            }
            let identity = self.pkg.part_identity(&name);
            if let Some(kept) = previous.remove(&name)
                && kept.identity.is_some()
                && kept.identity == identity
            {
                self.stories.insert(name, kept);
                continue;
            }
            let Ok(tree) = read_tree(&self.pkg, &name) else {
                continue;
            };
            let mut ids = IdGen::prefixed(&format!("{}#", name.trim_start_matches('/')));
            let read = StoryReader::new(&tree, &mut ids).read(tree.root());
            let (head, tail) = split_element(&tree, tree.root());
            let decls = Arc::new(tree.root_decls().to_vec());
            let w = w_prefix(&decls);
            self.stories.insert(
                name,
                PartStory {
                    story: read.story,
                    decls,
                    head,
                    tail,
                    w,
                    identity,
                },
            );
        }
        let footnotes = std::mem::take(&mut self.footnotes);
        self.footnotes = self.load_notes(rel::FOOTNOTES, "footnote", "fn", footnotes);
        let endnotes = std::mem::take(&mut self.endnotes);
        self.endnotes = self.load_notes(rel::ENDNOTES, "endnote", "en", endnotes);
        Ok(())
    }

    /// The story edits to `target` change (the body when the part is gone).
    pub(crate) fn story(&self, target: &StoryTarget) -> &Story {
        match target {
            StoryTarget::Body => &self.body,
            StoryTarget::Part(name) => self.stories.get(name).map_or(&self.body, |p| &p.story),
            StoryTarget::Note { endnote, id } => self
                .notes_of(*endnote)
                .by_id
                .get(id)
                .map_or(&self.body, |n| &n.story),
        }
    }

    /// The story edits to `target` change, for changing.
    pub(crate) fn story_mut(&mut self, target: &StoryTarget) -> &mut Story {
        match target {
            StoryTarget::Part(name) if self.stories.contains_key(name) => {
                &mut self.stories.get_mut(name).expect("checked").story
            }
            StoryTarget::Note { endnote, id } if self.notes_of(*endnote).by_id.contains_key(id) => {
                let notes = self.notes_of_mut(*endnote);
                &mut notes.by_id.get_mut(id).expect("checked").story
            }
            _ => &mut self.body,
        }
    }

    /// Whether `target` names a story the document has.
    pub(crate) fn has_story(&self, target: &StoryTarget) -> bool {
        match target {
            StoryTarget::Body => true,
            StoryTarget::Part(name) => self.stories.contains_key(name),
            StoryTarget::Note { endnote, id } => self
                .notes_of(*endnote)
                .by_id
                .get(id)
                .is_some_and(Note::is_text),
        }
    }

    /// The story holding a block, if any.
    pub(crate) fn story_of(&self, id: &BlockId) -> Option<StoryTarget> {
        if self.body.contains(id) {
            return Some(StoryTarget::Body);
        }
        if let Some((name, _)) = self.stories.iter().find(|(_, p)| p.story.contains(id)) {
            return Some(StoryTarget::Part(name.clone()));
        }
        [false, true].into_iter().find_map(|endnote| {
            let (note, _) = self
                .notes_of(endnote)
                .by_id
                .iter()
                .find(|(_, n)| n.story.contains(id))?;
            Some(StoryTarget::Note { endnote, id: *note })
        })
    }

    /// A header or footer part's XML as its story now is.
    pub(crate) fn part_story_xml(&self, part: &str) -> Option<String> {
        let ps = self.stories.get(part)?;
        let writer = Writer { w: &ps.w };
        Some(format!("{}{}{}", ps.head, writer.story(&ps.story), ps.tail))
    }

    /// Writes an edited header or footer story back into its part.
    pub(crate) fn write_part_story(&mut self, part: &str) {
        if let Some(xml) = self.part_story_xml(part) {
            self.pkg.write(part, xml.into_bytes(), None);
            let identity = self.pkg.part_identity(part);
            if let Some(ps) = self.stories.get_mut(part) {
                ps.identity = identity;
            }
        }
    }

    /// Reads a notes part. Notes whose part did not change since they were
    /// read (`previous`) stay as they are, with the blocks an editor may be
    /// positioned in.
    fn load_notes(&self, kind: &str, element: &str, prefix: &str, previous: Notes) -> Notes {
        let Some(name) = self.related(kind) else {
            return Notes::default();
        };
        let identity = self.pkg.part_identity(&name);
        if previous.part.as_deref() == Some(name.as_str())
            && previous.identity.is_some()
            && previous.identity == identity
        {
            return previous;
        }
        let Ok(tree) = read_tree(&self.pkg, &name) else {
            return Notes::default();
        };
        let root = tree.root();
        let (head, tail) = split_element(&tree, root);
        let decls = Arc::new(tree.root_decls().to_vec());
        let w = w_prefix(&decls);
        let mut notes = Notes {
            part: Some(name),
            by_id: BTreeMap::new(),
            decls,
            head,
            tail,
            slots: Vec::new(),
            w,
            identity,
            edited: BTreeSet::new(),
            rewritten: true,
        };
        for n in tree.children(root) {
            let id = tree
                .is_w(n, element)
                .then(|| tree.w_attr(n, "id").and_then(crate::xml::parse_int))
                .flatten()
                .filter(|id| !notes.by_id.contains_key(id));
            let Some(id) = id else {
                notes.slots.push(NoteSlot::Other(tree.raw(n).to_owned()));
                continue;
            };
            let mut ids = IdGen::prefixed(&format!("{prefix}{id}#"));
            let read = StoryReader::new(&tree, &mut ids).read(n);
            let tag = tree.start_tag(n);
            let open = match tag.strip_suffix("/>") {
                Some(t) => format!("{}>", t.trim_end()),
                None => tag.to_owned(),
            };
            notes.by_id.insert(
                id,
                Note {
                    kind: tree.w_attr(n, "type").unwrap_or("").to_owned(),
                    story: read.story,
                    open,
                    close: format!("</{}>", tree.qname(n)),
                },
            );
            notes.slots.push(NoteSlot::Note(id));
        }
        notes
    }

    pub(crate) fn notes_of(&self, endnote: bool) -> &Notes {
        if endnote {
            &self.endnotes
        } else {
            &self.footnotes
        }
    }

    pub(crate) fn notes_of_mut(&mut self, endnote: bool) -> &mut Notes {
        if endnote {
            &mut self.endnotes
        } else {
            &mut self.footnotes
        }
    }

    /// Writes edited notes back into their part, noting which one changed
    /// (`None`: any of them) for sharing.
    pub(crate) fn write_notes(&mut self, endnote: bool, edited: Option<i64>) {
        let notes = self.notes_of(endnote);
        let Some(part) = notes.part.clone() else {
            return;
        };
        let xml = notes.xml();
        self.pkg.write(&part, xml.into_bytes(), None);
        let identity = self.pkg.part_identity(&part);
        let notes = self.notes_of_mut(endnote);
        notes.identity = identity;
        match edited {
            Some(id) => {
                notes.edited.insert(id);
            }
            None => notes.rewritten = true,
        }
    }

    /// The main part name.
    pub fn main_part(&self) -> &str {
        &self.main
    }

    /// The body.
    pub fn body(&self) -> &Story {
        &self.body
    }

    /// Parsed shared parts.
    pub fn parts(&self) -> &Parts {
        &self.parts
    }

    /// Root namespace declarations of the main part.
    pub fn decls(&self) -> &Arc<Vec<Decl>> {
        &self.decls
    }

    /// The prefix the document binds to WordprocessingML.
    pub fn w_prefix(&self) -> &str {
        &self.w
    }

    /// Relationships of the main part.
    pub fn main_rels(&self) -> &Relationships {
        &self.main_rels
    }

    /// The package.
    pub fn package(&self) -> &Package {
        &self.pkg
    }

    /// A header or footer story by part name.
    pub fn part_story(&self, part: &str) -> Option<&PartStory> {
        self.stories.get(part)
    }

    /// The footnotes.
    pub fn footnotes(&self) -> &Notes {
        &self.footnotes
    }

    /// The endnotes.
    pub fn endnotes(&self) -> &Notes {
        &self.endnotes
    }

    /// The final section's properties.
    pub fn final_section(&self) -> Section {
        self.shell
            .final_sect_pr
            .as_deref()
            .and_then(|s| XmlTree::parse_snippet(s, &self.decls).ok())
            .map(|t| Section::read(&t, t.root(), &self.parts.theme))
            .unwrap_or_default()
    }

    /// The document part's XML as it is now.
    pub fn document_xml(&self) -> String {
        let writer = Writer { w: &self.w };
        let mut out = String::with_capacity(self.shell.head.len() + self.body.len() * 200);
        out.push_str(&self.shell.head);
        out.push_str(&writer.story(&self.body));
        if let Some(s) = &self.shell.final_sect_pr {
            out.push_str(s);
        }
        out.push_str(&self.shell.tail);
        out
    }

    /// Serializes the document. Untouched parts keep their original bytes.
    pub fn save(&self) -> Result<Vec<u8>> {
        let mut pkg = self.pkg.clone();
        if self.body_dirty {
            pkg.write(&self.main, self.document_xml().into_bytes(), None);
        }
        Ok(pkg.save()?)
    }

    /// A new block id.
    pub fn next_block_id(&self) -> BlockId {
        match self.ids.lock() {
            Ok(mut ids) => ids.next_id(),
            Err(poisoned) => poisoned.into_inner().next_id(),
        }
    }
}

#[cfg(test)]
mod test;
